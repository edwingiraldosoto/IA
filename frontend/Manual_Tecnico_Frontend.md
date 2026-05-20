# Manual Técnico de Arquitectura y Sistema

## 1. Introducción
**Descripción general del sistema:** 
El sistema es una aplicación web (Single Page Application - SPA) que actúa como un panel de control avanzado (Panoptes) para la gestión, recopilación y análisis de datos de negocios (ej. ferreterías, depósitos). Permite orquestar procesos de scraping geolocalizado, enriquecimiento de datos a través del RUES, procesamiento de datos de ARGOS, y sincronización de información. Además, cuenta con un asistente de inteligencia artificial integrado.

**Propósito del documento:** 
Proporcionar una guía técnica detallada que explique la estructura, flujo, dependencias y arquitectura del proyecto frontend actual, facilitando el onboarding de nuevos desarrolladores y sirviendo como referencia técnica.

**Alcance:** 
Este documento cubre exclusivamente la capa Frontend desarrollada en React, su organización interna, las dependencias que utiliza y cómo se comunica con los múltiples microservicios/APIs del backend.

---

## 2. Tecnologías Utilizadas
- **Lenguaje:** JavaScript (ES6+) / JSX
- **Framework/Librería Core:** React 19
- **Empaquetador/Build Tool:** Vite 8
- **Librerías principales:**
  - `react-dom`: Renderizado web.
  - `leaflet` / `react-leaflet`: Visualización de mapas interactivos y geolocalización.
  - `react-leaflet-cluster`: Agrupación de marcadores en el mapa para optimizar rendimiento.
  - `xlsx`: Procesamiento y exportación de archivos Excel.
- **Herramientas de desarrollo (DevDependencies):** ESLint para análisis de código estático y linting.

---

## 3. Arquitectura del Sistema
**Tipo de arquitectura:** Arquitectura basada en Componentes (Frontend) que interactúa con una arquitectura de Microservicios en el Backend mediante API REST.

**Organización de los componentes:**
El frontend está diseñado con una estructura modular basada en "Modos" (Views/Pages) y "Componentes Compartidos" (Shared). El estado principal de navegación se maneja en el componente raíz (`App.jsx`), el cual monta dinámicamente el modo seleccionado desde una barra lateral (`Sidebar`).

**Diagrama Lógico de Interacción:**
```text
[ Cliente Web / Navegador ]
         |
    (React SPA)
         |
   +-----+---------------------------------------------------------+
   |  Frontend "Panoptes"                                          |
   |  - Modos: Scraping, RUES, ARGOS, Mapa, Resultados             |
   |  - Shared: ChatBot (Panoptes IA), Sidebar, Header             |
   +-----+--------+---------------+----------------+---------------+
         |        |               |                |               
    (HTTP/REST)   |               |                |
         v        v               v                v
  +----------+  +----------+  +----------+  +---------------+
  | API      |  | API      |  | API      |  | API Colombia  |
  | Scraper  |  | Chatbot  |  | RUES /   |  | (Externa)     |
  | (NodeJS) |  | (FastAPI)|  | Sincron  |  |               |
  | P: 3000  |  | P: 8000  |  | P: 8001  |  |               |
  +----------+  +----------+  +----------+  +---------------+
```

---

## 4. Estructura del Proyecto

A continuación se detalla la función de los archivos y carpetas clave del repositorio:

```text
frontend/
├── index.html            → Punto de entrada HTML de la aplicación, carga el script principal (main.jsx).
├── package.json          → Lista de dependencias del proyecto y scripts de Vite.
├── .env                  → Variables de entorno con las URLs de los distintos microservicios backend.
├── vite.config.js        → Configuración del empaquetador Vite.
└── src/
    ├── main.jsx          → Punto de arranque de React. Renderiza el componente <App /> en el DOM.
    ├── App.jsx           → Componente principal. Define el layout y el enrutador de estados ("Modos").
    ├── App.css           → Estilos globales del contenedor principal y layout.
    ├── index.css         → Estilos base de la aplicación (variables CSS, resets).
    └── components/
        ├── modes/        → Vistas principales de la aplicación:
        │   ├── ScrapingMode.jsx  → Interfaz para lanzar jobs de scraping usando la API de Colombia.
        │   ├── RUESMode.jsx      → Módulo para procesar y enriquecer registros del RUES.
        │   ├── ARGOSMode.jsx     → Módulo para cargar y procesar información de registros de ARGOS.
        │   ├── MapMode.jsx       → Visor cartográfico usando Leaflet para mostrar negocios.
        │   ├── ResultadosMode.jsx→ Historial de trabajos y datos recopilados.
        │   └── SincronizarMode.jsx→ Vista para sincronizar y exportar datos.
        └── shared/       → Componentes reutilizables:
            ├── ChatPanoptes.jsx  → Asistente virtual flotante que conecta con FastAPI.
            ├── Sidebar.jsx       → Menú de navegación lateral.
            ├── Header.jsx        → Cabecera genérica.
            ├── JobsList.jsx      → Lista para visualizar el estado de tareas en segundo plano.
            ├── HistorialRUES.jsx → Tabla de historial para el RUES.
            └── HistorialArgos.jsx→ Tabla de historial para ARGOS.
```

---

## 5. Flujo de la Aplicación

**Flujo general de un proceso (Ejemplo: Scraping de negocios):**
1. **Interacción del Usuario:** El usuario ingresa a la pestaña "Apify Scraping" y selecciona un departamento y municipio.
2. **Consulta a API Externa:** El componente `ScrapingMode` hace una petición GET a `api-colombia.com` para cargar los municipios disponibles dinámicamente.
3. **Configuración de la Tarea:** El usuario define palabras clave (ej: "ferreterías") y límites de resultados.
4. **Petición al Backend:** Al hacer clic en "Iniciar Scraping", el frontend envía una petición POST HTTP con un payload JSON al `API_URL` (Puerto 3000).
5. **Polling de Estado:** El componente lanza un intervalo (`setInterval`) que hace peticiones GET cada 3 segundos a `/jobs` para actualizar la tabla de `JobsList` en tiempo real.
6. **Respuesta al Usuario:** El frontend muestra alertas sobre el éxito del lanzamiento y la tabla refleja el progreso hasta que el estado del trabajo cambia a completado.

**Flujo del Asistente de IA (ChatPanoptes):**
```text
Usuario escribe en el Chat → ChatPanoptes.jsx → Petición POST a /api/chat (Puerto 8000) → FastAPI procesa con LLM → Retorna JSON → React actualiza el estado de la UI y muestra la respuesta animada.
```

---

## 6. Base de Datos
Al tratarse de una aplicación Frontend, esta no se conecta directamente a una base de datos de manera directa. La persistencia y el acceso a datos están delegados a las distintas APIs backend configuradas en las variables de entorno. 
- La arquitectura infiere el uso de bases de datos del lado del backend (como bases de datos SQL o NoSQL) que almacenan los "jobs" de scraping, registros enriquecidos del RUES y datos de ARGOS. Estas bases de datos son consumidas exclusivamente vía endpoints REST desde React.

---

## 7. Manejo de Configuración
La aplicación utiliza un archivo `.env` localizado en la raíz del proyecto para manejar la configuración de conexiones. Las variables tienen el prefijo `VITE_` para ser inyectadas de forma segura por Vite.

**Variables contenidas:**
- `VITE_API_URL`: URL del microservicio de scraping en Node.js (Puerto 3000).
- `VITE_CHAT_API_URL`: URL del servicio de Inteligencia Artificial en FastAPI (Puerto 8000).
- `VITE_RUES_API_URL`, `VITE_SYNC_API_URL`, `VITE_ARGOS_API_URL`: URLs para los microservicios de procesamiento y sincronización de datos (Puerto 8001).
- `VITE_COLOMBIA_API_URL`: URL de un servicio público/externo para obtener datos geográficos de Colombia.

*Nota: El archivo `.env` no contiene claves de API o contraseñas sensibles directamente, sino enrutamientos hacia las redes de los microservicios y APIs abiertas.*

---

## 8. Dependencias del Proyecto

Según el archivo `package.json`, estas son las librerías principales utilizadas y su propósito:

- **`react` & `react-dom` (v19.x):** Motor principal para la creación de interfaces de usuario y su renderizado en el DOM.
- **`leaflet` (v1.9.4):** Librería core de JavaScript para mapas interactivos open-source.
- **`react-leaflet` (v5.x):** Envoltura (wrapper) de React para Leaflet, permite usar mapas de forma declarativa mediante componentes React.
- **`react-leaflet-cluster` (v4.x):** Plugin para agrupar marcadores geográficos muy cercanos en el mapa, mejorando drásticamente el rendimiento visual cuando se renderizan grandes cantidades de negocios.
- **`xlsx` (v0.18.5):** Herramienta para la manipulación y exportación de libros de cálculo de Excel. Se utiliza para funcionalidades de importación (ej. cargar bases de datos externas de ARGOS) y exportación de los datos procesados en la plataforma.

---

## 9. Buenas Prácticas Identificadas
- **Separación de Responsabilidades:** El código está claramente organizado dividiendo vistas funcionales (carpeta `modes/`) de los componentes genéricos (carpeta `shared/`).
- **Gestión de Entornos Modular:** El uso de `.env` aísla las URLs de los diferentes microservicios, facilitando la transición y pruebas en diferentes entornos.
- **Manejo de Estados Asíncronos:** Componentes como `ScrapingMode` implementan estados de carga explícitos (`loading`), deshabilitación de botones para evitar dobles peticiones y bloques `try/catch` para la gestión de errores mediante retroalimentación visual (`alert`).
- **Limpieza de Efectos (Cleanup):** La aplicación hace un uso correcto de `useEffect` con limpiezas de intervalos de polling (`clearInterval`) al desmontar los componentes, previniendo fugas de memoria en la aplicación.

---

## 10. Recomendaciones (Opcional)
Sin alterar la lógica o comportamiento actual, se pueden tener en cuenta los siguientes puntos técnicos para el futuro:
1. **Gestor de Estado Global:** Si la aplicación crece en complejidad, considere migrar el estado principal (que actualmente vive en `App.jsx` y localmente) a un manejador como Redux, Zustand o React Context.
2. **Cliente HTTP Centralizado:** Evaluar la creación de un servicio cliente HTTP centralizado (usando `Axios` o un wrapper para `fetch`) para no repetir la inyección de las cabeceras comunes (`Content-Type: application/json`) y permitir interceptores de errores a nivel global.
3. **WebSockets para Datos en Tiempo Real:** Reemplazar el enfoque de validación continua "Long Polling" (`setInterval` cada 3 segundos en `JobsList`) por una conexión en tiempo real utilizando WebSockets o Server-Sent Events, reduciendo la carga de red y optimizando el backend.
4. **TypeScript:** A futuro, una migración paulatina a TypeScript aportaría mayor predictibilidad y autocompletado en el manejo de peticiones de las múltiples APIs.
