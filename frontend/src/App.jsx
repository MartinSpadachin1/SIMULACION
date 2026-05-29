import { useCallback, useMemo, useState } from 'react'
import './App.css'

const INFINITO = Infinity

// Posiciones fijas del vector de estado. La parte de lotes se agrega al final
// porque crece o se achica segun los lotes temporales que sigan dentro del sistema.
const COL = Object.freeze({
  EVENTO: 0,
  RELOJ: 1,
  RND_EXPRESS: 2,
  TIEMPO_EXPRESS: 3,
  PROX_EXPRESS: 4,
  RND_ESTANDAR: 5,
  TIEMPO_ESTANDAR: 6,
  PROX_ESTANDAR: 7,
  RND_DESCARGA: 8,
  TIEMPO_DESCARGA: 9,
  FIN_DESCARGA_CINTA_1: 10,
  FIN_DESCARGA_CINTA_2: 11,
  ESTADO_CINTA_1: 12,
  ESTADO_CINTA_2: 13,
  COLA_DESCARGA: 14,
  RND_LECTURA: 15,
  RESULTADO_LECTURA: 16,
  ESTADO_ESCANER: 17,
  COLA_ESCANER: 18,
  RND_ESCANEO: 19,
  TIEMPO_ESCANEO: 20,
  FIN_ESCANEO: 21,
  RND_MANUAL: 22,
  TIEMPO_MANUAL: 23,
  FIN_MANUAL: 24,
  ESTADO_OPERARIO: 25,
  COLA_MANUAL: 26,
  CONT_EXPRESS: 27,
  AC_EXPRESS: 28,
  CONT_ESTANDAR: 29,
  AC_ESTANDAR: 30,
  AC_TIEMPO_OPERARIO: 31,
  MAX_COLA_DESCARGA: 32,
})

const CANT_COLUMNAS_FIJAS = 33

const COLUMNAS_VECTOR = [
  'Evento',
  'Reloj',
  'RND',
  'tiempo',
  'proxima',
  'RND',
  'tiempo',
  'proxima',
  'RND',
  'tiempo',
  'fin_descarga_cinta-1',
  'fin_descarga_cinta-2',
  'Estado',
  'Estado',
  'Cola',
  'RND',
  'Resultado',
  'Estado',
  'Cola',
  'RND',
  'Tiempo',
  'fin_escaneo',
  'RND',
  'Tiempo',
  'fin_procesamiento_manual',
  'Estado',
  'Cola',
  'Cont.',
  'Ac.',
  'Cont.',
  'Ac.',
  'Ac. Tiempo ocupado',
  'Cant Max.',
]

const GRUPOS_VECTOR = [
  { label: '', span: 2 },
  { label: 'llegada_camioneta_express', span: 3 },
  { label: 'llegada_camioneta_estandar', span: 3 },
  { label: 'fin_descarga_inicial(i)', span: 4 },
  { label: 'Cinta descarga', span: 3 },
  { label: 'Lectura', span: 4 },
  { label: 'Escaner', span: 3 },
  { label: 'fin_procesamiento_manual', span: 3 },
  { label: 'Operario', span: 2 },
  { label: '1.', span: 2 },
  { label: '2.', span: 2 },
  { label: '3.', span: 1 },
  { label: '', span: 1 },
]

const COLUMNAS_TRANSITORIAS = [
  COL.RND_EXPRESS,
  COL.TIEMPO_EXPRESS,
  COL.RND_ESTANDAR,
  COL.TIEMPO_ESTANDAR,
  COL.RND_DESCARGA,
  COL.TIEMPO_DESCARGA,
  COL.RND_LECTURA,
  COL.RESULTADO_LECTURA,
  COL.RND_ESCANEO,
  COL.TIEMPO_ESCANEO,
  COL.RND_MANUAL,
  COL.TIEMPO_MANUAL,
]

function limpiarProbabilidad(valor) {
  return Math.min(1, Math.max(0, Number.isFinite(valor) ? valor : 0))
}

function aleatorioExponencial(media) {
  const rnd = Math.random()
  return {
    rnd,
    tiempo: -media * Math.log(1 - rnd),
  }
}

function aleatorioUniforme(min, max) {
  const rnd = Math.random()
  return {
    rnd,
    tiempo: min + rnd * (max - min),
  }
}

function crearServidor() {
  return {
    estado: 'Libre',
    fin: null,
    loteId: null,
    inicioOcupacion: null,
  }
}

function crearFilaVacia() {
  return Array(CANT_COLUMNAS_FIJAS).fill('')
}

function prepararFilaDesdeAnterior(filaAnterior) {
  const fila = filaAnterior.slice(0, CANT_COLUMNAS_FIJAS)
  COLUMNAS_TRANSITORIAS.forEach((columna) => {
    fila[columna] = ''
  })
  return fila
}

function tiempoEvento(valor) {
  return valor === null || valor === undefined ? INFINITO : valor
}

function formatearNumero(valor) {
  if (valor === null || valor === undefined || valor === '') return '-'
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor.toFixed(2) : '-'
  return String(valor)
}

function simular(parametros) {
  const {
    tiempoMax,
    maxIter,
    mediaExpress,
    mediaEstandar,
    cintaMin,
    cintaMax,
    escanerMin,
    escanerMax,
    manualBase,
    manualVar,
    pRechazo,
  } = parametros

  const limiteIteraciones = Math.min(Math.max(0, maxIter), 100000)
  const probabilidadRechazo = limpiarProbabilidad(pRechazo)
  const probabilidadAceptacion = 1 - probabilidadRechazo
  const minManual = Math.max(0.1, manualBase - manualVar)
  const maxManual = Math.max(minManual, manualBase + manualVar)

  // Estado permanente del sistema: recursos, colas, acumuladores y lotes activos.
  const sistema = {
    reloj: 0,
    proximaExpress: null,
    proximaEstandar: null,
    cinta1: crearServidor(),
    cinta2: crearServidor(),
    escaner: crearServidor(),
    operario: crearServidor(),
    colaDescarga: [],
    colaEscaner: [],
    colaManual: [],
    lotesActivos: new Map(),
    proximoLoteId: 1,
    totalExpressIngresados: 0,
    totalEstandarIngresados: 0,
    contExpressTerminados: 0,
    contEstandarTerminados: 0,
    acTiempoExpress: 0,
    acTiempoEstandar: 0,
    acTiempoOperario: 0,
    maxColaDescarga: 0,
  }

  // El vector de estado que se usa para calcular tiene siempre dos filas:
  // posicion 0 = fila anterior, posicion 1 = fila actual.
  const vectorEstado = [crearFilaVacia(), crearFilaVacia()]
  const filasGuardadas = []
  let iteracion = 0

  function guardarFila(fila) {
    filasGuardadas.push({
      id: filasGuardadas.length,
      iteracion,
      valores: fila.slice(),
    })
  }

  function obtenerCintaLibre() {
    if (sistema.cinta1.estado === 'Libre') return sistema.cinta1
    if (sistema.cinta2.estado === 'Libre') return sistema.cinta2
    return null
  }

  function escribirEstadoGeneral(fila, incluirLotes = true, acOperarioForzado = null) {
    fila[COL.PROX_EXPRESS] = sistema.proximaExpress
    fila[COL.PROX_ESTANDAR] = sistema.proximaEstandar
    fila[COL.FIN_DESCARGA_CINTA_1] = sistema.cinta1.fin
    fila[COL.FIN_DESCARGA_CINTA_2] = sistema.cinta2.fin
    fila[COL.ESTADO_CINTA_1] = sistema.cinta1.estado
    fila[COL.ESTADO_CINTA_2] = sistema.cinta2.estado
    fila[COL.COLA_DESCARGA] = sistema.colaDescarga.length
    fila[COL.ESTADO_ESCANER] = sistema.escaner.estado
    fila[COL.COLA_ESCANER] = sistema.colaEscaner.length
    fila[COL.FIN_ESCANEO] = sistema.escaner.fin
    fila[COL.FIN_MANUAL] = sistema.operario.fin
    fila[COL.ESTADO_OPERARIO] = sistema.operario.estado
    fila[COL.COLA_MANUAL] = sistema.colaManual.length
    fila[COL.CONT_EXPRESS] = sistema.contExpressTerminados
    fila[COL.AC_EXPRESS] = sistema.acTiempoExpress
    fila[COL.CONT_ESTANDAR] = sistema.contEstandarTerminados
    fila[COL.AC_ESTANDAR] = sistema.acTiempoEstandar
    fila[COL.AC_TIEMPO_OPERARIO] = acOperarioForzado ?? sistema.acTiempoOperario
    fila[COL.MAX_COLA_DESCARGA] = sistema.maxColaDescarga

    fila.length = CANT_COLUMNAS_FIJAS
    if (!incluirLotes) return

    // Los lotes temporales solo existen mientras estan dentro del sistema.
    // Por eso este bloque se arma de nuevo en cada fila y se reduce al terminar un lote.
    Array.from(sistema.lotesActivos.values()).forEach((lote) => {
      fila.push(lote.estado)
      fila.push(lote.tiempoEntrada)
    })
  }

  function programarLlegadaExpress(fila) {
    const llegada = aleatorioExponencial(mediaExpress)
    sistema.proximaExpress = sistema.reloj + llegada.tiempo
    fila[COL.RND_EXPRESS] = llegada.rnd
    fila[COL.TIEMPO_EXPRESS] = llegada.tiempo
  }

  function programarLlegadaEstandar(fila) {
    const llegada = aleatorioExponencial(mediaEstandar)
    sistema.proximaEstandar = sistema.reloj + llegada.tiempo
    fila[COL.RND_ESTANDAR] = llegada.rnd
    fila[COL.TIEMPO_ESTANDAR] = llegada.tiempo
  }

  function crearLote(tipo) {
    const lote = {
      id: sistema.proximoLoteId,
      tipo,
      estado: 'Esperando descarga',
      horaLlegada: sistema.reloj,
      tiempoEntrada: sistema.reloj,
    }
    sistema.proximoLoteId += 1
    sistema.lotesActivos.set(lote.id, lote)

    if (tipo === 'Express') sistema.totalExpressIngresados += 1
    if (tipo === 'Estandar') sistema.totalEstandarIngresados += 1

    return lote
  }

  function encolarDescarga(lote) {
    lote.estado = 'Esperando descarga'

    // Prioridad estricta: los Express pasan delante de los Estandar,
    // pero se mantiene el orden de llegada entre camionetas del mismo tipo.
    if (lote.tipo === 'Express') {
      const primerEstandar = sistema.colaDescarga.findIndex((loteId) => sistema.lotesActivos.get(loteId)?.tipo === 'Estandar')
      if (primerEstandar === -1) sistema.colaDescarga.push(lote.id)
      else sistema.colaDescarga.splice(primerEstandar, 0, lote.id)
    } else {
      sistema.colaDescarga.push(lote.id)
    }

    sistema.maxColaDescarga = Math.max(sistema.maxColaDescarga, sistema.colaDescarga.length)
  }

  function asignarDescarga(loteId, fila, cintaPreferida = null) {
    const cinta = cintaPreferida?.estado === 'Libre' ? cintaPreferida : obtenerCintaLibre()
    const lote = sistema.lotesActivos.get(loteId)
    if (!cinta || !lote) return false

    const descarga = aleatorioUniforme(cintaMin, cintaMax)
    cinta.estado = 'Ocupado'
    cinta.fin = sistema.reloj + descarga.tiempo
    cinta.loteId = loteId
    lote.estado = 'Descargando'

    fila[COL.RND_DESCARGA] = descarga.rnd
    fila[COL.TIEMPO_DESCARGA] = descarga.tiempo
    return true
  }

  function tomarSiguienteDescarga(fila, cintaLiberada) {
    if (sistema.colaDescarga.length === 0) return
    const loteId = sistema.colaDescarga.shift()
    asignarDescarga(loteId, fila, cintaLiberada)
  }

  function iniciarEscanerSiPuede(fila) {
    if (sistema.escaner.estado !== 'Libre' || sistema.colaEscaner.length === 0) return

    const loteId = sistema.colaEscaner.shift()
    const lote = sistema.lotesActivos.get(loteId)
    if (!lote) return

    const escaneo = aleatorioUniforme(escanerMin, escanerMax)
    sistema.escaner.estado = 'Ocupado'
    sistema.escaner.fin = sistema.reloj + escaneo.tiempo
    sistema.escaner.loteId = loteId
    lote.estado = 'En escaneo'

    fila[COL.RND_ESCANEO] = escaneo.rnd
    fila[COL.TIEMPO_ESCANEO] = escaneo.tiempo
  }

  function iniciarOperarioSiPuede(fila) {
    if (sistema.operario.estado !== 'Libre' || sistema.colaManual.length === 0) return

    const loteId = sistema.colaManual.shift()
    const lote = sistema.lotesActivos.get(loteId)
    if (!lote) return

    const procesoManual = aleatorioUniforme(minManual, maxManual)
    sistema.operario.estado = 'Ocupado'
    sistema.operario.fin = sistema.reloj + procesoManual.tiempo
    sistema.operario.loteId = loteId
    sistema.operario.inicioOcupacion = sistema.reloj
    lote.estado = 'En procesamiento manual'

    fila[COL.RND_MANUAL] = procesoManual.rnd
    fila[COL.TIEMPO_MANUAL] = procesoManual.tiempo
  }

  function finalizarLote(loteId) {
    const lote = sistema.lotesActivos.get(loteId)
    if (!lote) return

    const tiempoSistema = sistema.reloj - lote.horaLlegada
    if (lote.tipo === 'Express') {
      sistema.contExpressTerminados += 1
      sistema.acTiempoExpress += tiempoSistema
    } else {
      sistema.contEstandarTerminados += 1
      sistema.acTiempoEstandar += tiempoSistema
    }

    sistema.lotesActivos.delete(loteId)
  }

  function elegirProximoEvento() {
    const candidatos = [
      { tipo: 'llegada_camioneta_express', tiempo: tiempoEvento(sistema.proximaExpress), prioridad: 1 },
      { tipo: 'llegada_camioneta_estandar', tiempo: tiempoEvento(sistema.proximaEstandar), prioridad: 2 },
      { tipo: 'fin_descarga_cinta-1', tiempo: tiempoEvento(sistema.cinta1.fin), prioridad: 3 },
      { tipo: 'fin_descarga_cinta-2', tiempo: tiempoEvento(sistema.cinta2.fin), prioridad: 4 },
      { tipo: 'fin_escaneo', tiempo: tiempoEvento(sistema.escaner.fin), prioridad: 5 },
      { tipo: 'fin_procesamiento_manual', tiempo: tiempoEvento(sistema.operario.fin), prioridad: 6 },
    ].filter((evento) => Number.isFinite(evento.tiempo))

    if (candidatos.length === 0) return null
    candidatos.sort((a, b) => a.tiempo - b.tiempo || a.prioridad - b.prioridad)
    return candidatos[0]
  }

  function crearFilaActual(evento, relojEvento) {
    vectorEstado[0] = vectorEstado[1]
    vectorEstado[1] = prepararFilaDesdeAnterior(vectorEstado[0])
    vectorEstado[1][COL.EVENTO] = evento
    vectorEstado[1][COL.RELOJ] = relojEvento
    return vectorEstado[1]
  }

  function tiempoOperarioHasta(tiempoFinal) {
    if (sistema.operario.estado !== 'Ocupado') return sistema.acTiempoOperario
    return sistema.acTiempoOperario + Math.max(0, tiempoFinal - sistema.operario.inicioOcupacion)
  }

  vectorEstado[1][COL.EVENTO] = 'Inicializacion'
  vectorEstado[1][COL.RELOJ] = sistema.reloj
  programarLlegadaExpress(vectorEstado[1])
  programarLlegadaEstandar(vectorEstado[1])
  escribirEstadoGeneral(vectorEstado[1])
  guardarFila(vectorEstado[1])

  while (iteracion < limiteIteraciones) {
    const evento = elegirProximoEvento()
    if (!evento || evento.tiempo > tiempoMax) break

    iteracion += 1
    sistema.reloj = evento.tiempo
    const fila = crearFilaActual(evento.tipo, sistema.reloj)

    if (evento.tipo === 'llegada_camioneta_express') {
      programarLlegadaExpress(fila)
      const lote = crearLote('Express')
      if (!asignarDescarga(lote.id, fila)) encolarDescarga(lote)
    }

    if (evento.tipo === 'llegada_camioneta_estandar') {
      programarLlegadaEstandar(fila)
      const lote = crearLote('Estandar')
      if (!asignarDescarga(lote.id, fila)) encolarDescarga(lote)
    }

    if (evento.tipo === 'fin_descarga_cinta-1' || evento.tipo === 'fin_descarga_cinta-2') {
      const cinta = evento.tipo === 'fin_descarga_cinta-1' ? sistema.cinta1 : sistema.cinta2
      const loteId = cinta.loteId
      const lote = sistema.lotesActivos.get(loteId)

      cinta.estado = 'Libre'
      cinta.fin = null
      cinta.loteId = null

      if (lote) {
        lote.estado = 'Esperando escaneo'
        sistema.colaEscaner.push(lote.id)
      }

      iniciarEscanerSiPuede(fila)
      tomarSiguienteDescarga(fila, cinta)
    }

    if (evento.tipo === 'fin_escaneo') {
      const loteId = sistema.escaner.loteId
      const lote = sistema.lotesActivos.get(loteId)
      const rndLectura = Math.random()
      const rechazado = rndLectura >= probabilidadAceptacion

      sistema.escaner.estado = 'Libre'
      sistema.escaner.fin = null
      sistema.escaner.loteId = null

      fila[COL.RND_LECTURA] = rndLectura
      fila[COL.RESULTADO_LECTURA] = rechazado ? 'Rechazado' : 'Aceptado'

      if (lote && rechazado) {
        lote.estado = 'Esperando procesamiento manual'
        sistema.colaManual.push(lote.id)
        iniciarOperarioSiPuede(fila)
      } else {
        finalizarLote(loteId)
      }

      iniciarEscanerSiPuede(fila)
    }

    if (evento.tipo === 'fin_procesamiento_manual') {
      const loteId = sistema.operario.loteId
      const inicio = sistema.operario.inicioOcupacion ?? sistema.reloj

      sistema.acTiempoOperario += sistema.reloj - inicio
      sistema.operario.estado = 'Libre'
      sistema.operario.fin = null
      sistema.operario.loteId = null
      sistema.operario.inicioOcupacion = null

      finalizarLote(loteId)
      iniciarOperarioSiPuede(fila)
    }

    escribirEstadoGeneral(fila)
    guardarFila(fila)
  }

  let tiempoCierre = sistema.reloj
  let acOperarioCierre = tiempoOperarioHasta(tiempoCierre)

  if (sistema.reloj < tiempoMax && iteracion < limiteIteraciones) {
    tiempoCierre = tiempoMax
    acOperarioCierre = tiempoOperarioHasta(tiempoMax)
    sistema.reloj = tiempoMax

    const filaFinal = crearFilaActual('fin_simulacion', tiempoMax)
    escribirEstadoGeneral(filaFinal, false, acOperarioCierre)
    guardarFila(filaFinal)
  }

  const promedioExpress = sistema.contExpressTerminados ? sistema.acTiempoExpress / sistema.contExpressTerminados : 0
  const promedioEstandar = sistema.contEstandarTerminados ? sistema.acTiempoEstandar / sistema.contEstandarTerminados : 0
  const porcentajeOperario = tiempoCierre ? (acOperarioCierre / tiempoCierre) * 100 : 0

  return {
    filas: filasGuardadas,
    maxLotesActivos: filasGuardadas.reduce((maximo, fila) => Math.max(maximo, Math.ceil((fila.valores.length - CANT_COLUMNAS_FIJAS) / 2)), 0),
    resumen: {
      tiempoTotal: tiempoCierre,
      promExpress: promedioExpress,
      promEstandar: promedioEstandar,
      pctOperario: porcentajeOperario,
      maxColaCintas: sistema.maxColaDescarga,
      totalLotes: sistema.totalExpressIngresados + sistema.totalEstandarIngresados,
      totalExpress: sistema.totalExpressIngresados,
      totalEstandar: sistema.totalEstandarIngresados,
      lotesExitExpress: sistema.contExpressTerminados,
      lotesExitEstandar: sistema.contEstandarTerminados,
    },
  }
}

function construirColumnasLotes(cantidadLotes) {
  return Array.from({ length: cantidadLotes }, () => ['Estado', 'Tiempo entrada']).flat()
}

function ParamField({ label, value, onChange, step = 1, min = 0, max }) {
  return (
    <label className="param-field">
      <span>{label}</span>
      <input
        type="number"
        value={value}
        step={step}
        min={min}
        max={max}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  )
}

function StatCard({ label, value, accent }) {
  return (
    <div className={`stat-card ${accent ? 'accent' : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

export default function Aplicacion() {
  const [parametros, setParametros] = useState({
    tiempoMax: 480,
    maxIter: 750,
    mediaExpress: 40,
    mediaEstandar: 25,
    cintaMin: 15,
    cintaMax: 25,
    escanerMin: 2,
    escanerMax: 5,
    manualBase: 12,
    manualVar: 3,
    pRechazo: 0.1,
    horaInicio: 0,
    cantFilas: 15,
  })

  const [resultadoSimulacion, setResultadoSimulacion] = useState(null)
  const [simulando, setSimulando] = useState(false)

  const actualizarParametro = (key) => (value) => setParametros((prev) => ({ ...prev, [key]: value }))

  const manejarSimulacion = useCallback(() => {
    setSimulando(true)
    setTimeout(() => {
      setResultadoSimulacion(simular(parametros))
      setSimulando(false)
    }, 0)
  }, [parametros])

  const filasVisibles = useMemo(() => {
    if (!resultadoSimulacion) return []

    const primera = resultadoSimulacion.filas[0]
    const ultima = resultadoSimulacion.filas[resultadoSimulacion.filas.length - 1]
    const indiceInicio = resultadoSimulacion.filas.findIndex((fila) => fila.valores[COL.RELOJ] >= parametros.horaInicio)
    const seleccion = indiceInicio >= 0 ? resultadoSimulacion.filas.slice(indiceInicio, indiceInicio + parametros.cantFilas) : []
    const filasSinRepetir = new Map()

    ;[primera, ...seleccion, ultima].forEach((fila) => {
      if (fila) filasSinRepetir.set(fila.id, fila)
    })

    return Array.from(filasSinRepetir.values()).sort((a, b) => a.id - b.id)
  }, [resultadoSimulacion, parametros.horaInicio, parametros.cantFilas])

  const cantidadLotesVisible = useMemo(() => {
    return filasVisibles.reduce((maximo, fila) => Math.max(maximo, Math.ceil((fila.valores.length - CANT_COLUMNAS_FIJAS) / 2)), 0)
  }, [filasVisibles])

  const columnasLotes = useMemo(() => construirColumnasLotes(cantidadLotesVisible), [cantidadLotesVisible])
  const columnas = useMemo(() => [...COLUMNAS_VECTOR, ...columnasLotes], [columnasLotes])
  const idUltimaFila = filasVisibles[filasVisibles.length - 1]?.id

  return (
    <div className="app">
      <header className="top-bar">
        <div>
          <div className="title">Simulacion Expreso Norte</div>
          <div className="subtitle">Modelo de camionetas, descarga, escaner y procesamiento manual</div>
        </div>
        <div className="top-actions">
          <button className="run-button" onClick={manejarSimulacion} disabled={simulando}>
            {simulando ? 'Simulando...' : 'Ejecutar simulacion'}
          </button>
        </div>
      </header>

      <div className="body-layout">
        <aside className="panel side-panel">
          <div className="panel-title">Parametros</div>
          <ParamField label="Tiempo max. (min)" value={parametros.tiempoMax} onChange={actualizarParametro('tiempoMax')} min={1} />
          <ParamField label="Iteraciones" value={parametros.maxIter} onChange={actualizarParametro('maxIter')} min={10} max={100000} />
          <div className="section-title">Arribos</div>
          <ParamField label="Media Express" value={parametros.mediaExpress} onChange={actualizarParametro('mediaExpress')} min={1} />
          <ParamField label="Media Estandar" value={parametros.mediaEstandar} onChange={actualizarParametro('mediaEstandar')} min={1} />
          <div className="section-title">Cintas</div>
          <ParamField label="Min descarga" value={parametros.cintaMin} onChange={actualizarParametro('cintaMin')} min={1} />
          <ParamField label="Max descarga" value={parametros.cintaMax} onChange={actualizarParametro('cintaMax')} min={parametros.cintaMin} />
          <div className="section-title">Escaner</div>
          <ParamField label="Min escaner" value={parametros.escanerMin} onChange={actualizarParametro('escanerMin')} min={1} />
          <ParamField label="Max escaner" value={parametros.escanerMax} onChange={actualizarParametro('escanerMax')} min={parametros.escanerMin} />
          <div className="section-title">Manual</div>
          <ParamField label="Base manual" value={parametros.manualBase} onChange={actualizarParametro('manualBase')} min={1} />
          <ParamField label="Variacion" value={parametros.manualVar} onChange={actualizarParametro('manualVar')} min={0} />
          <ParamField label="P. rechazo" value={parametros.pRechazo} onChange={actualizarParametro('pRechazo')} step={0.01} min={0} max={1} />
          <div className="section-title">Presentacion</div>
          <ParamField label="Hora inicio" value={parametros.horaInicio} onChange={actualizarParametro('horaInicio')} min={0} />
          <ParamField label="Filas" value={parametros.cantFilas} onChange={actualizarParametro('cantFilas')} min={5} />
        </aside>

        <main className="panel content-panel">
          <div className="stats-grid">
            <StatCard label="Tiempo simulado" value={resultadoSimulacion ? `${resultadoSimulacion.resumen.tiempoTotal.toFixed(2)} min` : '-'} />
            <StatCard label="Prom. Express" value={resultadoSimulacion ? `${resultadoSimulacion.resumen.promExpress.toFixed(2)} min` : '-'} />
            <StatCard label="Prom. Estandar" value={resultadoSimulacion ? `${resultadoSimulacion.resumen.promEstandar.toFixed(2)} min` : '-'} />
            <StatCard label="Uso operario" value={resultadoSimulacion ? `${resultadoSimulacion.resumen.pctOperario.toFixed(2)} %` : '-'} accent />
            <StatCard label="Max cola descarga" value={resultadoSimulacion ? resultadoSimulacion.resumen.maxColaCintas : '-'} />
            <StatCard label="Total camionetas" value={resultadoSimulacion ? resultadoSimulacion.resumen.totalLotes : '-'} />
          </div>

          {!resultadoSimulacion ? (
            <div className="placeholder">
              <p>Ejecuta la simulacion para generar el vector de estado.</p>
            </div>
          ) : (
            <div className="table-wrapper">
              <div className="table-meta">
                <span>{`Mostrando ${filasVisibles.length} filas de ${resultadoSimulacion.filas.length}`}</span>
              </div>
              <div className="table-scroll">
                <table className="vtable">
                  <thead>
                    <tr className="super-group-row">
                      <th colSpan={CANT_COLUMNAS_FIJAS}></th>
                      {cantidadLotesVisible > 0 && <th colSpan={cantidadLotesVisible * 2}>Lotes</th>}
                    </tr>
                    <tr className="group-row">
                      {GRUPOS_VECTOR.map((grupo, index) => (
                        <th key={`${grupo.label}-${index}`} colSpan={grupo.span}>
                          {grupo.label}
                        </th>
                      ))}
                      {Array.from({ length: cantidadLotesVisible }, (_, index) => (
                        <th key={`lote-grupo-${index}`} colSpan={2}>{`${index + 1}.`}</th>
                      ))}
                    </tr>
                    <tr className="column-row">
                      {columnas.map((label, index) => (
                        <th key={`${label}-${index}`}>{label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filasVisibles.map((fila) => (
                      <tr key={fila.id} className={fila.id === idUltimaFila ? 'sticky-last-row' : ''}>
                        {columnas.map((_, index) => (
                          <td key={`${fila.id}-${index}`}>{formatearNumero(fila.valores[index])}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
