"""
Motor de simulación por eventos discretos — Expreso Norte (TP4).

Expone una API REST que ejecuta la simulación, arma el vector de estado,
filtra filas para la tabla y pre-calcula series para gráficos.
"""

import math
import random
from typing import Any, Dict, List, Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel


# =============================================================================
# Aplicación FastAPI y CORS
# =============================================================================

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =============================================================================
# Esquemas de entrada (Pydantic)
# =============================================================================


class SimulacionParametros(BaseModel):
    """Parámetros estocásticos y límites de la corrida."""

    tiempoMax: float
    maxIter: int
    mediaExpress: float
    mediaEstandar: float
    cintaMin: float
    cintaMax: float
    escanerMin: float
    escanerMax: float
    manualBase: float
    manualVar: float
    pRechazo: float


class SimularRequest(BaseModel):
    """Cuerpo del POST /api/simular."""

    parametros: SimulacionParametros
    horaInicio: float  # minuto de reloj desde el cual incluir filas en la tabla
    cantFilas: int  # cantidad máxima de filas de eventos (sin contar la fila final)


# =============================================================================
# Vector de estado — columnas fijas (índices 0..32, alineados con el Excel)
# =============================================================================

CANT_COLUMNAS_FIJAS = 33

COL = {
    "EVENTO": 0,
    "RELOJ": 1,
    "RND_EXPRESS": 2,
    "TIEMPO_EXPRESS": 3,
    "PROX_EXPRESS": 4,
    "RND_ESTANDAR": 5,
    "TIEMPO_ESTANDAR": 6,
    "PROX_ESTANDAR": 7,
    "RND_DESCARGA": 8,
    "TIEMPO_DESCARGA": 9,
    "FIN_DESCARGA_CINTA_1": 10,
    "FIN_DESCARGA_CINTA_2": 11,
    "ESTADO_CINTA_1": 12,
    "ESTADO_CINTA_2": 13,
    "COLA_DESCARGA": 14,
    "RND_LECTURA": 15,
    "RESULTADO_LECTURA": 16,
    "ESTADO_ESCANER": 15,  # comparte índice con RND_LECTURA (según tipo de evento)
    "COLA_ESCANER": 16,  # comparte índice con RESULTADO_LECTURA
    "RND_ESCANEO": 17,
    "TIEMPO_ESCANEO": 18,
    "FIN_ESCANEO": 19,
    "RND_MANUAL": 20,
    "TIEMPO_MANUAL": 21,
    "FIN_MANUAL": 22,
    "ESTADO_OPERARIO": 23,
    "COLA_MANUAL": 24,
    "CONT_EXPRESS": 25,
    "AC_EXPRESS": 26,
    "CONT_ESTANDAR": 27,
    "AC_ESTANDAR": 28,
    "AC_TIEMPO_OPERARIO": 29,
    "MAX_COLA_DESCARGA": 30,
}

# Columnas que se vacían en cada nuevo evento (solo persisten RND/tiempo del evento actual)
COLUMNAS_TRANSITORIAS = [
    COL["RND_EXPRESS"],
    COL["TIEMPO_EXPRESS"],
    COL["RND_ESTANDAR"],
    COL["TIEMPO_ESTANDAR"],
    COL["RND_DESCARGA"],
    COL["TIEMPO_DESCARGA"],
    COL["RND_LECTURA"],
    COL["RESULTADO_LECTURA"],
    COL["RND_ESCANEO"],
    COL["TIEMPO_ESCANEO"],
    COL["RND_MANUAL"],
    COL["TIEMPO_MANUAL"],
]


# =============================================================================
# Endpoints
# =============================================================================


@app.get("/")
def read_root() -> Dict[str, str]:
    """Comprobación de que el servidor está activo."""
    return {"message": "Backend funcionando"}


@app.post("/api/simular")
def simular(request: SimularRequest) -> Dict[str, Any]:
    """
    Ejecuta una corrida completa de simulación y devuelve:
    - filas: subconjunto para la tabla (filtrado por horaInicio / cantFilas + fila final)
    - datosGraficos: series temporales de toda la simulación
    - resumen: indicadores globales al cierre
    """
    parametros = request.parametros
    hora_inicio = request.horaInicio
    cant_filas = request.cantFilas

    # -------------------------------------------------------------------------
    # Utilidades: números aleatorios y validación
    # -------------------------------------------------------------------------

    def limpiar_probabilidad(valor: float) -> float:
        """Acota pRechazo al intervalo [0, 1] y evita NaN."""
        if not isinstance(valor, (int, float)) or math.isnan(valor):
            return 0.0
        return min(1.0, max(0.0, float(valor)))

    def aleatorio_exponencial(media: float) -> Dict[str, float]:
        """Tiempo entre arribos (llegadas Express / Estándar)."""
        rnd = random.random()
        return {"rnd": rnd, "tiempo": -media * math.log(1 - rnd)}

    def aleatorio_uniforme(minimo: float, maximo: float) -> Dict[str, float]:
        """Duración de descarga, escaneo o procesamiento manual."""
        rnd = random.random()
        return {"rnd": rnd, "tiempo": minimo + rnd * (maximo - minimo)}

    def tiempo_evento(valor: Optional[float]) -> float:
        """Convierte None (evento no programado) en +inf para excluirlo del calendario."""
        return float("inf") if valor is None else valor

    # -------------------------------------------------------------------------
    # Vector de estado: creación y escritura
    # -------------------------------------------------------------------------

    def crear_fila_vacia() -> List[Any]:
        """Lista de 33 celdas vacías (columnas fijas)."""
        return [""] * CANT_COLUMNAS_FIJAS

    def preparar_fila_desde_anterior(fila_anterior: List[Any]) -> List[Any]:
        """
        Copia el estado persistente de la fila anterior y limpia columnas transitorias.
        Patrón doble fila: evita clonar todo el vector en cada evento.
        """
        fila = fila_anterior[:CANT_COLUMNAS_FIJAS]
        for columna in COLUMNAS_TRANSITORIAS:
            fila[columna] = ""
        return fila

    def crear_fila_actual(evento: str, reloj_evento: float) -> List[Any]:
        """Rota vector_estado[0/1] y registra evento + reloj del instante actual."""
        vector_estado[0] = vector_estado[1]
        vector_estado[1] = preparar_fila_desde_anterior(vector_estado[0])
        vector_estado[1][COL["EVENTO"]] = evento
        vector_estado[1][COL["RELOJ"]] = reloj_evento
        return vector_estado[1]

    def escribir_estado_general(
        fila: List[Any],
        incluir_lotes: bool = True,
        ac_operario_forzado: Optional[float] = None,
    ) -> None:
        """
        Vuelca el estado del modelo (sistema) sobre las columnas fijas del vector.
        Si incluir_lotes, agrega al final pares [estado, tiempoEntrada] por lote activo.
        """
        fila[COL["PROX_EXPRESS"]] = sistema["proximaExpress"]
        fila[COL["PROX_ESTANDAR"]] = sistema["proximaEstandar"]
        fila[COL["FIN_DESCARGA_CINTA_1"]] = sistema["cinta1"]["fin"]
        fila[COL["FIN_DESCARGA_CINTA_2"]] = sistema["cinta2"]["fin"]
        fila[COL["ESTADO_CINTA_1"]] = sistema["cinta1"]["estado"]
        fila[COL["ESTADO_CINTA_2"]] = sistema["cinta2"]["estado"]
        fila[COL["COLA_DESCARGA"]] = len(sistema["colaDescarga"])
        fila[COL["ESTADO_ESCANER"]] = sistema["escaner"]["estado"]
        fila[COL["COLA_ESCANER"]] = len(sistema["colaEscaner"])
        fila[COL["FIN_ESCANEO"]] = sistema["escaner"]["fin"]
        fila[COL["FIN_MANUAL"]] = sistema["operario"]["fin"]
        fila[COL["ESTADO_OPERARIO"]] = sistema["operario"]["estado"]
        fila[COL["COLA_MANUAL"]] = len(sistema["colaManual"])
        fila[COL["CONT_EXPRESS"]] = sistema["contExpressTerminados"]
        fila[COL["AC_EXPRESS"]] = sistema["acTiempoExpress"]
        fila[COL["CONT_ESTANDAR"]] = sistema["contEstandarTerminados"]
        fila[COL["AC_ESTANDAR"]] = sistema["acTiempoEstandar"]
        fila[COL["AC_TIEMPO_OPERARIO"]] = (
            ac_operario_forzado if ac_operario_forzado is not None else sistema["acTiempoOperario"]
        )
        fila[COL["MAX_COLA_DESCARGA"]] = sistema["maxColaDescarga"]

        if not incluir_lotes:
            del fila[CANT_COLUMNAS_FIJAS:]
            return

        fila[:] = fila[:CANT_COLUMNAS_FIJAS]
        for lote in sistema["lotesActivos"].values():
            fila.append(lote["estado"])
            fila.append(lote["tiempoEntrada"])

    # -------------------------------------------------------------------------
    # Recursos del modelo (servidores, colas, lotes)
    # -------------------------------------------------------------------------

    def crear_servidor() -> Dict[str, Optional[float]]:
        """Plantilla para cinta, escáner u operario: Libre/Ocupado + fin de servicio."""
        return {"estado": "Libre", "fin": None, "loteId": None, "inicioOcupacion": None}

    def crear_lote(tipo: str) -> Dict[str, Any]:
        """Alta de camioneta/lote al arribar; queda en lotesActivos hasta salir del sistema."""
        lote = {
            "id": sistema["proximoLoteId"],
            "tipo": tipo,
            "estado": "Esperando Descarga",
            "horaLlegada": sistema["reloj"],
            "tiempoEntrada": sistema["reloj"],
            "cintaAsignada": None,
        }
        sistema["proximoLoteId"] += 1
        sistema["lotesActivos"][lote["id"]] = lote

        if tipo == "Express":
            sistema["totalExpressIngresados"] += 1
        else:
            sistema["totalEstandarIngresados"] += 1

        return lote

    def finalizar_lote(lote_id: int) -> None:
        """Lote sale del sistema: actualiza contadores/acumulados y lo quita de lotesActivos."""
        lote = sistema["lotesActivos"].get(lote_id)
        if lote is None:
            return
        tiempo_sistema = sistema["reloj"] - lote["horaLlegada"]
        if lote["tipo"] == "Express":
            sistema["contExpressTerminados"] += 1
            sistema["acTiempoExpress"] += tiempo_sistema
        else:
            sistema["contEstandarTerminados"] += 1
            sistema["acTiempoEstandar"] += tiempo_sistema
        sistema["lotesActivos"].pop(lote_id, None)

    # -------------------------------------------------------------------------
    # Llegadas (programación del próximo arribo)
    # -------------------------------------------------------------------------

    def programar_llegada_express(fila: List[Any]) -> None:
        llegada = aleatorio_exponencial(parametros.mediaExpress)
        sistema["proximaExpress"] = sistema["reloj"] + llegada["tiempo"]
        fila[COL["RND_EXPRESS"]] = llegada["rnd"]
        fila[COL["TIEMPO_EXPRESS"]] = llegada["tiempo"]

    def programar_llegada_estandar(fila: List[Any]) -> None:
        llegada = aleatorio_exponencial(parametros.mediaEstandar)
        sistema["proximaEstandar"] = sistema["reloj"] + llegada["tiempo"]
        fila[COL["RND_ESTANDAR"]] = llegada["rnd"]
        fila[COL["TIEMPO_ESTANDAR"]] = llegada["tiempo"]

    # -------------------------------------------------------------------------
    # Descarga (dos cintas, una sola cola con prioridad Express)
    # -------------------------------------------------------------------------

    def obtener_cinta_libre() -> Optional[Dict[str, Any]]:
        if sistema["cinta1"]["estado"] == "Libre":
            return sistema["cinta1"]
        if sistema["cinta2"]["estado"] == "Libre":
            return sistema["cinta2"]
        return None

    def asignar_descarga(
        lote_id: int,
        fila: List[Any],
        cinta_preferida: Optional[Dict[str, Any]] = None,
    ) -> bool:
        """Inicia descarga si hay cinta libre. Devuelve False si el lote debe encolarse."""
        cinta = (
            cinta_preferida
            if cinta_preferida and cinta_preferida["estado"] == "Libre"
            else obtener_cinta_libre()
        )
        lote = sistema["lotesActivos"].get(lote_id)
        if cinta is None or lote is None:
            return False

        descarga = aleatorio_uniforme(parametros.cintaMin, parametros.cintaMax)
        cinta["estado"] = "Ocupado"
        cinta["fin"] = sistema["reloj"] + descarga["tiempo"]
        cinta["loteId"] = lote_id
        lote["estado"] = f"Descargando (Cinta {1 if cinta is sistema['cinta1'] else 2})"
        lote["cintaAsignada"] = "Cinta 1" if cinta is sistema["cinta1"] else "Cinta 2"

        fila[COL["RND_DESCARGA"]] = descarga["rnd"]
        fila[COL["TIEMPO_DESCARGA"]] = descarga["tiempo"]
        return True

    def encolar_descarga(lote: Dict[str, Any]) -> None:
        """
        Cola única de descarga. Express se inserta antes del primer Estándar en cola.
        """
        lote["estado"] = "Esperando Descarga"
        if lote["tipo"] == "Express":
            primer_estandar = next(
                (
                    index
                    for index, lote_id in enumerate(sistema["colaDescarga"])
                    if sistema["lotesActivos"][lote_id]["tipo"] == "Estandar"
                ),
                None,
            )
            if primer_estandar is None:
                sistema["colaDescarga"].append(lote["id"])
            else:
                sistema["colaDescarga"].insert(primer_estandar, lote["id"])
        else:
            sistema["colaDescarga"].append(lote["id"])
        sistema["maxColaDescarga"] = max(sistema["maxColaDescarga"], len(sistema["colaDescarga"]))

    def tomar_siguiente_descarga(fila: List[Any], cinta_liberada: Dict[str, Any]) -> None:
        """Al liberarse una cinta, asigna el siguiente de la cola (FIFO con prioridad ya aplicada)."""
        if not sistema["colaDescarga"]:
            return
        lote_id = sistema["colaDescarga"].pop(0)
        asignar_descarga(lote_id, fila, cinta_liberada)

    # -------------------------------------------------------------------------
    # Escáner y operario (procesamiento manual si rechazo post-escaneo)
    # -------------------------------------------------------------------------

    def iniciar_escaner_si_puede(fila: List[Any]) -> None:
        if sistema["escaner"]["estado"] != "Libre" or not sistema["colaEscaner"]:
            return
        lote_id = sistema["colaEscaner"].pop(0)
        lote = sistema["lotesActivos"].get(lote_id)
        if lote is None:
            return
        escaneo = aleatorio_uniforme(parametros.escanerMin, parametros.escanerMax)
        sistema["escaner"]["estado"] = "Ocupado"
        sistema["escaner"]["fin"] = sistema["reloj"] + escaneo["tiempo"]
        sistema["escaner"]["loteId"] = lote_id
        lote["estado"] = "En Escaneo"
        fila[COL["RND_ESCANEO"]] = escaneo["rnd"]
        fila[COL["TIEMPO_ESCANEO"]] = escaneo["tiempo"]

    def iniciar_operario_si_puede(fila: List[Any]) -> None:
        if sistema["operario"]["estado"] != "Libre" or not sistema["colaManual"]:
            return
        lote_id = sistema["colaManual"].pop(0)
        lote = sistema["lotesActivos"].get(lote_id)
        if lote is None:
            return
        proceso_manual = aleatorio_uniforme(manual_min, manual_max)
        sistema["operario"]["estado"] = "Ocupado"
        sistema["operario"]["fin"] = sistema["reloj"] + proceso_manual["tiempo"]
        sistema["operario"]["loteId"] = lote_id
        sistema["operario"]["inicioOcupacion"] = sistema["reloj"]
        lote["estado"] = "En Procesamiento Manual"
        fila[COL["RND_MANUAL"]] = proceso_manual["rnd"]
        fila[COL["TIEMPO_MANUAL"]] = proceso_manual["tiempo"]

    def tiempo_operario_hasta(tiempo_final: float) -> float:
        """Proyecta tiempo ocupado del operario hasta tiempoMax (fila de cierre)."""
        if sistema["operario"]["estado"] != "Ocupado":
            return sistema["acTiempoOperario"]
        inicio = sistema["operario"]["inicioOcupacion"] or sistema["reloj"]
        return sistema["acTiempoOperario"] + max(0.0, tiempo_final - inicio)

    # -------------------------------------------------------------------------
    # Calendario de eventos discretos
    # -------------------------------------------------------------------------

    def elegir_proximo_evento() -> Optional[Dict[str, Any]]:
        """Avanza el reloj al evento con menor tiempo; en empate, gana menor prioridad numérica."""
        candidatos = [
            {"tipo": "llegada_camioneta_express", "tiempo": tiempo_evento(sistema["proximaExpress"]), "prioridad": 1},
            {"tipo": "llegada_camioneta_estandar", "tiempo": tiempo_evento(sistema["proximaEstandar"]), "prioridad": 2},
            {"tipo": "fin_descarga_cinta-1", "tiempo": tiempo_evento(sistema["cinta1"]["fin"]), "prioridad": 3},
            {"tipo": "fin_descarga_cinta-2", "tiempo": tiempo_evento(sistema["cinta2"]["fin"]), "prioridad": 4},
            {"tipo": "fin_escaneo", "tiempo": tiempo_evento(sistema["escaner"]["fin"]), "prioridad": 5},
            {"tipo": "fin_procesamiento_manual", "tiempo": tiempo_evento(sistema["operario"]["fin"]), "prioridad": 6},
        ]
        candidatos = [evento for evento in candidatos if math.isfinite(evento["tiempo"])]
        if not candidatos:
            return None
        candidatos.sort(key=lambda evento: (evento["tiempo"], evento["prioridad"]))
        return candidatos[0]

    # -------------------------------------------------------------------------
    # Persistencia de filas (tabla vs historial completo para gráficos)
    # -------------------------------------------------------------------------

    filas_guardadas_desde_inicio = 0

    def guardar_fila(fila: List[Any], es_final: bool = False) -> None:
        """
        - todas_las_filas: cada instante guardado (para datosGraficos).
        - filas_guardadas: subconjunto para el front (filtro horaInicio/cantFilas + fila final).
        id / iteracion = número de iteración en la simulación completa.
        """
        nonlocal filas_guardadas_desde_inicio
        todas_las_filas.append({"valores": fila.copy()})
        reloj = fila[COL["RELOJ"]]

        if es_final:
            filas_guardadas.append({
                "id": iteracion,
                "iteracion": iteracion,
                "esFinal": True,
                "valores": fila.copy(),
            })
            return

        if reloj < hora_inicio or filas_guardadas_desde_inicio >= cant_filas:
            return

        filas_guardadas_desde_inicio += 1
        filas_guardadas.append({
            "id": iteracion,
            "iteracion": iteracion,
            "valores": fila.copy(),
        })

    # -------------------------------------------------------------------------
    # Parámetros derivados e inicialización del estado
    # -------------------------------------------------------------------------

    limite_iteraciones = min(max(0, parametros.maxIter), 100000)
    probabilidad_rechazo = limpiar_probabilidad(parametros.pRechazo)
    probabilidad_aceptacion = 1.0 - probabilidad_rechazo
    manual_min = parametros.manualBase - parametros.manualVar
    manual_max = parametros.manualBase + parametros.manualVar

    sistema = {
        "reloj": 0.0,
        "proximaExpress": None,
        "proximaEstandar": None,
        "cinta1": crear_servidor(),
        "cinta2": crear_servidor(),
        "escaner": crear_servidor(),
        "operario": crear_servidor(),
        "colaDescarga": [],
        "colaEscaner": [],
        "colaManual": [],
        "lotesActivos": {},
        "proximoLoteId": 1,
        "totalExpressIngresados": 0,
        "totalEstandarIngresados": 0,
        "contExpressTerminados": 0,
        "contEstandarTerminados": 0,
        "acTiempoExpress": 0.0,
        "acTiempoEstandar": 0.0,
        "acTiempoOperario": 0.0,
        "maxColaDescarga": 0,
    }

    vector_estado = [crear_fila_vacia(), crear_fila_vacia()]
    filas_guardadas: List[Dict[str, Any]] = []
    todas_las_filas: List[Dict[str, Any]] = []
    iteracion = 0

    # -------------------------------------------------------------------------
    # Fila de inicialización (reloj 0; solo se envía si horaInicio <= 0)
    # -------------------------------------------------------------------------

    vector_estado[1][COL["EVENTO"]] = "Inicializacion"
    vector_estado[1][COL["RELOJ"]] = sistema["reloj"]
    programar_llegada_express(vector_estado[1])
    programar_llegada_estandar(vector_estado[1])
    escribir_estado_general(vector_estado[1])
    guardar_fila(vector_estado[1])

    # -------------------------------------------------------------------------
    # Bucle principal: procesar eventos hasta tiempoMax o sin candidatos
    # -------------------------------------------------------------------------

    while iteracion < limite_iteraciones:
        evento = elegir_proximo_evento()
        if evento is None or evento["tiempo"] > parametros.tiempoMax:
            break

        iteracion += 1
        sistema["reloj"] = evento["tiempo"]
        fila = crear_fila_actual(evento["tipo"], sistema["reloj"])

        if evento["tipo"] == "llegada_camioneta_express":
            programar_llegada_express(fila)
            lote = crear_lote("Express")
            if not asignar_descarga(lote["id"], fila):
                encolar_descarga(lote)

        elif evento["tipo"] == "llegada_camioneta_estandar":
            programar_llegada_estandar(fila)
            lote = crear_lote("Estandar")
            if not asignar_descarga(lote["id"], fila):
                encolar_descarga(lote)

        elif evento["tipo"] in {"fin_descarga_cinta-1", "fin_descarga_cinta-2"}:
            cinta = sistema["cinta1"] if evento["tipo"] == "fin_descarga_cinta-1" else sistema["cinta2"]
            lote_id = cinta["loteId"]
            lote = sistema["lotesActivos"].get(lote_id)

            cinta["estado"] = "Libre"
            cinta["fin"] = None
            cinta["loteId"] = None

            if lote is not None:
                lote["estado"] = "Esperando Escaneo"
                sistema["colaEscaner"].append(lote_id)

            iniciar_escaner_si_puede(fila)
            tomar_siguiente_descarga(fila, cinta)

        elif evento["tipo"] == "fin_escaneo":
            lote_id = sistema["escaner"]["loteId"]
            lote = sistema["lotesActivos"].get(lote_id)
            rnd_lectura = random.random()
            rechazado = rnd_lectura >= probabilidad_aceptacion

            sistema["escaner"]["estado"] = "Libre"
            sistema["escaner"]["fin"] = None
            sistema["escaner"]["loteId"] = None

            fila[COL["RND_LECTURA"]] = rnd_lectura
            fila[COL["RESULTADO_LECTURA"]] = "Rechazado" if rechazado else "Aceptado"

            if lote is not None and rechazado:
                lote["estado"] = "Esperando Procesamiento Manual"
                sistema["colaManual"].append(lote_id)
                iniciar_operario_si_puede(fila)
            else:
                finalizar_lote(lote_id)

            iniciar_escaner_si_puede(fila)

        elif evento["tipo"] == "fin_procesamiento_manual":
            lote_id = sistema["operario"]["loteId"]
            inicio = sistema["operario"]["inicioOcupacion"] or sistema["reloj"]
            sistema["acTiempoOperario"] += sistema["reloj"] - inicio
            sistema["operario"]["estado"] = "Libre"
            sistema["operario"]["fin"] = None
            sistema["operario"]["loteId"] = None
            sistema["operario"]["inicioOcupacion"] = None
            finalizar_lote(lote_id)
            iniciar_operario_si_puede(fila)

        escribir_estado_general(fila)
        guardar_fila(fila)

    # -------------------------------------------------------------------------
    # Fila de cierre (siempre incluida; sin columnas dinámicas de lotes)
    # -------------------------------------------------------------------------

    tiempo_cierre = parametros.tiempoMax
    ac_operario_cierre = tiempo_operario_hasta(parametros.tiempoMax)
    sistema["reloj"] = parametros.tiempoMax

    fila_final = crear_fila_actual("fin_simulacion", parametros.tiempoMax)
    escribir_estado_general(
        fila_final,
        incluir_lotes=False,
        ac_operario_forzado=ac_operario_cierre,
    )
    guardar_fila(fila_final, es_final=True)

    # -------------------------------------------------------------------------
    # Resumen global e indicadores para gráficos (toda la corrida)
    # -------------------------------------------------------------------------

    promedio_express = (
        sistema["acTiempoExpress"] / sistema["contExpressTerminados"]
        if sistema["contExpressTerminados"]
        else 0.0
    )
    promedio_estandar = (
        sistema["acTiempoEstandar"] / sistema["contEstandarTerminados"]
        if sistema["contEstandarTerminados"]
        else 0.0
    )
    porcentaje_operario = (ac_operario_cierre / tiempo_cierre * 100.0) if tiempo_cierre else 0.0

    datos_graficos = {
        "permanencia": [],
        "operario": [],
        "cola": [],
    }

    for fila_guardada in todas_las_filas:
        valores = fila_guardada["valores"]
        reloj = valores[COL["RELOJ"]]

        express_count = valores[COL["CONT_EXPRESS"]] or 0
        estandar_count = valores[COL["CONT_ESTANDAR"]] or 0
        ac_express = valores[COL["AC_EXPRESS"]] or 0
        ac_estandar = valores[COL["AC_ESTANDAR"]] or 0

        datos_graficos["permanencia"].append({
            "reloj": reloj,
            "express": round(ac_express / express_count, 2) if express_count else 0,
            "estandar": round(ac_estandar / estandar_count, 2) if estandar_count else 0,
        })
        datos_graficos["operario"].append({
            "reloj": reloj,
            "ocupacionAcumulada": valores[COL["AC_TIEMPO_OPERARIO"]] or 0,
        })
        datos_graficos["cola"].append({
            "reloj": reloj,
            "cola": valores[COL["COLA_DESCARGA"]] or 0,
        })

    return {
        "filas": filas_guardadas,
        "datosGraficos": datos_graficos,
        "resumen": {
            "tiempoTotal": tiempo_cierre,
            "promExpress": promedio_express,
            "promEstandar": promedio_estandar,
            "pctOperario": porcentaje_operario,
            "maxColaCintas": sistema["maxColaDescarga"],
            "totalLotes": sistema["totalExpressIngresados"] + sistema["totalEstandarIngresados"],
            "totalExpress": sistema["totalExpressIngresados"],
            "totalEstandar": sistema["totalEstandarIngresados"],
            "lotesExitExpress": sistema["contExpressTerminados"],
            "lotesExitEstandar": sistema["contEstandarTerminados"],
        },
    }
