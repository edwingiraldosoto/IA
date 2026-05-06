# Manual Técnico de Arquitectura y Sistema

## 1. Introducción

**Descripción general del sistema**
Se trata de una aplicación backend construida en Node.js, diseñada para orquestar la extracción de datos (web scraping) de negocios comerciales (como ferreterías y depósitos) directamente desde Google Maps utilizando **Apify**. Posteriormente, el sistema descarga las fotografías asociadas a cada establecimiento y las envía a un motor de Inteligencia Artificial (**Google Gemini**) para que determine el tipo de mercancía y materiales que comercializan (cemento, varillas, agregados, etc.). Finalmente, los datos se consolidan y almacenan en una base de datos relacional.

**Propósito del documento**
Este documento tiene como objetivo proporcionar una visión integral de la arquitectura, configuración y lógica operativa del proyecto. Servirá como guía técnica para el entendimiento del código y mantenimiento por parte de otros desarrolladores.

**Alcance**
El manual abarca la definición de tecnologías implementadas, componentes arquitectónicos, flujos de datos, administración de estado, base de datos y tareas programadas.

---

## 2. Tecnologías Utilizadas

- **Lenguaje Base**: JavaScript (Entorno Node.js)
- **Framework API**: Express.js
- **Librerías principales** *(basado en package.json)*:
  - `apify-client`: Wrapper oficial para orquestar las tareas en la plataforma Apify.
  - `axios`: Cliente HTTP empleado para la descarga de imágenes en Base64 y comunicación directa con la API de Google Gemini.
  - `mssql`: Conector oficial para ejecutar operaciones y transacciones en Microsoft SQL Server.
  - `node-cron`: Programador de tareas periódicas en segundo plano.
  - `express` / `cors`: Montaje de la capa de servicios web.
  - `dotenv`: Gestión de configuración y credenciales mediante variables de entorno.

---

## 3. Arquitectura del Sistema

**Tipo de Arquitectura**
La aplicación implementa una arquitectura orientada a servicios y procesamiento asíncrono en background (Pipelines & Jobs). La separación permite ejecutar largas tareas de extracción e IA sin bloquear las peticiones del usuario final.

**Organización Lógica de Componentes**
- **Capa API/REST**: Expone la funcionalidad al exterior mediante Endpoints.
- **Capa de Control de Estado (Jobs)**: Un gestor ligero que persiste en disco (formato JSON) la información y el progreso de ejecución.
- **Capa de Orquestación (Pipeline)**: Coordina las dos fases principales: *Scraping* y *Análisis IA*.
- **Capa de Datos**: Realiza las operaciones en la base de datos de manera segura y sin duplicidad.

**Diagrama de Flujo y Componentes**
```text
[Cliente/Frontend] ──> (HTTP POST) ──> [Servidor API (Express)]
                                                │
                                       [Job Store (Archivos JSON)]
                                                │
[Cron Scheduler] ────────────────────> [Pipeline Principal (app.js)]
                                                │
                                ┌───────────────┴───────────────┐
                                │                               │
                        1. Scrape (Apify)                2. Analyze (IA)
                                │                               │
                         [dataset.json]                [Google Gemini API]
                                │                               │
                                └───────────────┬───────────────┘
                                                │
                                  [Base de Datos: SQL Server]
```

---

## 4. Estructura del Proyecto

A continuación se detalla la anatomía de los archivos y directorios del proyecto:

- **`app.js`** → Es el núcleo transaccional. Contiene las funciones de Scraping (`fazeScrape`) y Análisis (`fazeAnalyze`). Configura la conexión a BD y ejecuta la petición hacia la inteligencia artificial con sistemas de reintento (fallbacks) integrados.
- **`server.js`** → Punto de entrada de la aplicación en modo servidor API. Define las rutas (`/api/jobs`) usando Express para lanzar y auditar trabajos de scraping de forma remota.
- **`cron.js`** → Punto de entrada alternativo. Utiliza `node-cron` para inicializar el pipeline de forma automática en horas determinadas leyendo parámetros del `.env`.
- **`jobs-store.js`** → Módulo de servicio interno que administra (crea, lista, actualiza) la base de datos temporal basada en archivos para trackear el progreso en tiempo real de los reportes.
- **`jobs/`** *(Directorio)* → Carpeta donde el Job Store guarda los archivos `.json` para cada trabajo individual, conteniendo su configuración, logs de errores, estatus y fecha.
- **`prompt-loader.js`** → Lógica para inyectar los datos en los prompts.
- **`prompts/`** *(Directorio)* → Almacena el `evaluacion-imagenes.txt` que contiene el prompt y el contexto exacto que se le dicta a Gemini para la toma de decisiones.
- **`dataset.json`** → Archivo dinámico que almacena la respuesta en crudo de Apify como caché antes de ser procesada por la BD.
- **`.env`** → Variables de entorno. Contiene las claves de Apify, Gemini y cadena de conexión.
- **`package.json`** → Listado de metadatos y dependencias exactas del proyecto.

---

## 5. Flujo de la Aplicación

El flujo principal asíncrono se detalla a continuación:

1. **Trigger Inicial**: Se lanza el proceso, ya sea vía API (recibiendo departamentos y municipios), vía tarea programada (cron) o por consola.
2. **Generación del Job**: Si se lanza por API, se crean estados "running" en la carpeta `jobs/` y se retorna código HTTP 202 (Accepted) al cliente instantáneamente.
3. **Fase de Scraping (`fazeScrape`)**:
   - `app.js` conecta con Apify y ejecuta el actor `compass/crawler-google-places`.
   - Se recaba la información en crudo y se vuelca en `dataset.json`.
4. **Fase de Análisis y Descarga (`fazeAnalyze`)**:
   - Por cada negocio recuperado, se extraen las URLs de las fotos y se descargan en formato `Base64` vía HTTP request (Axios).
   - Se empacan las imágenes y el prompt, y se realiza un POST al modelo seleccionado de Google Gemini.
5. **Decodificación y Cruce de Datos**:
   - La respuesta de IA retorna un JSON detallando si venden tubos, ladrillos, cemento, y extrayendo un posible número de WhatsApp oculto en carteles.
   - Estos "flags" se cruzan en un filtro para calcular el "nivel de confianza".
6. **Guardado en Base de Datos**:
   - Con la validación procesada, se ejecuta una instrucción estructurada en SQL hacia la tabla `FerreteriasApify` actualizando el registro y finalizando el ciclo.
7. **Finalización**: Se actualiza el Job en su archivo correspondiente como `completed`.

---

## 6. Base de Datos

- **Motor**: SQL Server (`mssql`).
- **Conexión**: Vía autenticación de base de datos directa sobre TCP/IP sin encriptación nativa para la red local.
- **Estructura Identificada de la Tabla Principal (`FerreteriasApify`)**:
  - *Identificadores y Ubicación*: `NOMBRE`, `DIRECCION_COMERCIAL`, `LAT`, `LNG`, `DEPARTAMENTO`, `MUNICIPIO`.
  - *Contacto*: `TELEFONO`, `WHATSAPP`, `SITIO_WEB`, `URL_GOOGLE`, `FACEBOOK`, `INSTAGRAM`.
  - *Marcas de Venta (IA, tipo bit)*: `VENDE_CEMENTO`, `VENDE_TUBOS`, `VENDE_VARILLAS`, `VENDE_LADRILLOS`, `VENDE_AGREGADOS`.
  - *Confiabilidad (IA)*: `MATERIALES_OBSERVADOS`, `SCORE`, `NIVEL_CONFIANZA`.
  - *Auditoría*: `FECHA_ACTUALIZACION`.

El diseño evita la duplicidad ejecutando en todo momento una sintaxis **`MERGE`** basando su regla de comparación en el nombre del local y la dirección comercial.

---

## 7. Manejo de Configuración

Toda la personalización central se gestiona a través del archivo `.env`. Las categorías incluidas son:

- **SQL SERVER**: Host de base de datos local, nombre (`ferreterias_db`), usuario y contraseña.
- **APIFY / SCRAPING**: El token maestro de Apify y el ID del Actor (`compass/crawler-google-places`).
- **INTELIGENCIA ARTIFICIAL**: `GEMINI_API_KEY` para autorizar las inferencias visuales.
- **CRON SCHEDULE**: Configuración avanzada para la rutina automática, que incluye expresión de tiempo (`0 3 * * *`), límites de lugares y departamentos/municipios que consultará autónomamente.
- **SERVIDOR**: Puerto Express e integraciones CORS permitidas para despliegues frontend.

---

## 8. Dependencias del Proyecto

Según `requirements.txt / package.json`:
- **`apify-client`**: Fundamental para poder lanzar el bot de Google Maps remotamente.
- **`node-cron`**: Motor esencial del archivo `cron.js`.
- **`express` & `cors`**: Levantan la interfaz web (`server.js`) para controlar los escaneos bajo demanda.
- **`axios`**: Se usa por su alta fiabilidad en el manejo de Buffers (`arraybuffer`) para descargar imágenes web a la máquina local y transformarlas.
- **`mssql`**: Único Driver capaz de compilar las sentencias SQL Server usadas.

---

## 9. Buenas Prácticas Identificadas

1. **Separación de Responsabilidades**: Las capas están bien delimitadas. Los prompts de IA están aislados de la lógica, lo que facilita modificarlos sin re-escribir lógica de negocio.
2. **Reintentos Inteligentes (Fallbacks en IA)**: En la función `analyzeWithGemini`, la app transita inteligentemente de un modelo como `gemini-2.5-flash-lite` a otros de reserva si recibe errores o límites de API (Status 503 o 429), evitando caídas masivas en bucles de registros largos.
3. **Persistencia de Operaciones (`MERGE`)**: Utilizar el comando `MERGE` previene inserciones repetidas en BD y hace seguro cancelar la tarea a medias y reiniciarla.
4. **Respuestas asíncronas**: Los endpoints responden inmediatamente con un Status 202 sin bloquear la red del usuario.

---

## 10. Recomendaciones Técnicas (Opcional)

- **Optimización de Base de Datos**: La cláusula `MERGE` inyectada como un único "String" dentro de `app.js` es altamente riesgosa a nivel de mantenimiento. Se recomienda extraerla a archivos `.sql` o implementar un patrón Query Builder (como *Knex.js* o *Prisma ORM*).
- **Control de Almacenamiento**: La carpeta `/jobs` y `/dataset.json` no tienen un sistema de auto-limpieza, lo que podría aumentar el tamaño del disco innecesariamente si corren muchos crons seguidos; programar un job de expiración de archivos mitigaría este problema.
- **Performance HTTP**: Actualmente se espera (`await`) a la descarga de una imagen por vez en el bucle principal. Usar un `Promise.all` para ejecutar las descargas simultáneamente reduciría drásticamente el tiempo de análisis de negocios con muchas imágenes.
