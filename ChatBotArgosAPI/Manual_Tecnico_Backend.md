# Manual Técnico del Sistema - Backend (ChatBot Argos API)

## 1. Introducción
**Descripción general del sistema:**
El sistema es una API Backend desarrollada para proporcionar un asistente conversacional (Chatbot) llamado **Panoptes**. Su objetivo es procesar lenguaje natural para interpretar intenciones del usuario, extraer parámetros y consultar información unificada sobre posibles clientes potenciales (ferreterías y establecimientos comerciales) almacenada en una base de datos relacional.

**Propósito del documento:**
Este documento sirve como guía técnica completa del backend, proporcionando a desarrolladores y equipos técnicos una visión profunda de la arquitectura, componentes, flujos de datos y configuración necesarios para el mantenimiento y evolución del sistema.

**Alcance:**
El alcance abarca el análisis del código fuente del backend, incluyendo el enrutamiento HTTP, la integración con la base de datos, el procesamiento mediante el agente basado en Modelos de Lenguaje Grande (LLM), y la gestión de configuraciones y dependencias. No se incluye la documentación del cliente (frontend).

---

## 2. Tecnologías Utilizadas
- **Lenguaje de Programación:** Python 3.x
- **Framework Web:** FastAPI (v0.111.0) para la creación ágil de endpoints HTTP y documentación automática.
- **Servidor ASGI:** Uvicorn (v0.30.1)
- **Validación de Datos y Configuración:** Pydantic (v2.7.4) y Pydantic-Settings (v2.3.4)
- **Base de Datos:** SQL Server conectado mediante la librería `pyodbc` (v5.1.0) y driver ODBC 18.
- **Motor de Inteligencia Artificial:** Integración directa con la API de Google Gemini (vía peticiones HTTP/REST con `requests`).
- **Orquestación del Agente:** LangGraph (`langgraph`) para gestionar el flujo de estados del chatbot.
- **Gestión de Entorno:** `python-dotenv` (v1.0.1) para la lectura de variables de entorno locales.

---

## 3. Arquitectura del Sistema
El proyecto emplea una **arquitectura por capas orientada a servicios** con **Inyección de Dependencias**. Se basa en interfaces abstractas para desacoplar el core lógico de los detalles de infraestructura.

Los componentes principales se organizan de la siguiente manera:

1. **Capa de Presentación / API (`main.py`):** Define los endpoints REST, gestiona el CORS y recibe las solicitudes HTTP, transformando los objetos al formato requerido por el agente.
2. **Capa Lógica / Agente (`agent.py`):** Contiene la inteligencia del negocio. Implementa un grafo de estados (LangGraph) que dirige la conversación desde la interpretación de intenciones, extracción de parámetros, consultas a cache, y generación de la respuesta final.
3. **Capa de Servicios de Dominio (`interfaces.py`):** Define los contratos (Clases Abstractas) para los conectores externos, garantizando el polimorfismo y facilitando pruebas unitarias.
4. **Capa de Infraestructura (`services.py`):** Implementa las interfaces mediante las clases de servicio reales (`SQLServerService` y `GeminiService`), manejando conexiones, queries SQL, y peticiones HTTP a la API de LLM.
5. **Capa de Configuración (`config.py` y `prompts.json`):** Gestiona variables de entorno y define el comportamiento estático del LLM a través de plantillas separadas del código lógico.

**Diagrama Lógico:**
```text
Cliente HTTP 
   │
   ▼
[ main.py ] (FastAPI Endpoint)
   │
   ├─ Inyecta ─ [ services.py ] (SQLServerService, GeminiService)
   │
   ▼
[ agent.py ] (ChatbotAgent)
   │
   ├── (1) Analiza intención / Extrae parámetros -> [ GeminiService ]
   ├── (2) Consulta datos -> [ SQLServerService ] (Base de Datos)
   └── (3) Genera respuesta enriquecida -> [ GeminiService ]
   │
   ▼
Retorna Respuesta JSON al Cliente
```

---

## 4. Estructura del Proyecto

A continuación, se detalla la función de cada archivo y carpeta dentro del proyecto:

```text
ChatBotArgosAPI/
├── main.py              # Punto de entrada principal. Configura FastAPI, middleware CORS, define los esquemas Pydantic y el endpoint POST `/api/chat`. Instancia dependencias y ejecuta el agente.
├── agent.py             # Lógica central del chatbot. Orquesta el flujo usando LangGraph, contiene la gestión de caché y toma de decisiones basadas en la entrada del usuario.
├── services.py          # Infraestructura concreta. `SQLServerService` ejecuta consultas directas (SQL nativo). `GeminiService` maneja reintentos lógicos y la comunicación con las APIs de IA.
├── interfaces.py        # Clases abstractas puras (`DatabaseInterface`, `LLMInterface`). Definen el contrato obligatorio para los servicios que interactúan con el agente.
├── config.py            # Manejo de configuración de variables mediante Pydantic BaseSettings, centralizando los datos de acceso, llaves y parámetros de los modelos de IA.
├── prompts.json         # Almacenamiento externo de la personalidad, contexto y plantillas de inyección del agente LLM (ej. system_prompt, prompt_extraccion).
├── requirements.txt     # Manifiesto de dependencias de Python instaladas, crucial para reproducir el entorno.
└── .env                 # Variables de entorno secretas (no versionadas) para la configuración local y de despliegue.
```

---

## 5. Flujo de la Aplicación

El sistema procesa una consulta bajo el siguiente flujo:

1. **Recepción HTTP:** El cliente realiza un POST a `/api/chat` enviando un objeto JSON con el `historial` de mensajes previos y el `mensaje` actual.
2. **Transformación:** FastAPI, a través de Pydantic, valida la estructura y `main.py` formatea el historial a una lista de diccionarios.
3. **Inicio del Grafo (Nodo 1: Extraer Datos):**
    - Se verifica si es un saludo de identidad. Si no, se hace un llamado al LLM para extraer la intención y los parámetros del mensaje.
    - Se revisa la caché de la aplicación en memoria (basada en el hash de los parámetros). Si hay un *hit*, se usan los datos inmediatamente.
    - De lo contrario, se solicita a `DatabaseInterface` ejecutar la consulta en la base de datos (Ej: `buscar_combinado`).
4. **Respuesta del Grafo (Nodo 2: Analizar con IA):**
    - Los datos de la base de datos y la pregunta original se inyectan en una plantilla de prompt enriquecido.
    - Se envía toda la información como contexto al LLM a través de `LLMInterface`.
5. **Generación y Retorno:** El LLM redacta una respuesta coherente en lenguaje natural. El resultado fluye de vuelta hasta `main.py` y se retorna al cliente como respuesta HTTP estructurada.

**Diagrama de Flujo:**
```text
Usuario -> POST /api/chat -> [Validación Pydantic] -> ChatbotAgent.procesar_mensaje()
    |
    |-> [Nodo: extraer_datos]
    |      |-> ¿Caché válido? -> SÍ -> Retorna datos a Nodo 2
    |      |
    |      |-> NO -> Extrae Parámetros (LLM) -> Consulta Base de Datos (SQL Server)
    |
    |-> [Nodo: analizar_con_ia]
           |-> Inyecta Prompt JSON + Datos SQL + Mensaje Usuario
           |-> Envía a API de Gemini -> Recibe Respuesta Textual
           |
Retorna Respuesta <- JSON {"respuesta": "..."} <-
```

---

## 6. Base de Datos
- **Motor:** SQL Server.
- **Conexión:** Se realiza mediante el driver ODBC 18 (utilizando la cadena de conexión generada en `SQLServerService` con `pyodbc`). Las consultas se realizan mediante sentencias SQL preparadas (parametrizadas) para prevenir inyecciones SQL.
- **Tablas Inferidas:**
  - Existe una tabla principal denominada `FerreteriasUnificadas`.
  - **Columnas clave identificadas:** `ID`, `NOMBRE`, `TELEFONO`, `WHATSAPP`, `MUNICIPIO`, `DEPARTAMENTO`, `DIRECCION_COMERCIAL`, y columnas booleanas o flags como `VENDE_CEMENTO`, `VENDE_TUBOS`, `VENDE_VARILLAS`, etc.
  - La tabla almacena métricas y metadatos adicionales como `SCORE`, `MATERIALES_OBSERVADOS` y `NIVEL_CONFIANZA`.

---

## 7. Manejo de Configuración
La configuración se maneja mediante el archivo `.env`, inyectado fuertemente tipado en `config.py` por `pydantic-settings`. Esto asegura que la aplicación fallará rápido si faltan credenciales vitales.

**Variables contenidas en `.env` (tipos de datos):**
- **Conexión a Base de Datos:**
  - `DB_SERVER`: Dirección IP/Hostname del servidor SQL.
  - `DB_DATABASE`: Nombre de la base de datos.
  - `DB_USERNAME` y `DB_PASSWORD`: Credenciales de acceso del usuario SQL.
- **Configuración de IA (Tokens/Modelos):**
  - `GEMINI_API_KEY`: Token de autenticación privado de Google AI Studio.
  - `GEMINI_MODEL`: (Opcional, con valor por defecto `gemini-2.5-flash`). Permite especificar la versión del modelo en uso.
  - `GEMINI_TEMPERATURE`: (Opcional, valor por defecto `0.3`). Permite ajustar la creatividad o exactitud de las respuestas.

*(Nota: Los valores en `.env` nunca deben subirse al control de versiones).*

---

## 8. Dependencias del Proyecto
Análisis de las dependencias clave en `requirements.txt`:

- **`fastapi`:** Framework robusto y rápido para crear el endpoint de la API REST.
- **`uvicorn[standard]`:** Servidor web rápido ASGI que expone la API de FastAPI.
- **`pydantic` y `pydantic-settings`:** Se encargan de tipar y validar todas las solicitudes entrantes (cuerpo JSON del Request) y cargar las variables de entorno sin validaciones manuales.
- **`pyodbc`:** Librería estándar de conexión C a bases de datos relacionales, utilizada para conectarse al servidor SQL Server.
- **`requests`:** Usado en `services.py` para hacer llamadas manuales HTTP sincrónicas a los endpoints de la API de Google Gemini en lugar de usar librerías nativas o SDKs, otorgando un manejo directo de errores y fallbacks.
- **`python-dotenv`:** Carga transparente del archivo local `.env` al sistema.

---

## 9. Buenas Prácticas Identificadas
1. **Separación de Responsabilidades (SRP) e Interfaces:** El sistema usa contratos estrictos (`DatabaseInterface`, `LLMInterface`). El archivo central (`agent.py`) desconoce cómo está implementada la base de datos o a qué LLM se está conectando.
2. **Inyección de Dependencias:** El paso de servicios (SQL, Gemini) como argumentos al constructor del Agente permite un código escalable y muy fácil de someter a pruebas (mocking).
3. **Mecanismo de Caché (`_cache` en `agent.py`):** Existe un almacenamiento en caché en la memoria local (con un Time-To-Live de 30 mins) para las consultas a BD usando un hash MD5 de los parámetros. Esto ahorra consultas redundantes y mitiga cuellos de botella en la concurrencia.
4. **Resiliencia (Manejo de Errores y Fallbacks):** `GeminiService` incluye un sistema iterativo que, si un modelo de IA (ej: 2.5-flash) está sobresaturado o experimenta un Rate Limit HTTP 429, transita hacia alternativas estables y efectivas automáticamente sin colapsar el sistema.
5. **Seguridad Básica (Consultas parametrizadas):** En `services.py`, las variables dinámicas se incorporan al SQL mediante tuplas (`?`), lo cual neutraliza los riesgos de inyección SQL.

---

## 10. Recomendaciones (Opcional)
- **Migración a SDK Oficial / Asincronía:** En `GeminiService` las peticiones se realizan de manera sincrónica usando `requests` dentro de una API asincrónica de FastAPI (`async def chat_endpoint`). Esto podría bloquear el Event Loop de ASGI, haciéndolo ineficiente bajo alta carga concurrente. Se recomienda usar `httpx` (para peticiones asíncronas) o el SDK oficial de Google y cambiar los métodos a `async`.
- **Registro (Logging) Estandarizado:** Se utilizan múltiples declaraciones `print()` para la depuración en terminal. Sería recomendable usar la librería nativa `logging` de Python para formatear los logs adecuadamente, guardarlos en archivos e inyectar niveles de severidad (INFO, WARNING, ERROR).
- **Gestor de Conexiones (Connection Pooling):** Para `pyodbc`, inicializar y cerrar la conexión en cada invocación de `_ejecutar_query` puede generar un alto overhead de latencia. Se recomienda implementar SQLAlchemy para usar un *connection pool* (un grupo de conexiones reutilizables).
