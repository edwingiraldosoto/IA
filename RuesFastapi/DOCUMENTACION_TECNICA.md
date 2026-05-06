# MANUAL TÉCNICO - APLICACIÓN RUESFASTAPI

**Versión:** 1.3  
**Fecha:** Mayo 2026  
**Estado:** PRUEBAS  

---

## 1. INTRODUCCIÓN

### 1.1 Descripción General del Sistema

**RuesFastAPI** es una aplicación backend desarrollada en Python mediante el framework **FastAPI**, diseñada para procesar, enriquecer y unificar información de ferretería proveniente de múltiples fuentes de datos (RUES, APIFY, ARGOS). El sistema integra inteligencia artificial mediante la API de Google Gemini para análisis de imágenes y geolocalización mediante Google Maps para validar direcciones y obtener coordenadas exactas.

El sistema está optimizado para:
- **Procesamiento masivo** de archivos Excel con registros de negocios
- **Análisis inteligente** de imágenes usando IA (Google Gemini)
- **Sincronización y unificación** de datos de múltiples fuentes
- **Visualización en mapa de calor** con clasificación de clientes
- **Gestión de contactos** y relación comercial

### 1.2 Propósito del Documento

Este documento describe la arquitectura, estructura y flujo operativo de la aplicación para permitir que desarrolladores, administradores de sistemas y equipos técnicos comprendan:
- Cómo funciona la aplicación
- Dónde y cómo se implementa cada funcionalidad
- Cómo se comunican los componentes
- Cómo mantener y escalar el sistema

### 1.3 Alcance

Este documento cubre:
- ✅ Arquitectura y diseño del sistema
- ✅ Estructura y organización del código
- ✅ Flujo de datos y procesamiento
- ✅ Integración con bases de datos
- ✅ APIs externas utilizadas
- ✅ Procedimientos de configuración
- ✅ Buenas prácticas implementadas

No cubre:
- ❌ Instalación paso a paso (ver README)
- ❌ Guía de usuario final
- ❌ Procedimientos de deployment específicos

---

## 2. TECNOLOGÍAS UTILIZADAS

### 2.1 Stack Principal

| Componente | Versión | Propósito |
|-----------|---------|----------|
| **Python** | 3.x | Lenguaje base |
| **FastAPI** | 0.109.2 | Framework web asincrónico |
| **Uvicorn** | 0.27.1 | Servidor ASGI |
| **Pandas** | 2.2.0 | Procesamiento de datos tabulares |
| **pyodbc** | 5.1.0 | Conexión a SQL Server |

### 2.2 Integraciones y Servicios Externos

| Servicio | Propósito | Autenticación |
|----------|----------|----------------|
| **Google Maps API** | Geocodificación, búsqueda de lugares, fotos y Street View | API Key |
| **Google Gemini AI** | Análisis de imágenes con IA (detección de productos, teléfonos, marcas) | API Key |
| **Base de Datos** | SQL Server (local) | Credenciales ODBC |

### 2.3 Librerías Secundarias

```
openpyxl==3.1.2           → Lectura de archivos Excel
requests==2.31.0          → Cliente HTTP para APIs externas
python-dotenv==1.0.1      → Gestión de variables de entorno
thefuzz==0.22.1           → Fuzzy matching para comparación de cadenas
python-Levenshtein==0.25.1 → Optimización de distancia Levenshtein
```

---

## 3. ARQUITECTURA DEL SISTEMA

### 3.1 Tipo de Arquitectura

La aplicación implementa una arquitectura **en capas** con separación clara de responsabilidades:

```
┌─────────────────────────────────────────┐
│       CAPA DE PRESENTACIÓN              │
│  (FastAPI Routes & HTTP Endpoints)      │
│          main.py                        │
└────────────────┬────────────────────────┘
                 │
┌────────────────▼────────────────────────┐
│       CAPA DE SERVICIOS                 │
│  (Lógica de Negocio)                    │
│  - services.py (Google, Gemini)         │
│  - procesador.py (RUES)                 │
│  - procesador_argos_final.py (ARGOS)   │
│  - sincronizador.py (Unificación)      │
└────────────────┬────────────────────────┘
                 │
┌────────────────▼────────────────────────┐
│    CAPA DE ACCESO A DATOS               │
│  (Data Access Layer)                    │
│  - data_access.py                       │
│  - interfaces.py (Contratos)            │
└────────────────┬────────────────────────┘
                 │
┌────────────────▼────────────────────────┐
│     CAPA DE INFRAESTRUCTURA             │
│  (Configuración y Conexiones)           │
│  - config.py                            │
│  - database.py                          │
│  - .env (Variables)                     │
└─────────────────────────────────────────┘
        │                        │
        ▼                        ▼
    SQL Server              APIs Externas
    (Base Datos)        (Google Maps/Gemini)
```

### 3.2 Componentes Principales

#### **Capa de Presentación (main.py)**
- Define todos los endpoints HTTP
- Maneja validación de entrada
- Orquesta llamadas a servicios
- Gestiona respuestas y códigos de error
- Implementa CORS para acceso desde frontend

#### **Capa de Servicios**
- **services.py**: Implementa Google Maps (geocodificación, búsqueda, fotos, Street View) y Gemini (análisis de imágenes)
- **procesador.py**: Orquesta el flujo completo para archivos RUES
- **procesador_argos_final.py**: Orquesta el flujo completo para archivos ARGOS
- **sincronizador.py**: Unifica datos de múltiples fuentes (RUES, APIFY, ARGOS)
- **mapa_utils.py**: Clasifica negocios por categoría comercial

#### **Capa de Acceso a Datos**
- **data_access.py**: Encapsula llamadas a Stored Procedures
- **interfaces.py**: Define contratos para implementaciones de servicios

#### **Capa de Infraestructura**
- **config.py**: Carga variables de entorno
- **database.py**: Gestiona conexiones a SQL Server

---

## 4. ESTRUCTURA DEL PROYECTO

### 4.1 Jerarquía de Archivos

```
RuesFastapi/
│
├── main.py                    ← PUNTO DE ENTRADA. FastAPI app + endpoints
├── requirements.txt           ← Dependencias Python
├── .env                       ← Variables de entorno (API keys, credenciales BD)
│
├── CAPA DE CONFIGURACIÓN
├── config.py                  ← Carga variables de .env y prompt.txt
├── database.py                ← Conexión a SQL Server (pyodbc)
│
├── CAPA DE SERVICIOS EXTERNOS
├── services.py                ← Google Maps API + Google Gemini
├── interfaces.py              ← Clases abstractas (BuscadorLugaresInterface, AnalizadorImagenesInterface)
│
├── CAPA DE LÓGICA DE NEGOCIO
├── procesador.py              ← Orquestación completa de archivos RUES
├── procesador_argos_final.py  ← Orquestación completa de archivos ARGOS
├── sincronizador.py           ← Sincronización y unificación de datos
├── mapa_utils.py              ← Clasificación de negocios (heat map)
├── filtro_relevancia.py       ← Validaciones de relevancia de datos
│
├── CAPA DE ACCESO A DATOS
├── data_access.py             ← Wrapper de Stored Procedures (SP_*)
│
├── SQL Scripts (Referencia)
├── *.sql                      ← Scripts de creación de tablas y SPs
├── prompt.txt                 ← Prompt para Gemini (usado por config.py)
│
├── Datos de Ejemplo
├── *.xlsx                     ← Archivos Excel de prueba/datos
│
├── Scripts de Desarrollo
├── run_with_logs.py           ← Iniciar servidor CON --reload (desarrollo)
├── start_server.py            ← Iniciar servidor SIN --reload (producción)
│
├── Archivos de Debug [PUEDEN ELIMINARSE]
├── debug_rues_insert.py       ← Script de debug
├── debug_rues_insert2.py      ← Script de debug
├── debug_sp.py                ← Script de debug
├── find_rojas.py              ← Script de debug
├── test_procesar_rues.py      ← Script de test
│
└── Directorios del Sistema
    ├── __pycache__/           ← Cache automático de Python
    ├── venv/                  ← Entorno virtual
    └── .claude/               ← Configuración de IDE
```

### 4.2 Descripción Detallada de Archivos Críticos

#### **main.py** (902 líneas)
```
RESPONSABILIDAD: Punto de entrada y exposición de endpoints

COMPONENTES:
├── Inicialización de FastAPI
│   ├── app = FastAPI(...)
│   └── Middleware CORS activado
│
├── Servicios instanciados
│   ├── GoogleMapsService()      → Buscador de lugares
│   ├── GeminiService()          → Analizador de imágenes IA
│   ├── ProcesadorRUES()         → Orquestador RUES
│   └── ProcesadorArgos()        → Orquestador ARGOS
│
├── Endpoints de CONTROL
│   ├── GET  /                   → Health check
│   └── GET  /test-db            → Validar conexión BD
│
├── Endpoints de PROCESAMIENTO
│   ├── POST /procesar-info-argos          → Inicia procesamiento ARGOS
│   ├── GET  /estado-argos/{file_id}       → Consulta progreso ARGOS
│   ├── GET  /historial-argos              → Lista histórico ARGOS
│   ├── POST /procesar-RUES                → Inicia procesamiento RUES
│   ├── GET  /estado-rues/{file_id}        → Consulta progreso RUES
│   └── GET  /historial-rues               → Lista histórico RUES
│
├── Endpoints de SINCRONIZACIÓN
│   ├── POST /sincronizar                  → Inicia sincronización
│   ├── GET  /sincronizar/{job_id}         → Consulta estado sincronización
│   └── GET  /sincronizar/{job_id}/descartados → Lista registros rechazados
│
└── Endpoints de MAPA
    ├── GET  /mapa/negocios                → Listado con filtros
    ├── GET  /mapa/negocios/{id}           → Detalle de negocio
    ├── GET  /mapa/filtros                 → Valores para dropdowns
    └── GET  /mapa/resumen                 → Resumen por categoría
```

#### **config.py** (32 líneas)
```
RESPONSABILIDAD: Centralizar configuración

CARGAS:
├── Variables de entorno (.env)
│   ├── DB_USER, DB_PASSWORD, DB_SERVER, DB_DATABASE
│   ├── GOOGLE_API_KEY, GEMINI_API_KEY
│   ├── GEMINI_MODEL, GEMINI_TEMPERATURE
│   └── URLs de APIs
│
└── Prompt de Gemini
    ├── Intenta cargar desde prompt.txt primero
    └── Fallback a .env si no existe archivo
```

#### **database.py** (26 líneas)
```
RESPONSABILIDAD: Gestionar conexiones a SQL Server

FUNCIÓN CRÍTICA:
├── get_db_connection()
│   ├── Construye string de conexión con pyodbc
│   ├── Usa ODBC Driver 18 para SQL Server
│   ├── Configura encriptación de conexión
│   └── Retorna conexión o None si falla
│
└── Manejo de errores
    └── Registra errores en console
```

#### **services.py** (500+ líneas)
```
RESPONSABILIDAD: Implementar integraciones con Google

CLASES:

1. GoogleMapsService(BuscadorLugaresInterface)
   ├── geocodificar_direccion()    → Google Geocoding API
   ├── buscar_lugar()              → Nearby Search (3 estrategias)
   ├── obtener_detalles_lugar()    → Google Places Details
   ├── obtener_fotos_base64()      → Descarga y convierte a base64
   ├── obtener_street_view()       → Street View (8 ángulos, 2 zooms)
   └── Funciones auxiliares (distancia, filtros)

2. GeminiService(AnalizadorImagenesInterface)
   ├── analizar_fotos()            → Envía imágenes a Gemini
   └── Parsea respuesta JSON

INTEGRACIONES:
├── requests.get() para HTTP
├── base64.b64encode() para imágenes
├── json.loads() para respuestas
└── Rate limiting y manejo de errores
```

#### **interfaces.py** (42 líneas)
```
RESPONSABILIDAD: Definir contratos para servicios

INTERFACES ABSTRACTAS:

1. BuscadorLugaresInterface (ABC)
   ├── geocodificar_direccion()
   ├── buscar_lugar()
   ├── obtener_detalles_lugar()
   ├── obtener_fotos_base64()
   └── obtener_street_view()

2. AnalizadorImagenesInterface (ABC)
   └── analizar_fotos()

PROPÓSITO:
└── Permitir múltiples implementaciones (ej: Mapbox, Claude Vision)
```

#### **procesador.py** (300+ líneas)
```
RESPONSABILIDAD: Orquestar flujo completo de RUES

CLASE: ProcesadorRUES

MÉTODOS PRINCIPALES:
├── orquestar_flujo_completo()
│   ├── Carga Excel masivo
│   ├── Procesa por lotes (batch)
│   ├── Limpia archivos temporales
│   └── Actualiza estado en BD
│
├── _cargar_excel_masivo()
│   ├── Lee archivo Excel
│   ├── Prepara datos
│   └── Ejecuta SP_INSERTARREGISTRORUES (batch insert)
│
├── _procesar_por_batch()
│   ├── Obtiene registros pendientes
│   ├── Para cada registro:
│   │   ├── Geocodifica dirección
│   │   ├── Busca lugar en Google Maps
│   │   ├── Obtiene fotos y Street View
│   │   ├── Analiza con Gemini
│   │   └── Guarda resultados en BD
│   └── Maneja reintentos en caso de error
│
└── _extraer_nombre_empresa_de_rues()
    ├── Analiza si es persona natural o empresa
    └── Retorna nombre para buscar en Maps
```

#### **procesador_argos_final.py** (500+ líneas)
```
RESPONSABILIDAD: Orquestar flujo completo de ARGOS

CLASE: ProcesadorArgos

DIFERENCIAS vs RUES:
├── Acepta DataFrame como entrada (además de archivo)
├── Aplica filtros de departamento/municipio
├── Procesa datos más estructurados
└── Misma estrategia de geocodificación y análisis

MÉTODOS:
├── orquestar_flujo_completo_dataframe_desde_archivo()
│   ├── Lee Excel
│   ├── Aplica filtros
│   └── Orquesta procesamiento
│
└── [Métodos similares a ProcesadorRUES]
```

#### **sincronizador.py** (600+ líneas)
```
RESPONSABILIDAD: Sincronizar y unificar datos de múltiples fuentes

CARACTERÍSTICAS:
├── Cola de trabajos (threading.Queue)
├── Worker thread ejecutando trabajos en serie
├── Evita procesamiento simultáneo (lock)
├── Calcula posición en cola para el frontend

FUNCIONES PÚBLICAS:
├── encolar_sincronizacion()
│   ├── Crea trabajo nuevo
│   ├── Lo agrega a cola
│   └── Retorna job_id
│
├── estado_sincronizacion(job_id)
│   └── Retorna estado actual del trabajo
│
└── garantizar_tablas()
    └── Crea tablas necesarias si no existen

LÓGICA INTERNA:
├── Fuzzy matching (thefuzz) para agrupar registros similares
├── Merge de campos con reglas específicas
│   ├── coalesce()         → Primer valor no nulo
│   ├── prefer_longer()    → Cadena más larga
│   ├── prefer_bit_or()    → True si alguno es True
│   └── prefer_higher_confidence() → Nivel de confianza máximo
│
└── Limpieza de datos
    ├── Normalización de teléfonos
    ├── Extracción de municipios desde direcciones
    └── Limpieza de caracteres especiales
```

#### **mapa_utils.py** (192 líneas)
```
RESPONSABILIDAD: Clasificación de negocios en heat map

CATÁLOGO DE MARCAS:
└── ALIAS_MARCAS_CEMENTO: dict con 15+ marcas (Argos, Holcim, ALION, etc.)

FUNCIONES:
├── extraer_marcas_cemento(materiales)
│   ├── Busca patrón "cemento (Marca1, Marca2)"
│   ├── Fallback: busca marcas por palabra completa
│   └── Retorna lista ordenada
│
├── clasificar_negocio(vende_cemento, marcas, materiales)
│   └── Retorna una de 6 categorías:
│       ├── CLIENTE_ARGOS      (solo Argos)
│       ├── CLIENTE_MIXTO      (Argos + otras)
│       ├── COMPETENCIA        (solo otras marcas)
│       ├── SIN_MARCA          (vende cemento, sin marca)
│       ├── PROSPECTO          (no vende cemento)
│       └── SIN_ANALISIS       (sin datos IA)
│
└── sql_condicion_categoria(categoria)
    └── Genera SQL WHERE para filtrar por categoría
```

#### **data_access.py** (300+ líneas)
```
RESPONSABILIDAD: Encapsular llamadas a Stored Procedures

GRUPOS DE FUNCIONES:

1. ARGOS
   ├── argos_insertar_registro()
   ├── argos_obtener_pendientes()
   ├── argos_marcar_procesado()
   ├── argos_upsert_negocio()
   ├── argos_obtener_contactos()
   └── [Más funciones ARGOS]

2. RUES
   ├── rues_verificar_y_registrar_upload()
   ├── rues_obtener_pendientes()
   ├── rues_marcar_procesado()
   ├── rues_actualizar_contactos()
   └── [Más funciones RUES]

3. SINCRONIZACIÓN
   ├── sync_crear_trabajo()
   ├── sync_obtener_estado()
   ├── sync_obtener_descartados()
   └── [Más funciones sync]

4. MAPA
   ├── mapa_listar_negocios()
   ├── mapa_detalle_negocio()
   ├── mapa_obtener_contactos()
   ├── mapa_opciones_filtros()
   └── mapa_resumen_materiales()

PATRONES:
├── Conexión por función
├── Manejo de errores con logging
├── Normalización de diccionarios (keys lowercase)
└── Cierre de conexiones en finally
```

#### **filtro_relevancia.py**
```
RESPONSABILIDAD: Validar relevancia de datos

FUNCIÓN:
└── es_relevante(nombre, municipio_registrado, municipio_calculado)
    ├── Valida que municipios coincidan (fuzzy matching)
    ├── Evita datos inconsistentes
    └── Filtra registros de baja calidad
```

---

## 5. FLUJO DE LA APLICACIÓN

### 5.1 Flujo General de Procesamiento RUES

```
┌─────────────────────────────────────────────────────────────┐
│ 1. CLIENTE ENVÍA ARCHIVO                                    │
│    POST /procesar-RUES                                      │
│    - Archivo Excel                                          │
│    - Filtros opcionales (departamento, municipio)           │
└────────────────────┬────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────┐
│ 2. VALIDACIÓN INICIAL (main.py)                             │
│    ├── Verificar formato Excel                              │
│    ├── Calcular hash para evitar duplicados                 │
│    ├── Crear file_id único (UUID)                           │
│    ├── Registrar upload en BD (estado: processing)          │
│    └── Aplicar filtros de departamento/municipio            │
└────────────────────┬────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────┐
│ 3. RESPUESTA INMEDIATA AL CLIENTE                           │
│    {                                                         │
│      "file_id": "uuid-12345",                               │
│      "estado": "processing",                                │
│      "registros_a_procesar": 450,                           │
│      "url_estado": "/estado-rues/uuid-12345"                │
│    }                                                         │
└────────────────────┬────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────┐
│ 4. PROCESAMIENTO EN BACKGROUND (procesador.py)              │
│    [Tarea asincrónica - no bloquea la respuesta]            │
│                                                              │
│    Paso 4.1: CARGA MASIVA                                   │
│    ├── Leer Excel con pandas                                │
│    ├── Normalizar columnas                                  │
│    ├── Ejecutar SP_INSERTARREGISTRORUES (batch)             │
│    └── Guardar temp_rues_{file_id}.xlsx                     │
│                                                              │
│    Paso 4.2: OBTENER PENDIENTES                             │
│    ├── Consulta SP_OBTENER_PENDIENTES                       │
│    ├── Retorna registros no procesados                      │
│    └── Itera en lotes (e.g., 10 registros por ciclo)        │
│                                                              │
│    Paso 4.3: PARA CADA REGISTRO                             │
│    ├── Extractar nombre empresa (o usar dirección)          │
│    │                                                         │
│    │ Paso 4.3.1: GEOCODIFICAR                               │
│    │ ├── Llamar Google Geocoding API                        │
│    │ ├── Entrada: "Calle X, Municipio, Dpto, Colombia"      │
│    │ ├── Salida: (lat, lng, exacta)                         │
│    │ └── Fallback: reintenta solo "Municipio, Dpto"         │
│    │                                                         │
│    │ Paso 4.3.2: BUSCAR LUGAR                               │
│    │ ├── Estrategia 3 pasos:                                │
│    │ │  1) Buscar en coords exactas (radio 5-10m)           │
│    │ │  2) Buscar por nombre específico (radio 150m)        │
│    │ │  3) Fallback: buscar "ferretería" (radio 100m)       │
│    │ ├── Filtrar por distancia real (máx 100m)              │
│    │ └── Retornar lugar más cercano                         │
│    │                                                         │
│    │ Paso 4.3.3: OBTENER DETALLES                           │
│    │ ├── Google Places Details API                          │
│    │ ├── Extrae: teléfono, website, photos, etc.            │
│    │ └── Salida: place_id, name, formatted_address          │
│    │                                                         │
│    │ Paso 4.3.4: OBTENER FOTOS                              │
│    │ ├── Descargar fotos del lugar (máx 16)                 │
│    │ ├── Convertir a base64                                 │
│    │ └── Salida: lista de strings base64                    │
│    │                                                         │
│    │ Paso 4.3.5: OBTENER STREET VIEW                        │
│    │ ├── 8 ángulos diferentes (0°, 45°, 90°, etc.)          │
│    │ ├── 2 FOVs: zoom (40°) y amplia (80°)                  │
│    │ ├── Convertir a base64                                 │
│    │ └── Salida: lista de strings base64                    │
│    │                                                         │
│    │ Paso 4.3.6: SELECCIONAR MEJORES IMÁGENES               │
│    │ ├── TODAS las fotos de usuario + Street View           │
│    │ ├── Máximo 16 imágenes total                           │
│    │ └── Prioridad: fotos usuario > Street View zoom        │
│    │                                                         │
│    │ Paso 4.3.7: ANALIZAR CON GEMINI                        │
│    │ ├── Llamar API de Google Gemini                        │
│    │ ├── Prompt: Detectar productos, teléfono, confianza    │
│    │ ├── Respuesta JSON:                                    │
│    │ │  {                                                   │
│    │ │    "vende_lo_que_buscamos": true,                   │
│    │ │    "productos_observados": ["cemento", ...],        │
│    │ │    "whatsapp": "3XXXXXXXXX",                        │
│    │ │    "telefono_fijo": "XXXXXXX",                      │
│    │ │    "nivel_confianza": "alto"                        │
│    │ │  }                                                   │
│    │ └── Manejo de errores y reintentos                     │
│    │                                                         │
│    │ Paso 4.3.8: GUARDAR RESULTADOS                         │
│    │ ├── Ejecutar SP_INSERTARREGISTRORUES                   │
│    │ ├── O actualizar SP_ACTUALIZARREGISTRORUES             │
│    │ ├── Almacenar: coordenadas, análisis IA, contactos     │
│    │ └── Marcar como procesado                              │
│    │                                                         │
│    └── Manejar excepciones, logging, reintentos             │
│                                                              │
│    Paso 4.4: ACTUALIZAR ESTADO EN BD                        │
│    └── Marcar upload como "completed" o "failed"            │
│                                                              │
│    Paso 4.5: LIMPIAR ARCHIVOS TEMPORALES                    │
│    └── Eliminar temp_rues_{file_id}.xlsx                    │
└────────────────────┬────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────┐
│ 5. CLIENTE CONSULTA PROGRESO (polling)                      │
│    GET /estado-rues/{file_id}                               │
│                                                              │
│    Respuesta:                                               │
│    {                                                         │
│      "file_id": "uuid-12345",                               │
│      "estado": "processing",                                │
│      "registros": {                                         │
│        "total": 450,                                        │
│        "procesados": 230,                                   │
│        "pendientes": 220                                    │
│      },                                                     │
│      "mensaje": "En proceso... (230/450 registros listos)"  │
│    }                                                         │
└────────────────────┬────────────────────────────────────────┘
                     │
                     │ [Cuando completa]
                     │
┌────────────────────▼────────────────────────────────────────┐
│ 6. PROCESAMIENTO COMPLETADO                                 │
│    Estado en BD: "completed"                                │
│    Cliente recibe:                                          │
│    {                                                         │
│      "estado": "completed",                                 │
│      "mensaje": "[OK] Completado: 450 registros procesados" │
│    }                                                         │
└─────────────────────────────────────────────────────────────┘
```

### 5.2 Flujo de Sincronización/Unificación

```
┌─────────────────────────────────────────────────────────────┐
│ 1. CLIENTE INICIA SINCRONIZACIÓN                            │
│    POST /sincronizar                                        │
│    (Sin parámetros)                                         │
└────────────────────┬────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────┐
│ 2. CREAR TRABAJO (sincronizador.py)                         │
│    ├── Generar job_id único                                 │
│    ├── Crear registro en BD (estado: pendiente)             │
│    ├── Agregar a cola de procesamiento (Queue)              │
│    └── Respuesta inmediata con job_id                       │
└────────────────────┬────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────┐
│ 3. WORKER THREAD PROCESA (executa en serie)                │
│    [Un solo trabajo a la vez - mutex protection]            │
│                                                              │
│    Paso 3.1: OBTENER DATOS DE CADA FUENTE                  │
│    ├── RUES:  SP_LISTAR_TODOS_RUES                         │
│    ├── APIFY: SP_LISTAR_TODOS_APIFY                        │
│    └── ARGOS: SP_LISTAR_TODOS_ARGOS                        │
│                                                              │
│    Paso 3.2: CREAR DICCIONARIOS DE BÚSQUEDA                │
│    ├── Normalizar nombre, dirección, municipio             │
│    ├── Clave: nombre + municipio (fuzzy)                   │
│    └── Agrupar por clave                                   │
│                                                              │
│    Paso 3.3: HACER MATCHING FUZZY                          │
│    ├── Comparar nombres entre fuentes (thefuzz)             │
│    ├── Threshold: 80% similitud                             │
│    └── Crear grupos de registros relacionados               │
│                                                              │
│    Paso 3.4: MERGE DE CAMPOS                                │
│    ├── Teléfono: coalece (primer no nulo)                   │
│    ├── Dirección: prefer_longer (más caracteres)            │
│    ├── Productos: prefer_bit_or (si alguno es true)         │
│    ├── Score: prefer_higher_score (máximo)                  │
│    ├── Confianza: prefer_higher_confidence (alto > medio)   │
│    └── Fecha: prefer_most_recent (más reciente)             │
│                                                              │
│    Paso 3.5: VALIDAR RELEVANCIA                             │
│    ├── Verificar municipios coinciden (fuzzy)               │
│    ├── Filtrar registros de baja calidad                    │
│    └── Descartar si son muy diferentes                      │
│                                                              │
│    Paso 3.6: INSERTAR EN TABLA UNIFICADA                    │
│    ├── Tabla: FerreteriasUnificadas                         │
│    ├── Campos: nombre, dirección, ciudad, contactos...      │
│    └── Ejecutar SP_INSERTAR_UNIFICADA                       │
│                                                              │
│    Paso 3.7: INSERTAR REGISTROS DESCARTADOS                 │
│    ├── Tabla: FerreteriasDescartadas                        │
│    ├── Campos: nombre, fuente, motivo, fecha                │
│    └── Razones: baja relevancia, datos inconsistentes       │
│                                                              │
│    Paso 3.8: ACTUALIZAR ESTADO EN BD                        │
│    └── Marcar trabajo como "completado"                     │
└────────────────────┬────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────┐
│ 4. CLIENTE CONSULTA PROGRESO (polling)                      │
│    GET /sincronizar/{job_id}                                │
│                                                              │
│    Respuesta:                                               │
│    {                                                         │
│      "job_id": "uuid-xyz",                                  │
│      "estado": "procesando",                                │
│      "detalle": {                                           │
│        "total_rues": 1200,                                  │
│        "total_apify": 850,                                  │
│        "total_argos": 340,                                  │
│        "total_unificados": 1650,                            │
│        "total_solo_rues": 150,                              │
│        "total_solo_apify": 100,                             │
│        "total_solo_argos": 50,                              │
│        "posicion_cola": 0                                   │
│      },                                                     │
│      "mensaje": "Procesando..."                             │
│    }                                                         │
└────────────────────┬────────────────────────────────────────┘
                     │
                     │ [Cuando completa]
                     │
┌────────────────────▼────────────────────────────────────────┐
│ 5. SINCRONIZACIÓN COMPLETADA                                │
│    Estado en BD: "completado"                               │
│    Datos disponibles en:                                    │
│    - FerreteriasUnificadas (tabla principal)                │
│    - Accesible via /mapa/* endpoints                        │
└─────────────────────────────────────────────────────────────┘
```

### 5.3 Flujo de Consulta de Mapa (Heat Map)

```
┌─────────────────────────────────────────────────────────────┐
│ 1. CLIENTE SOLICITA NEGOCIOS CON FILTROS                    │
│    GET /mapa/negocios                                       │
│    Parámetros:                                              │
│    ├── departamento (opcional)                              │
│    ├── municipio (opcional)                                 │
│    ├── fuente (opcional: RUES, APIFY, ARGOS)                │
│    ├── nivel_confianza (alto/medio/bajo)                    │
│    ├── categoria_mapa (CLIENTE_ARGOS, COMPETENCIA, etc.)    │
│    ├── vende_cemento (true/false)                           │
│    └── limite (máximo 2000)                                 │
└────────────────────┬────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────┐
│ 2. VALIDAR PARÁMETROS (main.py)                             │
│    ├── Convertir categoria_mapa a condición SQL (mapa_utils)│
│    └── Validar valores permitidos                           │
└────────────────────┬────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────┐
│ 3. CONSULTAR DATOS (data_access.py)                         │
│    ├── Llamar SP_MAPA_LISTAR_NEGOCIOS                       │
│    │   └── Retorna: id, nombre, lat, lng, etc.              │
│    └── Contar total de resultados                           │
└────────────────────┬────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────┐
│ 4. ENRIQUECER DATOS (main.py)                               │
│    Para cada negocio:                                       │
│    ├── Extraer marcas de cemento (mapa_utils)               │
│    │   ├── Buscar patrón "cemento (Marca1, Marca2)"         │
│    │   └── Retornar lista de marcas                         │
│    │                                                         │
│    ├── Clasificar en categoría (mapa_utils)                 │
│    │   └── CLIENTE_ARGOS / MIXTO / COMPETENCIA / etc.       │
│    │                                                         │
│    ├── Asignar color para el mapa                           │
│    │   └── Color HEX según categoría                        │
│    │                                                         │
│    └── Obtener contactos asociados                          │
│        └── SP_MAPA_OBTENER_CONTACTOS                        │
└────────────────────┬────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────┐
│ 5. RETORNAR RESPUESTA ESTRUCTURADA                          │
│    {                                                         │
│      "total": 450,                                          │
│      "limite": 2000,                                        │
│      "offset": 0,                                           │
│      "negocios": [                                          │
│        {                                                     │
│          "id": 123,                                         │
│          "nombre": "Ferretería XYZ",                        │
│          "lat": 4.7110,                                     │
│          "lng": -74.0141,                                   │
│          "vende_cemento": true,                             │
│          "materiales_observados": "...",                    │
│          "marcas_cemento": ["Argos", "Holcim"],             │
│          "categoria_mapa": "CLIENTE_MIXTO",                 │
│          "color_mapa": "#2196F3",                           │
│          "nivel_confianza": "alto",                         │
│          "contactos": [                                     │
│            {                                                │
│              "nombre": "Juan Pérez",                        │
│              "cargo": "Gerente",                            │
│              "telefono": "3101234567",                      │
│              "genero": "M"                                  │
│            }                                                │
│          ]                                                  │
│        },                                                   │
│        ...                                                  │
│      ]                                                      │
│    }                                                         │
└─────────────────────────────────────────────────────────────┘
```

---

## 6. BASE DE DATOS

### 6.1 Tipo y Configuración

- **Motor:** SQL Server (versión 2016 o superior)
- **Driver:** ODBC Driver 18 for SQL Server
- **Conexión:** pyodbc (Python)
- **Ubicación:** Localhost (configurable vía .env)
- **Credenciales:** DB_USER, DB_PASSWORD (en .env)

### 6.2 Arquitectura de Bases de Datos

```
Esquema General:
├── TABLAS OPERATIVAS (datos brutos)
│   ├── RUES_UPLOADS          → Control de archivos RUES
│   ├── RUES_RECORDS          → Registros individuales RUES
│   ├── RUES_CONTACTOS        → Contactos de RUES
│   │
│   ├── ARGOS_UPLOADS         → Control de archivos ARGOS
│   ├── ARGOS_RECORDS         → Registros individuales ARGOS
│   ├── ARGOS_CONTACTOS       → Contactos de ARGOS
│   │
│   └── APIFY_NEGOCIOS        → Datos de APIFY
│
├── TABLAS DE UNIFICACIÓN
│   ├── FerreteriasUnificadas → Tabla principal (todas las fuentes)
│   ├── FerreteriasUnificadas_Contactos → Contactos unificados
│   └── FerreteriasDescartadas → Registros rechazados en sincronización
│
├── TABLAS DE CONTROL
│   ├── SINCRONIZACION_TRABAJOS → Control de trabajos sync
│   └── [Otras tablas de auditoría]
│
└── STORED PROCEDURES
    ├── SP_INSERTARREGISTRORUES
    ├── SP_OBTENER_PENDIENTES
    ├── SP_ARGOS_INSERTAR_REGISTROS
    ├── SP_ARGOS_MARCAR_PROCESADO
    ├── SP_MAPA_LISTAR_NEGOCIOS
    ├── SP_MAPA_OBTENER_CONTACTOS
    └── [Muchos más...]
```

### 6.3 Campos Principales en Tablas Críticas

#### Tabla: `FerreteriasUnificadas`
```sql
├── ID (int, PK)
├── NOMBRE (varchar 500)                    -- Nombre del negocio
├── DIRECCION (varchar 500)                 -- Dirección completa
├── MUNICIPIO (varchar 100)                 -- Ciudad/Municipio
├── DEPARTAMENTO (varchar 100)              -- Región
├── LAT (float)                             -- Latitud (Google Maps)
├── LNG (float)                             -- Longitud (Google Maps)
├── VENDE_CEMENTO (bit)                     -- true/false (IA)
├── MATERIALES_OBSERVADOS (text)            -- Análisis IA detallado
├── NIVEL_CONFIANZA (varchar 50)            -- alto/medio/bajo
├── TELEFONO (varchar 50)                   -- Teléfono principal
├── WHATSAPP (varchar 50)                   -- WhatsApp (10 dígitos)
├── EMAIL (varchar 255)                     -- Email comercial
├── FUENTES (varchar 500)                   -- RUES, APIFY, ARGOS (separadas por coma)
├── SCORE_FUZZY (float)                     -- Similitud en matching
├── FECHA_CREACION (datetime)               -- Creado
├── FECHA_ACTUALIZACION (datetime)          -- Última actualización
└── ULTIMO_ANALISIS (datetime)              -- Última vez procesado con IA
```

#### Tabla: `RUES_RECORDS`
```sql
├── RECORD_ID (int, PK)
├── FILE_ID (varchar 36)                    -- UUID del procesamiento
├── RAZON_SOCIAL (varchar 500)              -- Nombre de la empresa
├── NUMERO_IDENTIFICACION (varchar 50)      -- NIT/Cédula
├── TIPO_IDENTIFICACION (varchar 50)        -- NIT, CC, etc.
├── DEPARTAMENTO (varchar 100)
├── MUNICIPIO (varchar 100)
├── DIRECCION_COMERCIAL (varchar 500)
├── CORREO_COMERCIAL (varchar 255)
├── REP_LEGAL (varchar 255)
├── LATITUD (float)                         -- Coordenada
├── LONGITUD (float)                        -- Coordenada
├── PLACE_ID (varchar 255)                  -- Google Places ID
├── NOMBRE_LUGAR (varchar 500)              -- Nombre de Google
├── VENDE_LO_BUSCAMOS (bit)                 -- IA: true/false
├── PRODUCTOS_OBSERVADOS (text)             -- IA: lista de productos
├── WHATSAPP (varchar 50)
├── TELEFONO_FIJO (varchar 50)
├── NIVEL_CONFIANZA (varchar 50)
├── PROCESSED (bit)                         -- 0=pendiente, 1=completado
└── FECHA_PROCESAMIENTO (datetime)
```

### 6.4 Stored Procedures Críticos

```
SP_INSERTARREGISTRORUES
├── Entrada: file_id, razon_social, direccion, etc.
└── Acción: Insert en RUES_RECORDS con estado no procesado

SP_OBTENER_PENDIENTES(file_id)
├── Salida: Registros donde PROCESSED = 0
└── Uso: Ciclo de procesamiento

SP_MARCAR_PROCESADO(record_id)
├── Acción: Update PROCESSED = 1
└── Uso: Después de completar análisis

SP_MAPA_LISTAR_NEGOCIOS(offset, limite, filtros...)
├── Entrada: Parámetros de filtro
├── Salida: Lista de negocios con coordenadas
└── Optimización: Usan índices en MUNICIPIO, DEPARTAMENTO

SP_ARGOS_INSERTAR_REGISTROS
├── Entrada: Datos ARGOS (cliente, contacto, dirección)
└── Acción: Insert en ARGOS_RECORDS

[Muchos más para APIFY, SINCRONIZACIÓN, etc.]
```

---

## 7. MANEJO DE CONFIGURACIÓN

### 7.1 Archivo `.env`

```bash
# CONEXIÓN A SQL SERVER
DB_USER=sa                              # Usuario de SQL Server
DB_PASSWORD=Sa1234*                     # Contraseña
DB_SERVER=localhost                     # Host/IP del servidor
DB_DATABASE=ferreterias_db              # Nombre de la BD

# GOOGLE APIS
GOOGLE_API_KEY=AIzaSy...                # Key para Maps, Geocoding, Street View
GEMINI_API_KEY=AIzaSy...                # Key para Gemini AI

# CONFIGURACIÓN DE GEMINI
GEMINI_MODEL=gemini-2.5-flash          # Modelo a usar
GEMINI_TEMPERATURE=0.1                  # Determinismo (0=más determinista)

# URLS DE APIS
GOOGLE_MAPS_URL=https://maps.googleapis.com/maps/api/place/nearbysearch/json
GEMINI_BASE_URL=https://generativelanguage.googleapis.com/v1/models/

# PROMPT PARA GEMINI
PROMPT_COMPLETO="Eres un EXPERTO en analizar imágenes..."
```

### 7.2 Jerarquía de Carga de Configuración

```python
config.py
├── Carga .env con load_dotenv()
│
├── Lee variables simples:
│   ├── DB_USER, DB_PASSWORD, etc.
│   └── API_KEY, TEMPERATURES, URLs
│
└── Lee prompt con lógica especial:
    ├── Intenta cargar desde prompt.txt
    ├── Si no existe, fallback a .env
    └── Almacena en Config.PROMPT_COMPLETO
```

### 7.3 Tabla de Variables Críticas

| Variable | Tipo | Dónde se usa | Sensible |
|----------|------|-------------|----------|
| `DB_USER` | string | database.py | ✅ SÍ |
| `DB_PASSWORD` | string | database.py | ✅ SÍ |
| `DB_SERVER` | string | database.py | ❌ |
| `DB_DATABASE` | string | database.py | ❌ |
| `GOOGLE_API_KEY` | string | services.py | ✅ SÍ |
| `GEMINI_API_KEY` | string | services.py | ✅ SÍ |
| `GEMINI_MODEL` | string | services.py | ❌ |
| `GEMINI_TEMPERATURE` | float | services.py | ❌ |

---

## 8. DEPENDENCIAS DEL PROYECTO

### 8.1 requirements.txt Detallado

```
fastapi==0.109.2
┣━ Framework web moderno, asincrónico, de alto rendimiento
┣━ Características: validación de datos, documentación automática, serialización JSON
┗━ Usado en: main.py (routing, validación)

uvicorn==0.27.1
┣━ Servidor ASGI para ejecutar FastAPI
┣━ Manejo de concurrencia y peticiones HTTP
┗━ Usado en: run_with_logs.py, start_server.py

pandas==2.2.0
┣━ Procesamiento de datos tabulares (DataFrames)
┣━ Lectura de Excel, transformación de datos, análisis
┗━ Usado en: procesador.py, procesador_argos_final.py

openpyxl==3.1.2
┣━ Motor de lectura/escritura para archivos Excel .xlsx
┣━ Manejo de múltiples hojas, formateo, datos complejos
┗━ Usado por: pandas (engine='openpyxl')

requests==2.31.0
┣━ Cliente HTTP para llamar APIs externas
┣━ Google Maps API, Gemini API, manejo de sesiones
┗━ Usado en: services.py

python-dotenv==1.0.1
┣━ Carga variables de entorno desde archivo .env
┣━ Permite config sin modificar código
┗━ Usado en: config.py

pyodbc==5.1.0
┣━ Driver ODBC para conectar a SQL Server
┣━ Ejecución de Stored Procedures, cursores
┗━ Usado en: database.py, data_access.py

thefuzz==0.22.1
┣━ Fuzzy string matching (similitud entre textos)
┣━ Compara nombres a pesar de pequeñas diferencias
┣━ Threshold ajustable (e.g., 80% similitud)
┗━ Usado en: sincronizador.py (matching de registros)

python-Levenshtein==0.25.1
┣━ Optimización C para distancia Levenshtein
┣━ Acelera cálculo de similitud de strings
┗━ Depedencia de: thefuzz (mejora performance)
```

### 8.2 Matriz de Dependencias Internas

```
main.py (punto de entrada)
├── config.py           (carga variables)
├── database.py         (conexión BD)
├── services.py         (Google, Gemini)
│   ├── interfaces.py   (BuscadorLugaresInterface, etc.)
│   └── config.py       (API keys)
├── procesador.py       (RUES)
│   ├── interfaces.py
│   ├── database.py
│   └── services.py
├── procesador_argos_final.py (ARGOS)
│   ├── interfaces.py
│   ├── database.py
│   ├── services.py
│   └── data_access.py
├── sincronizador.py    (Sincronización)
│   ├── database.py
│   ├── filtro_relevancia.py
│   └── data_access.py
├── mapa_utils.py       (Clasificación)
└── data_access.py      (Acceso a datos)
    └── database.py
```

---

## 9. BUENAS PRÁCTICAS IDENTIFICADAS

### 9.1 Separación de Responsabilidades

✅ **Implementado correctamente:**

```
main.py               → Solo orquestar y exponer endpoints (no lógica)
services.py           → Solo integraciones externas
procesador*.py        → Solo orquestación de flujos
data_access.py        → Solo llamadas a BD (Stored Procedures)
config.py             → Solo configuración
database.py           → Solo conexiones
interfaces.py         → Solo contratos abstractos
```

**Beneficio:** Fácil de testear, mantener y modificar cada componente independientemente.

### 9.2 Uso de Capas

✅ **Arquitectura en capas bien definida:**

```
Presentación (main.py)
    ↓
Servicios (procesador, sincronizador, services)
    ↓
Data Access (data_access.py)
    ↓
Infraestructura (config, database)
```

**Beneficio:** Cambios en una capa no afectan otras (ej: cambiar BD sin tocar servicios).

### 9.3 Manejo de Errores

✅ **Implementado en puntos críticos:**

```python
# database.py
try:
    conn = pyodbc.connect(conn_str)
except pyodbc.Error as e:
    print(f"[X] Error: {e}")
    return None

# data_access.py
except Exception as e:
    logger.error(f"Error: {e}")
    return False
finally:
    if conn:
        conn.close()
```

**Beneficio:** Fallos aislados, no derrumban toda la aplicación.

### 9.4 Logging y Observabilidad

✅ **Logs estructurados en todas partes:**

```python
print(f"[*] Iniciando procesamiento...")  # Info
print(f"[OK] Operación completada")       # Éxito
print(f"[!] Advertencia")                 # Warning
print(f"[ERROR] Algo falló")              # Error
```

**Beneficio:** Fácil debuguear y monitorear en producción.

### 9.5 Validación de Datos

✅ **Validación en múltiples niveles:**

```python
# En FastAPI (automático):
@app.post("/endpoint")
async def endpoint(
    archivo: UploadFile = File(...),  # Obligatorio
    limite: int = Query(2000, ge=1, le=2000)  # Rango validado
)

# En servicios:
if not nombre or nombre.strip() == '':
    return None

# En BD:
safe_str(valor, max_len)  # Truncar a longitud máxima
```

**Beneficio:** Previene datos basura, inyección SQL, y crashes.

### 9.6 Seguridad Básica

✅ **Implementado:**

```python
# .env - Credenciales separadas del código
# pyodbc - Prepared statements (previene SQL injection)
# CORS configurado - Control de acceso
# Validación de entrada - Previene datos maliciosos
# TLS/Encriptación - Conexión a BD encriptada
```

**Limitaciones conocidas:**
- No hay autenticación de usuario (JWT)
- No hay rate limiting
- Logs contienen info del servidor (podría ser sensible)

---

## 10. RECOMENDACIONES Y MEJORAS FUTURAS

### 10.1 Mejoras de Seguridad (No implementar sin cambios mayores)

**Recomendación:**
- Agregar autenticación JWT para endpoints críticos
- Implementar rate limiting (ej: máximo 10 requests/minuto)
- Enmascarar detalles de errores en producción
- Usar conexión a BD con credenciales encriptadas

### 10.2 Mejoras de Rendimiento (Bajo demanda)

**Recomendación:**
- Agregar caché en memoria para Google Maps (coordenadas ya consultadas)
- Implementar paginación más eficiente en `/mapa/negocios`
- Usar índices en BD para campos de filtro frecuentes (MUNICIPIO, DEPARTAMENTO)
- Considerar Queue system (Celery/RabbitMQ) para trabajos pesados

### 10.3 Mejoras de Observabilidad (Útil en producción)

**Recomendación:**
- Agregar tracer distribuido (OpenTelemetry)
- Enviar métricas a Prometheus/Grafana
- Implementar Health Check endpoint completo
- Usar structured logging (JSON) en lugar de prints

### 10.4 Escalabilidad

**Limitaciones actuales:**
- Worker thread único (no escala horizontalmente)
- Conexiones a BD limitadas por número de workers

**Mejora recomendada:**
- Migrar queue de threading a Redis + Celery
- Esto permitiría múltiples workers en diferentes máquinas

### 10.5 Testing

**Estado actual:**
- No hay tests unitarios
- No hay tests de integración

**Recomendación:**
- Implementar pytest para tests unitarios
- Mockear Google APIs en tests
- Crear test suite de integración para flujos críticos

---

## 11. GLOSARIO Y TÉRMINOS

| Término | Significado |
|---------|------------|
| **RUES** | Registro Único Empresarial y Social (Colombia) |
| **APIFY** | Plataforma de web scraping para obtener datos de negocios |
| **ARGOS** | Base de datos de clientes de Cementos Argos |
| **Fuzzy Matching** | Comparación de strings permitiendo pequeñas diferencias |
| **Stored Procedure (SP)** | Función SQL almacenada en BD |
| **Geocodificación** | Convertir dirección a coordenadas (lat, lng) |
| **Place ID** | Identificador único de lugar en Google Maps |
| **Street View** | Fotografía panorámica de calle (Google) |
| **Base64** | Codificación de binario a texto ASCII |
| **CORS** | Control de acceso entre dominios (seguridad web) |
| **UUID** | Identificador único universal |
| **Threshold** | Umbral o límite de similitud/confianza |
| **Heat Map** | Mapa de calor que visualiza concentración de datos |
| **File ID** | Identificador único para cada procesamiento de archivo |
| **Job ID** | Identificador único para cada trabajo de sincronización |

---

## ANEXOS

### Anexo A: Comando para Iniciar la Aplicación

**Desarrollo (con reload automático):**
```bash
python run_with_logs.py
```

**Producción (sin reload):**
```bash
python start_server.py
```

**Manual:**
```bash
uvicorn main:app --host 0.0.0.0 --port 8001
```

### Anexo B: Estructura de Respuestas HTTP

**Respuesta Exitosa:**
```json
{
  "file_id": "uuid-12345",
  "estado": "processing",
  "registros_a_procesar": 450,
  "url_estado": "/estado-rues/uuid-12345"
}
```

**Respuesta de Error:**
```json
{
  "detail": "Formato no válido. Use Excel."
}
```

### Anexo C: Tabla Comparativa (RUES vs ARGOS)

| Aspecto | RUES | ARGOS |
|---------|------|-------|
| **Origen** | Registro estatal | Base de clientes |
| **Estructura** | Más variada | Más estructurada |
| **Proceso** | Geocodificación + búsqueda | Datos más completos |
| **Campos** | razón_social, NIT, dirección | canal, código_cliente, contactos |
| **Filtros** | Departamento, municipio | Departamento, municipio |
| **Contactos** | Extraídos de imagen (IA) | Incluidos en datos |

---

## INFORMACIÓN DE SOPORTE

**Para dudas técnicas sobre:**
- **Endpoints:** Ver docstring en main.py
- **Flujos:** Ver sincronizador.py
- **Servicios externos:** Ver services.py
- **Base de datos:** Ver data_access.py

**Fecha de Creación:** Mayo 2026
**Versión del Documento:** 1.3
**Última Actualización:** Mayo 2026

---

