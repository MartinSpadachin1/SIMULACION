import { useCallback, useMemo, useState } from 'react'
import './App.css'

// Genera un número aleatorio exponencial usando transformada inversa.
function aleatorioExponencial(media) {
  const r = Math.random()
  return {
    r,
    val: -media * Math.log(Math.max(r, 1e-10)),
  }
}

// Ejecuta la simulación de eventos discretos para el sistema.
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

  const cinta1 = { estado: 'LIBRE', finEn: Infinity, loteId: null }
  const cinta2 = { estado: 'LIBRE', finEn: Infinity, loteId: null }
  const escaner = { estado: 'LIBRE', finEn: Infinity, loteId: null }
  const operario = { estado: 'LIBRE', finEn: Infinity, loteId: null }

  const colaCintas = []
  const colaEscaner = []
  const colaManual = []
  const lotes = {}

  let contadorLotes = 0
  let proximaLlegadaExpress = null
  let proximaLlegadaEstandar = null
  let contadorExpress = 0
  let contadorEstandar = 0
  let acumuladoTiempoOperario = 0
  let maxColaCintas = 0
  let sumaTiempoExpress = 0
  let sumaTiempoEstandar = 0
  let lotesSalidaExpress = 0
  let lotesSalidaEstandar = 0
  let reloj = 0
  let iteracion = 0
  let filaRnd = {}
  const filas = []

  function construirFilaDetalleLote() {
    const detalle = {}
    for (let i = 1; i <= contadorLotes; i += 1) {
      const lote = lotes[i]
      if (!lote) {
        detalle[`lote${i}_tipo`] = '-'
        detalle[`lote${i}_llegada`] = '-'
        detalle[`lote${i}_tSistema`] = '-'
        detalle[`lote${i}_estado`] = '-'
        continue
      }

      const estadoCorto = (() => {
        switch (lote.estado) {
          case 'CINTA1':
            return 'C1'
          case 'CINTA2':
            return 'C2'
          case 'ESCANER':
            return 'ESC.'
          case 'MANUAL':
            return 'MAN'
          case 'COLA_CINTAS':
            return 'QC'
          case 'COLA_ESCANER':
            return 'QE'
          case 'COLA_MANUAL':
            return 'QM'
          case 'TERMINADO':
            return 'FIN'
          default:
            return lote.estado
        }
      })()

      const tiempoSistema = lote.estado === 'TERMINADO' ? lote.tiempoSistema : reloj - lote.horaLlegada
      detalle[`lote${i}_tipo`] = lote.tipo
      detalle[`lote${i}_llegada`] = lote.horaLlegada
      detalle[`lote${i}_tSistema`] = Number.isFinite(tiempoSistema) ? tiempoSistema : '-'
      detalle[`lote${i}_estado`] = estadoCorto
    }
    return detalle
  }

  const filaEstado = (evento, extras = {}) => ({
    iteracion,
    reloj,
    evento,
    proxExpress: proximaLlegadaExpress?.tiempo ?? null,
    proxEstandar: proximaLlegadaEstandar?.tiempo ?? null,
    proxFinCinta1: cinta1.finEn,
    proxFinCinta2: cinta2.finEn,
    proxFinEscaner: escaner.finEn,
    proxFinManual: operario.finEn,
    estadoCinta1: cinta1.estado,
    estadoCinta2: cinta2.estado,
    estadoEscaner: escaner.estado,
    estadoOperario: operario.estado,
    cantColaCintas: colaCintas.length,
    cantColaEscaner: colaEscaner.length,
    cantColaManual: colaManual.length,
    contadorExpress,
    contadorEstandar,
    acumuladoTiempoOperario,
    maxColaCintas,
    ...filaRnd,
    ...construirFilaDetalleLote(),
    ...extras,
  })

  function crearLote(tipo) {
    contadorLotes += 1
    const lote = {
      id: contadorLotes,
      tipo,
      horaLlegada: reloj,
      estado: 'CREADO',
      tiempoSistema: 0,
    }
    lotes[lote.id] = lote
    return lote
  }

  function finalizarLote(id) {
    const lote = lotes[id]
    if (!lote || lote.estado === 'TERMINADO') return
    lote.estado = 'TERMINADO'
    lote.tiempoSistema = reloj - lote.horaLlegada
    if (lote.tipo === 'EXPRESS') {
      sumaTiempoExpress += lote.tiempoSistema
      lotesSalidaExpress += 1
    } else {
      sumaTiempoEstandar += lote.tiempoSistema
      lotesSalidaEstandar += 1
    }
  }

  function obtenerCintaDisponible() {
    if (cinta1.estado === 'LIBRE') return cinta1
    if (cinta2.estado === 'LIBRE') return cinta2
    return null
  }

  function asignarCintaLibre(loteId) {
    const cinta = obtenerCintaDisponible()
    if (!cinta) return false

    const rnd = Math.random()
    const t = cintaMin + rnd * (cintaMax - cintaMin)

    cinta.estado = 'OCUPADO'
    cinta.finEn = reloj + t
    cinta.loteId = loteId

    filaRnd.rndCinta = rnd
    filaRnd.tCinta = t

    if (lotes[loteId]) {
      lotes[loteId].estado = cinta === cinta1 ? 'CINTA1' : 'CINTA2'
    }
    return true
  }

  function asignarEscanerLibre() {
    if (escaner.estado !== 'LIBRE' || colaEscaner.length === 0) return false

    const loteId = colaEscaner.shift()
    const rnd = Math.random()
    const t = escanerMin + rnd * (escanerMax - escanerMin)

    escaner.estado = 'OCUPADO'
    escaner.finEn = reloj + t
    escaner.loteId = loteId

    filaRnd.rndEscaner = rnd
    filaRnd.tEscaner = t

    if (lotes[loteId]) {
      lotes[loteId].estado = 'ESCANER'
    }
    return true
  }

  function asignarOperarioLibre() {
    if (operario.estado !== 'LIBRE' || colaManual.length === 0) return false

    const loteId = colaManual.shift()
    const minManual = Math.max(0.1, manualBase - manualVar)
    const maxManual = manualBase + manualVar
    const rnd = Math.random()
    const t = minManual + rnd * (maxManual - minManual)

    operario.estado = 'OCUPADO'
    operario.finEn = reloj + t
    operario.loteId = loteId
    operario.inicioOcup = reloj

    filaRnd.rndManual = rnd
    filaRnd.tManual = t

    if (lotes[loteId]) {
      lotes[loteId].estado = 'MANUAL'
    }
    return true
  }

  const registrarEvento = (evento, extras = {}) => filas.push(filaEstado(evento, extras))

  const llegadaExpress = aleatorioExponencial(mediaExpress)
  proximaLlegadaExpress = { tiempo: reloj + llegadaExpress.val }
  filaRnd = {
    rndLlegadaExpress: llegadaExpress.r,
    tLlegadaExpress: llegadaExpress.val,
  }

  const llegadaEstandar = aleatorioExponencial(mediaEstandar)
  proximaLlegadaEstandar = { tiempo: reloj + llegadaEstandar.val }
  filaRnd.rndLlegadaEstandar = llegadaEstandar.r
  filaRnd.tLlegadaEstandar = llegadaEstandar.val

  registrarEvento('INICIALIZACIÓN')

  while (iteracion < maxIter) {
    const candidatos = [
      { tipo: 'LLEGADA_EXPRESS', t: proximaLlegadaExpress?.tiempo ?? Infinity },
      { tipo: 'LLEGADA_ESTANDAR', t: proximaLlegadaEstandar?.tiempo ?? Infinity },
      { tipo: 'FIN_CINTA1', t: cinta1.finEn },
      { tipo: 'FIN_CINTA2', t: cinta2.finEn },
      { tipo: 'FIN_ESCANER', t: escaner.finEn },
      { tipo: 'FIN_MANUAL', t: operario.finEn },
    ].filter((c) => Number.isFinite(c.t))

    if (candidatos.length === 0) break
    candidatos.sort((a, b) => a.t - b.t)
    const evento = candidatos[0]
    if (evento.t > tiempoMax) break

    reloj = evento.t
    iteracion += 1
    filaRnd = {}

    if (evento.tipo === 'LLEGADA_EXPRESS') {
      const llegada = aleatorioExponencial(mediaExpress)
      proximaLlegadaExpress = { tiempo: reloj + llegada.val }
      filaRnd.rndLlegadaExpress = llegada.r
      filaRnd.tLlegadaExpress = llegada.val

      const lote = crearLote('EXPRESS')
      contadorExpress += 1
      if (!asignarCintaLibre(lote.id)) {
        lotes[lote.id].estado = 'COLA_CINTAS'
        colaCintas.unshift(lote.id)
        maxColaCintas = Math.max(maxColaCintas, colaCintas.length)
      }
      registrarEvento('LLEGADA EXPRESS')
    } else if (evento.tipo === 'LLEGADA_ESTANDAR') {
      const llegada = aleatorioExponencial(mediaEstandar)
      proximaLlegadaEstandar = { tiempo: reloj + llegada.val }
      filaRnd.rndLlegadaEstandar = llegada.r
      filaRnd.tLlegadaEstandar = llegada.val

      const lote = crearLote('ESTÁNDAR')
      contadorEstandar += 1
      if (!asignarCintaLibre(lote.id)) {
        lotes[lote.id].estado = 'COLA_CINTAS'
        colaCintas.push(lote.id)
        maxColaCintas = Math.max(maxColaCintas, colaCintas.length)
      }
      registrarEvento('LLEGADA ESTÁNDAR')
    } else if (evento.tipo === 'FIN_CINTA1' || evento.tipo === 'FIN_CINTA2') {
      const cinta = evento.tipo === 'FIN_CINTA1' ? cinta1 : cinta2
      const loteId = cinta.loteId
      cinta.estado = 'LIBRE'
      cinta.finEn = Infinity
      cinta.loteId = null
      if (lotes[loteId]) {
        lotes[loteId].estado = 'COLA_ESCANER'
      }
      colaEscaner.push(loteId)
      asignarEscanerLibre()

      if (colaCintas.length > 0) {
        const siguiente = colaCintas.shift()
        if (lotes[siguiente]) {
          lotes[siguiente].estado = cinta === cinta1 ? 'CINTA1' : 'CINTA2'
        }
        asignarCintaLibre(siguiente)
      }
      registrarEvento(evento.tipo)
    } else if (evento.tipo === 'FIN_ESCANER') {
      const loteId = escaner.loteId
      escaner.estado = 'LIBRE'
      escaner.finEn = Infinity
      escaner.loteId = null
      const rechazo = Math.random() < pRechazo
      filaRnd.rndRechazo = rechazo ? 1 : 0
      filaRnd.rechazado = rechazo ? 'Sí' : 'No'

      if (rechazo) {
        if (lotes[loteId]) {
          lotes[loteId].estado = 'COLA_MANUAL'
        }
        colaManual.push(loteId)
        asignarOperarioLibre()
      } else {
        finalizarLote(loteId)
      }
      asignarEscanerLibre()
      registrarEvento('FIN ESCÁNER', {
        rechazado: filaRnd.rechazado,
      })
    } else if (evento.tipo === 'FIN_MANUAL') {
      const loteId = operario.loteId
      const duracion = operario.finEn - (operario.inicioOcup ?? reloj)
      acumuladoTiempoOperario += duracion
      operario.estado = 'LIBRE'
      operario.finEn = Infinity
      operario.loteId = null
      finalizarLote(loteId)
      asignarOperarioLibre()
      registrarEvento('FIN MANUAL')
    }

    if (cinta1.finEn !== Infinity) {
      filaRnd.minFinCinta1 = cinta1.finEn
    }
    if (cinta2.finEn !== Infinity) {
      filaRnd.minFinCinta2 = cinta2.finEn
    }
    if (escaner.finEn !== Infinity) {
      filaRnd.minFinEscaner = escaner.finEn
    }
    if (operario.finEn !== Infinity) {
      filaRnd.minFinManual = operario.finEn
    }
  }

  const tiempoSimulacion = reloj
  const promedioExpress = lotesSalidaExpress ? sumaTiempoExpress / lotesSalidaExpress : 0
  const promedioEstandar = lotesSalidaEstandar ? sumaTiempoEstandar / lotesSalidaEstandar : 0
  const porcentajeOperario = tiempoSimulacion ? (acumuladoTiempoOperario / tiempoSimulacion) * 100 : 0

  return {
    filas,
    maximoLoteId: contadorLotes,
    resumen: {
      tiempoTotal: tiempoSimulacion,
      promExpress: promedioExpress,
      promEstandar: promedioEstandar,
      pctOperario: porcentajeOperario,
      maxColaCintas,
      totalLotes: contadorLotes,
      totalExpress: contadorExpress,
      totalEstandar: contadorEstandar,
      lotesExitExpress: lotesSalidaExpress,
      lotesExitEstandar: lotesSalidaEstandar,
    },
  }
}

const STATIC_COL_GROUPS = [
  {
    label: 'EVENTO',
    cols: [
      { key: 'iteracion', label: '#' },
      { key: 'reloj', label: 'Reloj' },
      { key: 'evento', label: 'Evento' },
    ],
  },
  {
    label: 'PRÓXIMOS EVENTOS',
    cols: [
      { key: 'proxExpress', label: 'Prox Exp.' },
      { key: 'proxEstandar', label: 'Prox Est.' },
      { key: 'proxFinCinta1', label: 'Fin Cinta 1' },
      { key: 'proxFinCinta2', label: 'Fin Cinta 2' },
      { key: 'proxFinEscaner', label: 'Fin Escáner' },
      { key: 'proxFinManual', label: 'Fin Manual' },
    ],
  },
  {
    label: 'LLEGADAS',
    cols: [
      { key: 'rndLlegadaExpress', label: 'RND Exp.' },
      { key: 'tLlegadaExpress', label: 'T Exp.' },
      { key: 'rndLlegadaEstandar', label: 'RND Est.' },
      { key: 'tLlegadaEstandar', label: 'T Est.' },
    ],
  },
  {
    label: 'TIEMPO EN CINTA',
    cols: [
      { key: 'rndCinta', label: 'RND Cinta' },
      { key: 'tCinta', label: 'T Cinta' },
      { key: 'minFinCinta1', label: 'Fin Cinta 1' },
      { key: 'minFinCinta2', label: 'Fin Cinta 2' },
    ],
  },
  {
    label: 'ESCÁNER',
    cols: [
      { key: 'rndEscaner', label: 'RND Esc.' },
      { key: 'tEscaner', label: 'T Esc.' },
      { key: 'minFinEscaner', label: 'Fin Escáner' },
    ],
  },
  {
    label: 'MANUAL',
    cols: [
      { key: 'rndRechazo', label: 'RND Rech.' },
      { key: 'rechazado', label: 'Rech.' },
      { key: 'rndManual', label: 'RND Manual' },
      { key: 'tManual', label: 'T Manual' },
      { key: 'minFinManual', label: 'Fin Manual' },
    ],
  },
  {
    label: 'ESTADOS',
    cols: [
      { key: 'estadoCinta1', label: 'Cinta 1' },
      { key: 'estadoCinta2', label: 'Cinta 2' },
      { key: 'estadoEscaner', label: 'Escáner' },
      { key: 'estadoOperario', label: 'Operario' },
      { key: 'cantColaCintas', label: 'Cola Cintas' },
      { key: 'cantColaEscaner', label: 'Cola Escáner' },
      { key: 'cantColaManual', label: 'Cola Manual' },
    ],
  },
  {
    label: 'ESTADÍSTICAS',
    cols: [
      { key: 'contadorExpress', label: 'Cont Exp.' },
      { key: 'contadorEstandar', label: 'Cont Est.' },
      { key: 'acumuladoTiempoOperario', label: 'Ac. T. Oper.' },
      { key: 'maxColaCintas', label: 'Max Cola' },
    ],
  },
]

function construirGruposLotes(maximoLoteId) {
  const cols = []
  for (let i = 1; i <= maximoLoteId; i += 1) {
    cols.push({ key: `lote${i}_tipo`, label: `Lote ${i} Tipo` })
    cols.push({ key: `lote${i}_llegada`, label: `Lote ${i} Lleg.` })
    cols.push({ key: `lote${i}_tSistema`, label: `Lote ${i} T.Sis.` })
    cols.push({ key: `lote${i}_estado`, label: `Lote ${i} Est.` })
  }
  return [{ label: 'LOTES', cols }]
}

function flatRow(row, maximoLoteId) {
  const flat = { ...row }
  for (let i = 1; i <= maximoLoteId; i += 1) {
    const keys = [`lote${i}_tipo`, `lote${i}_llegada`, `lote${i}_tSistema`, `lote${i}_estado`]
    keys.forEach((key) => {
      if (!(key in flat)) {
        flat[key] = '-'
      }
    })
  }
  return flat
}

function numFmt(v) {
  if (v === null || v === undefined || v === '') return '-'
  if (typeof v === 'number') return Number.isFinite(v) ? v.toFixed(2) : '-'
  return String(v)
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

  const actualizarParametro = (key) => (value) => setParametros((prev) => ({ ...prev, [key]: value }))
  const [resultadoSimulacion, setResultadoSimulacion] = useState(null)
  const [simulando, setSimulando] = useState(false)

  const manejarSimulacion = useCallback(() => {
    setSimulando(true)
    setTimeout(() => {
      setResultadoSimulacion(simular(parametros))
      setSimulando(false)
    }, 0)
  }, [parametros])

  const gruposColumnas = useMemo(() => {
    if (!resultadoSimulacion) return STATIC_COL_GROUPS
    return [...STATIC_COL_GROUPS, ...construirGruposLotes(resultadoSimulacion.maximoLoteId)]
  }, [resultadoSimulacion])

  const todasColumnas = useMemo(() => gruposColumnas.flatMap((group) => group.cols), [gruposColumnas])

  const filasVisibles = useMemo(() => {
    if (!resultadoSimulacion) return []
    const primero = resultadoSimulacion.filas[0]
    const ultimo = resultadoSimulacion.filas[resultadoSimulacion.filas.length - 1]
    const indiceInicio = resultadoSimulacion.filas.findIndex((row) => row.reloj >= parametros.horaInicio)
    const seleccion = indiceInicio >= 0 ? resultadoSimulacion.filas.slice(indiceInicio, indiceInicio + parametros.cantFilas) : []
    const map = new Map()
    ;[primero, ...seleccion, ultimo].forEach((row) => {
      if (row && !map.has(row.iteracion)) map.set(row.iteracion, row)
    })
    return Array.from(map.values()).map((row) => flatRow(row, resultadoSimulacion.maximoLoteId))
  }, [resultadoSimulacion, parametros.horaInicio, parametros.cantFilas])

  const ultimaIteracionVisible = filasVisibles[filasVisibles.length - 1]?.iteracion

  return (
    <div className="app">
      <header className="top-bar">
        <div>
          <div className="title">Simulación Expreso Norte</div>
          <div className="subtitle">Modelo de arribos, cintas, escáner y proceso manual</div>
        </div>
        <div className="top-actions">
          <button className="run-button" onClick={manejarSimulacion} disabled={simulando}>
            {simulando ? 'Simulando...' : 'Ejecutar Simulación'}
          </button>
        </div>
      </header>

      <div className="body-layout">
        <aside className="panel side-panel">
          <div className="panel-title">Parámetros</div>
          <ParamField label="Tiempo máx. (min)" value={parametros.tiempoMax} onChange={actualizarParametro('tiempoMax')} min={1} />
          <ParamField label="Iteraciones" value={parametros.maxIter} onChange={actualizarParametro('maxIter')} min={10} />
          <div className="section-title">Arribos</div>
          <ParamField label="Media Expreso" value={parametros.mediaExpress} onChange={actualizarParametro('mediaExpress')} min={1} />
          <ParamField label="Media Estándar" value={parametros.mediaEstandar} onChange={actualizarParametro('mediaEstandar')} min={1} />
          <div className="section-title">Cintas</div>
          <ParamField label="Min Cinta" value={parametros.cintaMin} onChange={actualizarParametro('cintaMin')} min={1} />
          <ParamField label="Max Cinta" value={parametros.cintaMax} onChange={actualizarParametro('cintaMax')} min={parametros.cintaMin} />
          <div className="section-title">Escáner</div>
          <ParamField label="Min Escáner" value={parametros.escanerMin} onChange={actualizarParametro('escanerMin')} min={1} />
          <ParamField label="Max Escáner" value={parametros.escanerMax} onChange={actualizarParametro('escanerMax')} min={parametros.escanerMin} />
          <div className="section-title">Manual</div>
          <ParamField label="Base Manual" value={parametros.manualBase} onChange={actualizarParametro('manualBase')} min={1} />
          <ParamField label="Variación" value={parametros.manualVar} onChange={actualizarParametro('manualVar')} min={0} />
          <ParamField label="P. Rechazo" value={parametros.pRechazo} onChange={actualizarParametro('pRechazo')} step={0.01} min={0} max={1} />
          <div className="section-title">Presentación</div>
          <ParamField label="Hora inicio" value={parametros.horaInicio} onChange={actualizarParametro('horaInicio')} min={0} />
          <ParamField label="Filas" value={parametros.cantFilas} onChange={actualizarParametro('cantFilas')} min={5} />
        </aside>

        <main className="panel content-panel">
          <div className="stats-grid">
            <StatCard label="Tiempo simulado" value={resultadoSimulacion ? `${resultadoSimulacion.resumen.tiempoTotal.toFixed(2)} min` : '-'} />
            <StatCard label="Prom. Expreso" value={resultadoSimulacion ? `${resultadoSimulacion.resumen.promExpress.toFixed(2)} min` : '-'} />
            <StatCard label="Prom. Estándar" value={resultadoSimulacion ? `${resultadoSimulacion.resumen.promEstandar.toFixed(2)} min` : '-'} />
            <StatCard label="Uso operario" value={resultadoSimulacion ? `${resultadoSimulacion.resumen.pctOperario.toFixed(2)} %` : '-'} accent />
            <StatCard label="Máx cola cintas" value={resultadoSimulacion ? resultadoSimulacion.resumen.maxColaCintas : '-'} />
            <StatCard label="Total camiones" value={resultadoSimulacion ? resultadoSimulacion.resumen.totalLotes : '-'} />
          </div>

          {!resultadoSimulacion ? (
            <div className="placeholder">
              <p>Presiona "Ejecutar Simulación" para generar resultados.</p>
            </div>
          ) : (
            <div className="table-wrapper">
              <div className="table-meta">
                <span>{`Mostrando ${filasVisibles.length} filas de ${resultadoSimulacion.filas.length}`}</span>
              </div>
              <div className="table-scroll">
                <table className="vtable">
                  <thead>
                    <tr>
                      {todasColumnas.map((col) => (
                        <th key={col.key}>{col.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filasVisibles.map((row) => (
                      <tr key={row.iteracion} className={row.iteracion === ultimaIteracionVisible ? 'sticky-last-row' : ''}>
                        {todasColumnas.map((col) => (
                          <td key={col.key}>{numFmt(row[col.key])}</td>
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
