# Stack tecnológico y librerías — Simulación Expreso Norte

Referencia de tecnologías, dependencias y biblioteca estándar usadas en el proyecto, con el rol de cada una en backend y frontend.

---

## 1. Vista general del stack

```
┌──────────────────────────────────────────────────────────────────┐
│                     Docker Compose                                │
├─────────────────────────────┬────────────────────────────────────┤
│  Backend                    │  Frontend                           │
│  Python 3.11                │  Node.js 22                         │
│  FastAPI + Uvicorn          │  React 19 + Vite 8                  │
│  Pydantic (vía FastAPI)     │  Recharts 3                         │
│  ASGI / HTTP JSON           │  Fetch API (nativo) + CSS           │
└─────────────────────────────┴────────────────────────────────────┘
```

| Capa | Backend | Frontend |
|------|---------|----------|
| Lenguaje | Python 3.11 | JavaScript (JSX / ES modules) |
| Servidor / runtime | Uvicorn (ASGI) | Vite dev server (dev) / navegador (prod) |
| Framework web / UI | FastAPI | React |
| Validación / tipos | Pydantic | — (JS dinámico) |
| Gráficos | — (datos en JSON) | Recharts |
| Estilos | — | CSS plano (`App.css`, `index.css`) |
| Orquestación | Docker + docker-compose | Docker + docker-compose |

---

## 2. Infraestructura y herramientas

### Docker

| Archivo | Uso |
|---------|-----|
| `docker-compose.yml` | Levanta backend (puerto 8000) y frontend (5173) con volúmenes para hot-reload |
| `backend/Dockerfile` | Imagen `python:3.11`, instala `requirements.txt`, ejecuta Uvicorn |
| `frontend/Dockerfile` | Imagen `node:22`, `npm install`, ejecuta `vite --host` |

**Para qué sirve:** entorno reproducible sin instalar Python/Node en la máquina host; el código se monta como volumen y los cambios se reflejan al guardar (`--reload` en Uvicorn, HMR en Vite).

### Variables de entorno (frontend)

| Variable | Definición | Uso |
|----------|------------|-----|
| `VITE_BACKEND_URL` | Opcional en build/dev | URL base del API (default `http://localhost:8000` en `App.jsx`) |

Vite solo expone al cliente variables con prefijo `VITE_`.

---

## 3. Backend — stack y dependencias

### 3.1 Runtime y servidor

| Componente | Versión (referencia) | Para qué se usa |
|------------|----------------------|-----------------|
| **Python** | 3.11 (imagen Docker) | Lenguaje del motor de simulación y la API |
| **Uvicorn** | (instalado vía `requirements.txt`) | Servidor **ASGI** que ejecuta la app FastAPI, atiende HTTP y soporta `--reload` en desarrollo |

Uvicorn traduce peticiones HTTP a llamadas a la aplicación FastAPI (`main:app`).

### 3.2 Dependencias declaradas (`backend/requirements.txt`)

| Paquete | Rol en este proyecto |
|---------|----------------------|
| **fastapi** | Framework para definir rutas REST (`GET /`, `POST /api/simular`), serializar respuestas JSON y documentación automática en `/docs` |
| **uvicorn** | Servidor que corre FastAPI en el contenedor |

### 3.3 Dependencias que trae FastAPI (no listadas en `requirements.txt`)

| Paquete | Rol en este proyecto |
|---------|----------------------|
| **pydantic** | Valida y parsea el body del request (`SimulacionParametros`, `SimularRequest`); convierte JSON a objetos Python y devuelve 422 si los datos son inválidos |
| **starlette** | Capa HTTP base de FastAPI (request/response, middleware) |
| **typing** (stdlib) | Anotaciones `Dict`, `List`, `Optional`, `Any` en firmas y retornos |

En `main.py`:

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
```

- **FastAPI** — instancia `app`, decoradores `@app.post`, respuestas JSON.
- **CORSMiddleware** — permite que el frontend en otro puerto/origen llame al API desde el navegador.
- **BaseModel (Pydantic)** — esquema de entrada del POST `/api/simular`.

### 3.4 Biblioteca estándar de Python (sin instalar)

| Módulo | Uso en `main.py` |
|--------|------------------|
| **math** | `isnan`, comparaciones con `inf` para elegir el próximo evento |
| **random** | `random.random()` — RND uniformes, exponenciales, rechazo en escaneo |
| **typing** | Tipado estático para legibilidad y herramientas |

Toda la **lógica de simulación** (colas, eventos, vector de estado, `datosGraficos`) está implementada con estructuras nativas (`dict`, `list`) sin NumPy, Pandas ni simpy.

### 3.5 Mapa: necesidad → tecnología (backend)

| Necesidad | Tecnología |
|-----------|------------|
| Exponer API HTTP | FastAPI + Uvicorn |
| Validar JSON entrante | Pydantic |
| Permitir llamadas desde React | CORSMiddleware |
| Simulación y aleatoriedad | Python stdlib (`random`, `math`) |
| Respuesta estructurada | `dict` / `list` → JSON automático de FastAPI |

---

## 4. Frontend — stack y dependencias

### 4.1 Runtime y herramientas de build

| Componente | Versión (`package.json`) | Para qué se usa |
|------------|--------------------------|-----------------|
| **Node.js** | 22 (imagen Docker) | Ejecutar npm, Vite y ESLint en desarrollo |
| **Vite** | ^8.0.12 | Bundler y servidor de desarrollo: HMR, transpilación JSX, `import` ES modules |
| **@vitejs/plugin-react** | ^6.0.1 | Plugin oficial: Fast Refresh, transformación de JSX/TSX |

`vite.config.js` solo registra el plugin React; no hay proxy al backend (el front llama directo a `localhost:8000` o `VITE_BACKEND_URL`).

### 4.2 Dependencias de producción (`dependencies`)

| Paquete | Versión | Para qué se usa en este proyecto |
|---------|---------|----------------------------------|
| **react** | ^19.2.6 | UI declarativa: componentes, `useState`, `useMemo`, `useCallback`, `StrictMode` |
| **react-dom** | ^19.2.6 | `createRoot` — monta la app en `#root` del `index.html` |
| **recharts** | ^3.8.1 | Gráficos de líneas: `LineChart`, `Line`, ejes, grilla, tooltip, leyenda |

#### React — hooks y piezas usadas

| API | Archivo | Función |
|-----|---------|---------|
| `useState` | `App.jsx` | Parámetros, resultado de simulación, loading, errores |
| `useMemo` | `App.jsx` | Filas visibles, columnas de lotes, ticks de ejes X/Y (evitar recálculos) |
| `useCallback` | `App.jsx` | `manejarSimulacion`, `exportarCsv` (referencias estables) |
| `StrictMode` | `main.jsx` | Modo estricto de desarrollo (doble render en dev para detectar efectos) |

#### Recharts — componentes usados

| Componente | Gráfico | Función |
|------------|---------|---------|
| `ResponsiveContainer` | Los 3 | Adapta el SVG al ancho del contenedor |
| `LineChart` | Los 3 | Contenedor del gráfico temporal |
| `Line` | Permanencia (2), operario (1), cola (1) | Series `express`, `estandar`, `ocupacionAcumulada`, `cola` |
| `XAxis` | Los 3 | Eje tiempo (`reloj`), `type="number"`, ticks uniformes |
| `YAxis` | Los 3 | Escala vertical con ticks calculados |
| `CartesianGrid` | Los 3 | Grilla de fondo |
| `Tooltip` | Los 3 | Valores al pasar el mouse |
| `Legend` | Solo permanencia | Diferenciar Express / Estándar |

Los datos llegan ya calculados en `resultadoSimulacion.datosGraficos`; Recharts **no** agrega ni filtra series.

### 4.3 Dependencias de desarrollo (`devDependencies`)

| Paquete | Para qué se usa |
|---------|----------------|
| **eslint** | Linter de JavaScript |
| **@eslint/js** | Configuración base de ESLint (flat config) |
| **eslint-plugin-react-hooks** | Reglas para hooks (`exhaustive-deps`, etc.) |
| **eslint-plugin-react-refresh** | Compatibilidad con Fast Refresh de Vite |
| **globals** | Variables globales del entorno para ESLint |
| **@types/react**, **@types/react-dom** | Tipos TypeScript para mejor DX en el editor (el código del proyecto es `.jsx`, no `.tsx`) |

No afectan el bundle de producción (`npm run build`).

### 4.4 APIs y tecnologías nativas (sin paquete npm)

| Tecnología | Uso |
|------------|-----|
| **Fetch API** | `POST` a `/api/simular` con `JSON.stringify` / `response.json()` |
| **Blob** | Generar archivo CSV en memoria |
| **URL.createObjectURL / revokeObjectURL** | Descarga del CSV sin servidor |
| **CSS** | `index.css` (global), `App.css` (layout, tabla sticky, panel, gráficos) |
| **ES modules** | `"type": "module"` en `package.json`; imports en `main.jsx` y `App.jsx` |

No se usa Axios, React Router, Zustand, TanStack Query ni librerías de UI (Material, Chakra, etc.).

### 4.5 Scripts npm

| Script | Comando | Uso |
|--------|---------|-----|
| `dev` | `vite` | Desarrollo local (Docker: `npm run dev -- --host`) |
| `build` | `vite build` | Build estático para producción |
| `preview` | `vite preview` | Previsualizar el build |
| `lint` | `eslint .` | Revisión estática de código |

### 4.6 Mapa: necesidad → tecnología (frontend)

| Necesidad | Tecnología |
|-----------|------------|
| Interfaz y estado | React 19 |
| Montaje en el DOM | react-dom |
| Llamar al backend | Fetch (nativo) |
| Tabla y formularios | JSX + CSS |
| Gráficos temporales | Recharts |
| Exportar CSV | Blob + `<a download>` |
| Dev rápido | Vite + plugin React |
| Calidad de código | ESLint (+ plugins React) |

---

## 5. Comunicación entre stacks

| Aspecto | Detalle |
|---------|---------|
| Protocolo | HTTP/1.1 |
| Formato | JSON (`Content-Type: application/json`) |
| CORS | Habilitado en backend para cualquier origen (`*`) |
| Autenticación | Ninguna |
| WebSockets | No usados |

El frontend no comparte código con el backend: el contrato es únicamente el JSON del endpoint `/api/simular`.

---

## 6. Resumen por archivo de dependencias

### Backend

```
requirements.txt
├── fastapi    → API REST + integración Pydantic
└── uvicorn    → Servidor ASGI

main.py (stdlib)
├── math, random, typing
```

### Frontend

```
package.json (dependencies)
├── react          → UI
├── react-dom      → Render en DOM
└── recharts       → Gráficos

package.json (devDependencies)
├── vite + @vitejs/plugin-react  → Build y dev server
└── eslint + plugins             → Lint

Sin dependencia npm para: HTTP, CSV, estilos, routing
```

---

## 7. Versiones y actualización

- Las versiones con `^` en npm permiten actualizaciones menores compatibles.
- El backend fija solo `fastapi` y `uvicorn` sin pin de versión en el txt; la imagen Docker reconstruida puede traer versiones nuevas.
- Para reproducibilidad estricta conviene usar `package-lock.json` (frontend) y fijar versiones en `requirements.txt` (por ejemplo `fastapi==0.115.0`).

---

## 8. Documentos relacionados

- **[DOCUMENTACION.md](./DOCUMENTACION.md)** — funcionamiento del programa, memoria, tabla, gráficos y CSV.
- **http://localhost:8000/docs** — documentación interactiva OpenAPI generada por FastAPI (Swagger UI).

---

*Stack del proyecto Simulación Expreso Norte — TP4 UTN FRC.*
