import { useCallback, useMemo, useState } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import './App.css'

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:8000'

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
  ESTADO_ESCANER: 15,
  COLA_ESCANER: 16,
  RND_ESCANEO: 17,
  TIEMPO_ESCANEO: 18,
  FIN_ESCANEO: 19,
  RND_MANUAL: 20,
  TIEMPO_MANUAL: 21,
  FIN_MANUAL: 22,
  ESTADO_OPERARIO: 23,
  COLA_MANUAL: 24,
  CONT_EXPRESS: 25,
  AC_EXPRESS: 26,
  CONT_ESTANDAR: 27,
  AC_ESTANDAR: 28,
  AC_TIEMPO_OPERARIO: 29,
  MAX_COLA_DESCARGA: 30,
})

const CANT_COLUMNAS_FIJAS = 33

// Define los nombres visibles de cada columna fija del vector de estado.
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

// Define los titulos agrupados que aparecen arriba de las columnas del vector.
const GRUPOS_VECTOR = [
  { label: '', span: 2 },
  { label: 'llegada_camioneta_express', span: 3 },
  { label: 'llegada_camioneta_estandar', span: 3 },
  { label: 'fin_descarga_inicial(i)', span: 4 },
  { label: 'Cinta descarga', span: 3 },
  { label: 'Lectura / Escaner', span: 4 },
  { label: 'fin_escaneo', span: 3 },
  { label: 'fin_procesamiento_manual', span: 3 },
  { label: 'Operario', span: 2 },
  { label: '', span: 6 },
]

// Formatea los valores que se muestran en la tabla del vector de estado.
function formatearNumero(valor) {
  if (valor === null || valor === undefined || valor === '') return '-'
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor.toFixed(2) : '-'
  return String(valor)
}

function formatChartValue(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '-'
  return Number(value).toFixed(2)
}

function calcularTicksEje(tiempoTotal, cantTicks = 8) {
  const intervalo = Math.ceil(tiempoTotal / cantTicks / 10) * 10
  return Array.from({ length: Math.floor(tiempoTotal / intervalo) + 1 }, (_, i) => i * intervalo)
}

function calcularTicksY(maxValor, cantTicks = 6) {
  if (!maxValor || maxValor === 0) return [0]
  const intervalo = Math.ceil(maxValor / cantTicks / 5) * 5
  return Array.from({ length: Math.floor(maxValor / intervalo) + 2 }, (_, i) => i * intervalo)
}

// Construye las columnas dinamicas de lotes activos: Estado y Tiempo entrada por cada lote.
function construirColumnasLotes(cantidadLotes) {
  return Array.from({ length: cantidadLotes }, () => ['Estado', 'Tiempo entrada']).flat()
}

// Renderiza un campo numerico de parametros con su etiqueta.
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

// Renderiza una tarjeta simple para mostrar un indicador del resumen.
function StatCard({ label, value, accent }) {
  return (
    <div className={`stat-card ${accent ? 'accent' : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

// Componente principal de la aplicacion: maneja parametros, ejecucion y visualizacion.
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
  const [errorSimulacion, setErrorSimulacion] = useState('')

  // Actualiza un parametro puntual manteniendo intactos los demas.
  const actualizarParametro = (key) => (value) => setParametros((prev) => ({ ...prev, [key]: value }))

  // Ejecuta la simulacion en el backend y guarda el resultado.
  const manejarSimulacion = useCallback(async () => {
    setSimulando(true)
    setErrorSimulacion('')

    const { horaInicio, cantFilas, ...simParams } = parametros
    const body = {
      parametros: simParams,
      horaInicio,
      cantFilas,
    }

    try {
      const response = await fetch(`${BACKEND_URL}/api/simular`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const texto = await response.text()
        throw new Error(`Error en la simulación: ${response.status} ${texto}`)
      }

      const resultado = await response.json()
      setResultadoSimulacion(resultado)
    } catch (error) {
      console.error('Error al solicitar simulación al backend:', error)
      setErrorSimulacion(error?.message ?? 'Error de red al ejecutar la simulación')
      setResultadoSimulacion(null)
    } finally {
      setSimulando(false)
    }
  }, [parametros])

  // Selecciona primera fila, rango pedido por hora/cantidad y ultima fila de simulacion.
  const filasVisibles = useMemo(() => {
    return resultadoSimulacion?.filas ?? []
  }, [resultadoSimulacion])

  // Calcula cuantos pares de columnas de lotes hacen falta para las filas visibles.
  const cantidadLotesVisible = useMemo(() => {
    return filasVisibles.reduce((maximo, fila) => Math.max(maximo, Math.ceil((fila.valores.length - CANT_COLUMNAS_FIJAS) / 2)), 0)
  }, [filasVisibles])

  // Arma las columnas dinamicas de lotes que se agregan al final del vector.
  const columnasLotes = useMemo(() => construirColumnasLotes(cantidadLotesVisible), [cantidadLotesVisible])

  // Une las columnas fijas del vector con las columnas dinamicas de lotes.
  const columnas = useMemo(() => [...COLUMNAS_VECTOR, ...columnasLotes], [columnasLotes])

  const tiempoTotal = resultadoSimulacion?.resumen?.tiempoTotal ?? 0
  const ticksEjeX = useMemo(() => calcularTicksEje(tiempoTotal), [tiempoTotal])

  const ticksEjeYPermanencia = useMemo(() => {
    const datos = resultadoSimulacion?.datosGraficos?.permanencia ?? []
    const maxPermanencia = datos.length
      ? Math.max(...datos.map((d) => Math.max(d.express, d.estandar)))
      : 0
    return calcularTicksY(maxPermanencia)
  }, [resultadoSimulacion])

  const ticksEjeYOperario = useMemo(() => {
    const datos = resultadoSimulacion?.datosGraficos?.operario ?? []
    const maxOperario = datos.length ? Math.max(...datos.map((d) => d.ocupacionAcumulada)) : 0
    return calcularTicksY(maxOperario)
  }, [resultadoSimulacion])

  const ticksEjeYCola = useMemo(() => {
    const datos = resultadoSimulacion?.datosGraficos?.cola ?? []
    const maxCola = datos.length ? Math.max(...datos.map((d) => d.cola)) : 0
    return calcularTicksY(maxCola)
  }, [resultadoSimulacion])

  const exportarCsv = useCallback(() => {
    if (!resultadoSimulacion) return

    const separator = ';'
    const superHeader = [...Array(CANT_COLUMNAS_FIJAS).fill('')]
    const filaLotes = Array.from({ length: cantidadLotesVisible * 2 }, () => 'Lotes')
    const filaSuperGrupo = [...superHeader, ...filaLotes]

    const filaGrupo = [
      ...GRUPOS_VECTOR.flatMap((grupo) => Array(grupo.span).fill(grupo.label)),
      ...Array.from({ length: cantidadLotesVisible }, (_, index) => [`${index + 1}.`, `${index + 1}.`]).flat(),
    ]

    const filaColumnas = [...COLUMNAS_VECTOR, ...columnasLotes]
    const longitudFilas = filaColumnas.length

    const todasFilas = [
      filaSuperGrupo,
      filaGrupo,
      filaColumnas,
      ...filasVisibles.map((fila) => {
        const valores = fila.valores.slice(0, longitudFilas)
        return [...valores, ...Array(Math.max(0, longitudFilas - valores.length)).fill('')]
      }),
    ]

    const escapar = (valor) => {
      if (valor === null || valor === undefined) return ''
      const texto = String(valor)
      return /[";\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto
    }

    const csv = '\uFEFF' + todasFilas.map((fila) => fila.map(escapar).join(separator)).join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'simulacion_expreso_norte.csv'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }, [resultadoSimulacion, filasVisibles, columnasLotes, cantidadLotesVisible])

  return (
    <div className="app">
      <header className="top-bar">
        <div>
          <div className="title">Simulacion Expreso Norte</div>
          <div className="subtitle">Modelo de camionetas, descarga, escaner y procesamiento manual</div>
        </div>
      </header>

      {errorSimulacion && (
        <div className="error-banner">
          <strong>Error:</strong> {errorSimulacion}
        </div>
      )}

      <div className="body-layout">
        <aside className="panel side-panel">
          <div className="panel-title">Parametros</div>
          <ParamField label="Tiempo max. (min)" value={parametros.tiempoMax} onChange={actualizarParametro('tiempoMax')} min={1} />
          <ParamField label="Iteraciones" value={parametros.maxIter} onChange={actualizarParametro('maxIter')} min={10} max={100000} />
          <div className="side-panel-actions">
            <button className="run-button" onClick={manejarSimulacion} disabled={simulando}>
              {simulando ? 'Simulando...' : 'Ejecutar simulacion'}
            </button>
            {resultadoSimulacion && (
              <button className="export-button" onClick={exportarCsv} disabled={simulando}>
                Exportar CSV
              </button>
            )}
          </div>

          {resultadoSimulacion && (
            <>
              <div className="section-title">Resultados</div>
              <div className="stats-grid">
                <StatCard label="Tiempo simulado" value={`${resultadoSimulacion.resumen.tiempoTotal.toFixed(2)} min`} />
                <StatCard label="Prom. Express" value={`${resultadoSimulacion.resumen.promExpress.toFixed(2)} min`} />
                <StatCard label="Prom. Estandar" value={`${resultadoSimulacion.resumen.promEstandar.toFixed(2)} min`} />
                <StatCard label="Uso operario" value={`${resultadoSimulacion.resumen.pctOperario.toFixed(2)} %`} accent />
                <StatCard label="Max cola descarga" value={resultadoSimulacion.resumen.maxColaCintas} />
                <StatCard label="Total camionetas" value={resultadoSimulacion.resumen.totalLotes} />
              </div>
            </>
          )}

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
          {!resultadoSimulacion ? (
            <div className="placeholder">
              <p>Ejecuta la simulacion para generar el vector de estado.</p>
            </div>
          ) : (
            <>
              <div className="table-wrapper">
                <div className="table-meta">
                  <span>{`Mostrando ${filasVisibles.length} filas de ${resultadoSimulacion.filas.length}`}</span>
                </div>
                <div className="table-scroll">
                  <table className="vtable">
                    <thead>
                      <tr className="super-group-row">
                        <th rowSpan={3} className="row-number-header">#</th>
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
                        <tr key={fila.id} className={fila.esFinal ? 'final-row' : ''}>
                          <td className="row-number-cell">{fila.id}</td>
                          {columnas.map((_, index) => (
                            <td key={`${fila.id}-${index}`}>{formatearNumero(fila.valores[index])}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="section-title">Gráficos</div>
              <div className="charts-section">
                <div className="chart-card">
                  <div className="chart-title">Promedio de tiempo en sistema por tipo de lote</div>
                  <ResponsiveContainer width="100%" height={150}>
                    <LineChart data={resultadoSimulacion.datosGraficos.permanencia} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                      <XAxis type="number" dataKey="reloj" domain={[0, tiempoTotal]} ticks={ticksEjeX} tick={{ fill: 'var(--text-muted)' }} stroke="rgba(255,255,255,0.18)" tickFormatter={(value) => Number(value).toFixed(0)} />
                      <YAxis ticks={ticksEjeYPermanencia} tick={{ fill: 'var(--text-muted)' }} stroke="rgba(255,255,255,0.18)" tickFormatter={formatChartValue} domain={[0, 'auto']} />
                      <Tooltip wrapperStyle={{ backgroundColor: 'rgba(15,20,32,0.96)', border: '1px solid rgba(255,255,255,0.08)', color: 'var(--text)' }} formatter={(value) => [formatChartValue(value), 'Minutos']} />
                      <Legend wrapperStyle={{ color: 'var(--text)' }} />
                      <Line type="monotone" dataKey="express" stroke="var(--accent)" dot={false} strokeWidth={2} />
                      <Line type="monotone" dataKey="estandar" stroke="var(--success)" dot={false} strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                <div className="chart-card">
                  <div className="chart-title">Tiempo acumulado de uso del operario</div>
                  <ResponsiveContainer width="100%" height={130}>
                    <LineChart data={resultadoSimulacion.datosGraficos.operario} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                      <XAxis type="number" dataKey="reloj" domain={[0, tiempoTotal]} ticks={ticksEjeX} tick={{ fill: 'var(--text-muted)' }} stroke="rgba(255,255,255,0.18)" tickFormatter={(value) => Number(value).toFixed(0)} />
                      <YAxis ticks={ticksEjeYOperario} tick={{ fill: 'var(--text-muted)' }} stroke="rgba(255,255,255,0.18)" tickFormatter={formatChartValue} domain={[0, 'auto']} />
                      <Tooltip wrapperStyle={{ backgroundColor: 'rgba(15,20,32,0.96)', border: '1px solid rgba(255,255,255,0.08)', color: 'var(--text)' }} formatter={(value) => [formatChartValue(value), 'Minutos']} />
                      <Line type="monotone" dataKey="ocupacionAcumulada" stroke="var(--success)" dot={false} strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                <div className="chart-card">
                  <div className="chart-title">Camionetas en cola de descarga</div>
                  <ResponsiveContainer width="100%" height={150}>
                    <LineChart data={resultadoSimulacion.datosGraficos.cola} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                      <XAxis type="number" dataKey="reloj" domain={[0, tiempoTotal]} ticks={ticksEjeX} tick={{ fill: 'var(--text-muted)' }} stroke="rgba(255,255,255,0.18)" tickFormatter={(value) => Number(value).toFixed(0)} />
                      <YAxis ticks={ticksEjeYCola} tick={{ fill: 'var(--text-muted)' }} stroke="rgba(255,255,255,0.18)" tickFormatter={(value) => Number(value).toFixed(0)} allowDecimals={false} domain={[0, 'auto']} />
                      <Tooltip wrapperStyle={{ backgroundColor: 'rgba(15,20,32,0.96)', border: '1px solid rgba(255,255,255,0.08)', color: 'var(--text)' }} formatter={(value) => [`${Number(value).toFixed(0)}`, 'Cola']} />
                      <Line type="monotone" dataKey="cola" stroke="var(--accent)" dot={false} strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  )
}
