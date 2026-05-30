import math
import random
from typing import Any, Dict, List, Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class SimulacionParametros(BaseModel):
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
    parametros: SimulacionParametros
    horaInicio: float
    cantFilas: int

@app.get("/")
def read_root() -> Dict[str, str]:
    return {"message": "Backend funcionando"}

@app.post("/api/simular")
def simular(request: SimularRequest) -> Dict[str, Any]:
    parametros = request.parametros
    hora_inicio = request.horaInicio
    cant_filas = request.cantFilas

    def limpiar_probabilidad(valor: float) -> float:
        if not isinstance(valor, (int, float)) or math.isnan(valor):
            return 0.0
        return min(1.0, max(0.0, float(valor)))

    def aleatorio_exponencial(media: float) -> Dict[str, float]:
        rnd = random.random()
        return {"rnd": rnd, "tiempo": -media * math.log(1 - rnd)}

    def aleatorio_uniforme(minimo: float, maximo: float) -> Dict[str, float]:
        rnd = random.random()
        return {"rnd": rnd, "tiempo": minimo + rnd * (maximo - minimo)}

    def crear_servidor() -> Dict[str, Optional[float]]:
        return {"estado": "Libre", "fin": None, "loteId": None, "inicioOcupacion": None}

    def crear_fila_vacia() -> List[Any]:
        return [""] * CANT_COLUMNAS_FIJAS

    def preparar_fila_desde_anterior(fila_anterior: List[Any]) -> List[Any]:
        fila = fila_anterior[:CANT_COLUMNAS_FIJAS]
        for columna in COLUMNAS_TRANSITORIAS:
            fila[columna] = ""
        return fila

    def tiempo_evento(valor: Optional[float]) -> float:
        return float("inf") if valor is None else valor

    def escribir_estado_general(fila: List[Any], incluir_lotes: bool = True, ac_operario_forzado: Optional[float] = None) -> None:
        fila[COL["PROX_EXPRESS"]] = sistema["proximaExpress"]
        fila[COL["PROX_ESTANDAR"]] = sistema["proximaEstandar"]
        fila[COL["FIN_DESCARGA_CINTA_1"]] = sistema["cinta1"]["fin"]
        fila[COL["FIN_DESCARGA_CINTA_2"]] = sistema["cinta2"]["fin"]
        fila[COL["ESTADO_CINTA_1"]] = sistema["cinta1"]["estado"]
        fila[COL["ESTADO_CINTA_2"]] = sistema["cinta2"]["estado"]
        fila[COL["COLA_DESCARGA"]] = len(sistema["colaDescarga"])
        fila[COL["COLA_EXPRESS"]] = sum(1 for lote_id in sistema["colaDescarga"] if sistema["lotesActivos"][lote_id]["tipo"] == "Express")
        fila[COL["COLA_ESTANDAR"]] = sum(1 for lote_id in sistema["colaDescarga"] if sistema["lotesActivos"][lote_id]["tipo"] == "Estandar")
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
        fila[COL["AC_TIEMPO_OPERARIO"]] = ac_operario_forzado if ac_operario_forzado is not None else sistema["acTiempoOperario"]
        fila[COL["MAX_COLA_DESCARGA"]] = sistema["maxColaDescarga"]

        if not incluir_lotes:
            del fila[CANT_COLUMNAS_FIJAS:]
            return

        fila[:] = fila[:CANT_COLUMNAS_FIJAS]
        for lote in sistema["lotesActivos"].values():
            fila.append(lote["estado"])
            fila.append(lote["tiempoEntrada"])

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

    def crear_lote(tipo: str) -> Dict[str, Any]:
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

    def encolar_descarga(lote: Dict[str, Any]) -> None:
        lote["estado"] = "Esperando Descarga"
        if lote["tipo"] == "Express":
            primer_estandar = next((index for index, lote_id in enumerate(sistema["colaDescarga"]) if sistema["lotesActivos"][lote_id]["tipo"] == "Estandar"), None)
            if primer_estandar is None:
                sistema["colaDescarga"].append(lote["id"])
            else:
                sistema["colaDescarga"].insert(primer_estandar, lote["id"])
        else:
            sistema["colaDescarga"].append(lote["id"])
        sistema["maxColaDescarga"] = max(sistema["maxColaDescarga"], len(sistema["colaDescarga"]))

    def asignar_descarga(lote_id: int, fila: List[Any], cinta_preferida: Optional[Dict[str, Any]] = None) -> bool:
        cinta = cinta_preferida if cinta_preferida and cinta_preferida["estado"] == "Libre" else obtener_cinta_libre()
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

    def obtener_cinta_libre() -> Optional[Dict[str, Any]]:
        if sistema["cinta1"]["estado"] == "Libre":
            return sistema["cinta1"]
        if sistema["cinta2"]["estado"] == "Libre":
            return sistema["cinta2"]
        return None

    def tomar_siguiente_descarga(fila: List[Any], cinta_liberada: Dict[str, Any]) -> None:
        if not sistema["colaDescarga"]:
            return
        lote_id = sistema["colaDescarga"].pop(0)
        asignar_descarga(lote_id, fila, cinta_liberada)

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

    def finalizar_lote(lote_id: int) -> None:
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

    def elegir_proximo_evento() -> Optional[Dict[str, Any]]:
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

    def crear_fila_actual(evento: str, reloj_evento: float) -> List[Any]:
        vector_estado[0] = vector_estado[1]
        vector_estado[1] = preparar_fila_desde_anterior(vector_estado[0])
        vector_estado[1][COL["EVENTO"]] = evento
        vector_estado[1][COL["RELOJ"]] = reloj_evento
        return vector_estado[1]

    filas_guardadas_desde_inicio = 0
    fila_numero_global = 0

    def tiempo_operario_hasta(tiempo_final: float) -> float:
        if sistema["operario"]["estado"] != "Ocupado":
            return sistema["acTiempoOperario"]
        inicio = sistema["operario"]["inicioOcupacion"] or sistema["reloj"]
        return sistema["acTiempoOperario"] + max(0.0, tiempo_final - inicio)

    def guardar_fila(fila: List[Any], es_final: bool = False) -> None:
        nonlocal filas_guardadas_desde_inicio, fila_numero_global
        fila_numero_global += 1
        reloj = fila[COL["RELOJ"]]
        if fila[COL["EVENTO"]] == "Inicializacion" or es_final:
            filas_guardadas.append({
                "id": fila_numero_global,
                "iteracion": iteracion,
                "valores": fila.copy(),
            })
            return

        if reloj < hora_inicio or filas_guardadas_desde_inicio >= cant_filas:
            return

        filas_guardadas_desde_inicio += 1
        filas_guardadas.append({
            "id": fila_numero_global,
            "iteracion": iteracion,
            "valores": fila.copy(),
        })

    def max_lotes_activos() -> int:
        maximo = 0
        for fila in filas_guardadas:
            lotes = max(0, (len(fila["valores"]) - CANT_COLUMNAS_FIJAS) // 2)
            maximo = max(maximo, lotes)
        return maximo

    CANT_COLUMNAS_FIJAS = 35
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
        "COLA_EXPRESS": 15,
        "COLA_ESTANDAR": 16,
        "RND_LECTURA": 17,
        "RESULTADO_LECTURA": 18,
        "ESTADO_ESCANER": 17,
        "COLA_ESCANER": 18,
        "RND_ESCANEO": 19,
        "TIEMPO_ESCANEO": 20,
        "FIN_ESCANEO": 21,
        "RND_MANUAL": 22,
        "TIEMPO_MANUAL": 23,
        "FIN_MANUAL": 24,
        "ESTADO_OPERARIO": 25,
        "COLA_MANUAL": 26,
        "CONT_EXPRESS": 27,
        "AC_EXPRESS": 28,
        "CONT_ESTANDAR": 29,
        "AC_ESTANDAR": 30,
        "AC_TIEMPO_OPERARIO": 31,
        "MAX_COLA_DESCARGA": 32,
    }
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
    iteracion = 0

    vector_estado[1][COL["EVENTO"]] = "Inicializacion"
    vector_estado[1][COL["RELOJ"]] = sistema["reloj"]
    programar_llegada_express(vector_estado[1])
    programar_llegada_estandar(vector_estado[1])
    escribir_estado_general(vector_estado[1])
    guardar_fila(vector_estado[1])

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

        if evento["tipo"] == "llegada_camioneta_estandar":
            programar_llegada_estandar(fila)
            lote = crear_lote("Estandar")
            if not asignar_descarga(lote["id"], fila):
                encolar_descarga(lote)

        if evento["tipo"] in {"fin_descarga_cinta-1", "fin_descarga_cinta-2"}:
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

        if evento["tipo"] == "fin_escaneo":
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

        if evento["tipo"] == "fin_procesamiento_manual":
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

    tiempo_cierre = parametros.tiempoMax
    ac_operario_cierre = tiempo_operario_hasta(parametros.tiempoMax)
    sistema["reloj"] = parametros.tiempoMax

    fila_final = crear_fila_actual("fin_simulacion", parametros.tiempoMax)
    escribir_estado_general(fila_final, incluir_lotes=False, ac_operario_forzado=ac_operario_cierre)
    guardar_fila(fila_final, es_final=True)

    promedio_express = sistema["acTiempoExpress"] / sistema["contExpressTerminados"] if sistema["contExpressTerminados"] else 0.0
    promedio_estandar = sistema["acTiempoEstandar"] / sistema["contEstandarTerminados"] if sistema["contEstandarTerminados"] else 0.0
    porcentaje_operario = (ac_operario_cierre / tiempo_cierre * 100.0) if tiempo_cierre else 0.0

    return {
        "filas": filas_guardadas,
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
