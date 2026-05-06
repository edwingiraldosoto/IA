# 🚀 Manual de Inicio Rápido para Desarrollo Local

¡Bienvenido! 🎉 Este documento te guiará paso a paso para configurar tu entorno de desarrollo y levantar los servicios localmente de manera exitosa. 💻✨

---

## 📋 1. Requisitos Previos

Antes de comenzar, asegúrate de tener instaladas las siguientes herramientas en tu sistema:

*   🐍 **Python:** Necesitarás tener Python instalado en tu máquina. Asegúrate de marcar la opción "Add Python to PATH" durante la instalación. Puedes descargarlo desde [python.org](https://www.python.org/).
*   📦 **pip:** Es el gestor de paquetes de Python (se instala automáticamente junto con las versiones recientes de Python).

---

## 🛠️ 2. Configuración del Entorno Virtual

Es una excelente práctica usar entornos virtuales para mantener las dependencias del proyecto totalmente aisladas. 🛡️

**Paso 1:** Abre tu terminal (PowerShell o CMD) y navega hasta la carpeta del proyecto.

**Paso 2:** Crea el entorno virtual ejecutando el siguiente comando:

```powershell
python -m venv venv
```

**Paso 3:** ¡Activa el ambiente! 

*   **En Windows (PowerShell):**
    ```powershell
    .\venv\Scripts\activate
    ```
*   *(Opcional) Si usas Mac/Linux:*
    ```bash
    source venv/bin/activate
    ```

> 💡 **Nota:** Sabrás que estás dentro del entorno virtual exitosamente porque notarás un prefijo `(venv)` al inicio de tu línea de comandos.

---

## 📦 3. Instalación de Dependencias

Con el entorno virtual activado, es hora de instalar todas las librerías necesarias (como FastAPI, Uvicorn, etc.) para que la magia suceda. 🪄

Ejecuta el siguiente comando para leer el archivo de requerimientos e instalar todo el conjunto:

```powershell
pip install -r requirements.txt
```
*(Nota: Si tu archivo se llama `requerimientos.txt`, asegúrate de cambiar el nombre en el comando).*

*(Espera unos momentos mientras la barra de progreso avanza y se instalan los paquetes... ⏳)*

---

## 🚀 4. Inicializar el Servidor Local

¡Ya casi estamos! Ahora vamos a levantar el servicio en nuestro entorno local. 🌟 

Asegúrate de estar en la raíz del proyecto (donde se encuentra el archivo principal, usualmente `main.py`) y ejecuta el servidor usando `uvicorn`.

Por ejemplo, para inicializarlo por el **puerto 8001**, usa el siguiente comando:

```powershell
uvicorn main:app --reload --port 8001
```

> 🔧 **Tip:** La bandera `--reload` es súper útil en desarrollo, ya que reiniciará automáticamente el servidor cada vez que guardes un cambio en el código.

### 📺 ¿Qué deberías ver en la consola?

Si todo salió a la perfección, verás unos logs similares a estos en tu terminal, indicando que todo está bajo control:

```powershell
(venv) PS D:\ESTUDIO\IA\RuesFastapi> uvicorn main:app --reload --port 8001
INFO:     Will watch for changes in these directories: ['D:\\ESTUDIO\\IA\\RuesFastapi']
INFO:     Uvicorn running on http://127.0.0.1:8001 (Press CTRL+C to quit)
INFO:     Started reloader process [37292] using WatchFiles
INFO:     Started server process [28420]
INFO:     Waiting for application startup.
INFO:     Application startup complete.
```

---

## 🥳 ¡Listo para Desarrollar!

Una vez veas el mensaje verde de `Application startup complete`, ¡tu API estará viva y lista para recibir peticiones! 🎯

*   Para probar que responde, abre tu navegador y ve a: **http://127.0.0.1:8001** 🌐
*   Para ver e interactuar con la **documentación automática (Swagger UI)** de la API, visita: **http://127.0.0.1:8001/docs** 📚🔥

> 🛑 **¿Terminaste por hoy?** Para apagar el servidor, simplemente haz clic en tu terminal y presiona `CTRL + C`. Luego, si deseas salir del entorno virtual, escribe `deactivate`.
