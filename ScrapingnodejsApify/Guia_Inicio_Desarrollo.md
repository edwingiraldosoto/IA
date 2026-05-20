# 🚀 Guía Rápida de Inicio para Desarrolladores 🛠️

¡Hola, Dev! 👋 Bienvenido al proyecto. Esta guía te llevará paso a paso para configurar tu entorno local, instalar las dependencias necesarias y levantar correctamente tanto el **Backend** como el **Frontend**. 

---

## 📌 1. Requisitos Previos (Pre-requisitos)
Antes de comenzar a escribir código, asegúrate de tener las siguientes herramientas instaladas en tu computadora:
- 🟢 **Node.js** (Versión 18 o superior): Si no lo tienes, descárgalo e instálalo desde [nodejs.org](https://nodejs.org/). Incluye NPM (Node Package Manager).
- 🗄️ **SQL Server**: Instancia activa de SQL Server con la base de datos necesaria (`ferreterias_db`) previamente creada.

---

## ⚙️ 2. Arranque del Backend (API & Scraping)

El backend orquesta el scraping, la Inteligencia Artificial y la base de datos. Se ubica en la carpeta `ScrapingnodejsApify`.

### 📦 Paso 2.1: Instalar Dependencias
Abre tu terminal, ingresa a la carpeta del backend e instala todos los requerimientos listados en el `package.json`:

```bash
cd D:\ESTUDIO\IA\ScrapingnodejsApify
npm install
```
*(Esto descargará todas las librerías necesarias dentro de la carpeta oculta `node_modules`).*

### 🔑 Paso 2.2: Validar el Archivo `.env`
Antes de ejecutar la app, asegúrate de que exista tu archivo `.env` en la raíz del backend con todas las credenciales configuradas:
- Accesos a SQL Server (`DB_USER`, `DB_PASS`, `DB_SERVER`, `DB_NAME`).
- Tokens de Apify y Gemini.
- Puerto del servidor (`PORT=3000`).

### 🚀 Paso 2.3: Levantar el Servidor Backend
Para encender la API que escucha peticiones, ejecuta:

```bash
node server.js
```

**✅ Salida Esperada en tu Consola:**
Si tu configuración es correcta, deberías visualizar este registro (indicando que tu base de datos y variables de entorno funcionan perfectamente):

```text
PS D:\ESTUDIO\IA\ScrapingnodejsApify> node server.js
◇ injected env (14) from .env // tip: ⌘ suppress logs { quiet: true }
◇ injected env (0) from .env // tip: ⌘ enable debugging { debug: true }
📂 Cargados 31 jobs existentes
🚀 API corriendo en http://localhost:3000
📖 Endpoints:
   POST /api/jobs       → crear job
   GET  /api/jobs       → listar jobs
   GET  /api/jobs/:id   → ver job
```
*(Tu backend ya está listo y escuchando en el puerto 3000 🔥).*

---

## 🎨 3. Arranque del Frontend (Interfaz Web)

Ahora que nuestro servidor está encendido, vamos a levantar la parte visual.

### 📦 Paso 3.1: Instalar Dependencias Visuales
Abre **una nueva pestaña** en tu terminal (para no cerrar el backend) y navega hacia la carpeta del frontend:

```bash
cd D:\ESTUDIO\IA\frontend
npm install
```

### 🌐 Paso 3.2: Iniciar el Entorno de Desarrollo Frontend
Para iniciar la interfaz y habilitar la recarga en vivo de los componentes visuales (Hot Reloading), es **necesario ejecutar el siguiente comando**:

```bash
npm run dev
```

Esto desplegará un servidor de desarrollo local (comúnmente en `http://localhost:5173` u `8080`) a través del cual podrás visualizar el sistema en tu navegador web.

---

## 🤖 4. Comandos Extra (Opcional)

Si necesitas ejecutar las tareas del backend **sin levantar la API REST**, puedes usar:

- **▶️ Ejecutar un scrape manual en consola:**
  ```bash
  node app.js
  ```
- **⏰ Iniciar las tareas programadas automáticamente (Cron):**
  ```bash
  node cron.js
  ```

---
### 💡 Tips de Supervivencia:
1. **Dos Terminales:** Acostúmbrate a mantener 2 consolas activas: Una con `node server.js` y la otra con `npm run dev`.
2. **Reinicio de Backend:** Si haces algún cambio en el código fuente de Node.js, deberás presionar `Ctrl + C` para detener `node server.js` y volver a lanzarlo para ver los cambios reflejados.

**¡A codear!** 💻✨
