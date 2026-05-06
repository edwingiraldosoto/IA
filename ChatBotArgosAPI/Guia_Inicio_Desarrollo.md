# 🚀 Guía de Inicio Rápido para Desarrolladores

¡Bienvenido al proyecto **ChatBot Argos API** (Panoptes)! 🤖✨ 

Esta guía te llevará paso a paso para que puedas configurar tu entorno de desarrollo local, instalar las dependencias necesarias y levantar el servidor backend sin contratiempos.

---

## 🛠️ 1. Prerrequisitos

Antes de comenzar, asegúrate de tener instaladas las siguientes herramientas en tu sistema:

- 🐍 **Python 3.9 o superior:** Puedes descargarlo desde [python.org](https://www.python.org/downloads/). *(Asegúrate de marcar la casilla "Add Python to PATH" durante la instalación si estás en Windows).*
- 💻 **Git:** Para clonar y manejar el control de versiones (opcional si ya tienes los archivos).
- 🗄️ **Driver ODBC 18 para SQL Server:** Necesario para que Python pueda conectarse a la base de datos de Microsoft. Lo puedes descargar desde la [página oficial de Microsoft](https://learn.microsoft.com/es-es/sql/connect/odbc/download-odbc-driver-for-sql-server).

---

## 🏗️ 2. Configuración del Entorno de Trabajo

Es altamente recomendable utilizar un **Entorno Virtual** para evitar conflictos con otras librerías globales de Python que tengas en tu máquina.

1. **Abre tu terminal (PowerShell o CMD)** y navega hasta la carpeta del proyecto:
   ```powershell
   cd D:\ESTUDIO\IA\ChatBotArgosAPI
   ```

2. **Crea el entorno virtual** (si aún no existe la carpeta `venv`):
   ```powershell
   python -m venv venv
   ```

3. **Activa el entorno virtual:**
   - En **Windows (PowerShell)**:
     ```powershell
     .\venv\Scripts\activate
     ```
   - En **Mac / Linux** (si aplicara):
     ```bash
     source venv/bin/activate
     ```

> 💡 **Tip:** Sabrás que estás dentro del entorno virtual cuando veas `(venv)` al inicio de la línea de tu terminal.

---

## 📦 3. Instalación de Dependencias

Con tu entorno virtual activo `(venv)`, es hora de instalar todas las librerías mágicas que hacen funcionar a FastAPI, Pydantic, y la conexión a Base de Datos y Gemini.

Ejecuta el siguiente comando:
```powershell
pip install -r requirements.txt
```
*(Espera un momento mientras se descargan e instalan paquetes como `fastapi`, `uvicorn`, `pyodbc`, etc.)*

---

## ⚙️ 4. Configuración de Variables de Entorno

El proyecto necesita credenciales para la base de datos y la inteligencia artificial, las cuales por seguridad no se suben al repositorio. 

1. Busca (o crea) un archivo llamado **`.env`** en la raíz de la carpeta `ChatBotArgosAPI`.
2. Edítalo y asegúrate de que contenga las siguientes variables (remplaza los valores por los de tu base de datos y tu API key de Gemini):

```env
# 🗄️ Base de Datos (SQL Server)
DB_SERVER=tu_servidor.database.windows.net
DB_DATABASE=nombre_de_tu_db
DB_USERNAME=tu_usuario
DB_PASSWORD=tu_contraseña_secreta

# 🧠 Inteligencia Artificial (Google Gemini)
GEMINI_API_KEY=tu_api_key_de_google_ai_studio
GEMINI_MODEL=gemini-2.5-flash
GEMINI_TEMPERATURE=0.3
```

---

## 🚀 5. Levantar el Servidor (Modo Desarrollo)

¡Ya está todo listo! Ahora vamos a encender el motor de FastAPI utilizando Uvicorn. Asegúrate de seguir teniendo tu entorno virtual activado.

Ejecuta este comando para levantar el servidor en el puerto `8000` con recarga automática activada (ideal para ver los cambios en tiempo real):

```powershell
uvicorn main:app --reload --port 8000
```

Si todo está configurado correctamente, verás en tu terminal un log muy parecido a este:

```powershell
(venv) PS D:\ESTUDIO\IA\ChatBotArgosAPI> uvicorn main:app --reload --port 8000
INFO:     Will watch for changes in these directories: ['D:\\ESTUDIO\\IA\\ChatBotArgosAPI']
INFO:     Uvicorn running on http://127.0.0.1:8000 (Press CTRL+C to quit)
INFO:     Started reloader process [12688] using WatchFiles
INFO:     Started server process [4152]
INFO:     Waiting for application startup.
INFO:     Application startup complete.
```

---

## 🌐 6. Probar la API

¡Felicidades! 🎉 Tu backend ya está corriendo.

FastAPI genera documentación automática de tu código de forma nativa. Para verla y probar el ChatBot:

1. Abre tu navegador favorito.
2. Ve a la dirección interactiva de Swagger UI:
   👉 **[http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)**

Desde ahí podrás buscar el endpoint `POST /api/chat`, presionar el botón *"Try it out"*, enviar un JSON con un mensaje y ver cómo te responde Panoptes.

¡Feliz código! 💻🔥
