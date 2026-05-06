# 🚀 Guía de Inicio Rápido: Desarrollo Frontend (Panoptes)

¡Bienvenido/a al equipo! 🎉 Esta guía te llevará paso a paso para que puedas levantar el proyecto frontend en tu máquina local sin dolores de cabeza. 

El proyecto está construido con **React** y empaquetado con **Vite** ⚡, lo que lo hace súper rápido y moderno.

---

## 🛠️ 1. Requisitos Previos

Antes de tocar el código, asegúrate de tener las herramientas necesarias instaladas en tu computadora:

1. **Node.js**: Es el motor que necesitamos para correr las herramientas de JavaScript. 
   - Descárgalo desde [nodejs.org](https://nodejs.org/) e instala la versión recomendada (LTS).
   - *Tip:* Puedes verificar si ya lo tienes abriendo una terminal y escribiendo: `node -v`
2. **Git**: Para el control de versiones.
3. **Un buen editor de código**: Te recomendamos **Visual Studio Code (VS Code)** 💻.

---

## 📦 2. Instalación de Dependencias

A diferencia de Python (donde usas `pip install -r requirements.txt`), en el mundo de Node.js y React usamos `npm` (Node Package Manager). Las dependencias están listadas en el archivo `package.json`.

Sigue estos pasos:

1. Abre una terminal y navega hasta la carpeta del frontend:
   ```bash
   cd D:\ESTUDIO\IA\frontend
   ```
2. Ejecuta el comando de instalación para descargar todas las librerías necesarias (React, Leaflet, Vite, etc.):
   ```bash
   npm install
   ```
   ⏳ *Nota: Esto creará automáticamente una carpeta llamada `node_modules` (que puede ser un poco pesada). ¡No te preocupes, es normal!*

---

## ⚙️ 3. Configuración del Entorno (.env)

El frontend necesita saber dónde están los "cerebros" del backend (las APIs). Para esto, usamos un archivo oculto llamado `.env`.

Asegúrate de que en la raíz de tu proyecto (`D:\ESTUDIO\IA\frontend`) exista un archivo llamado `.env` con el siguiente contenido:

```env
# API del scraper (puerto 3000)
VITE_API_URL=http://localhost:3000/api

# API del chatbot FastAPI (puerto 8000)
VITE_CHAT_API_URL=http://localhost:8000/api

# API de RUES (puerto 8001)
VITE_RUES_API_URL=http://localhost:8001

# API de sincronización y ARGOS (puerto 8001)
VITE_SYNC_API_URL=http://localhost:8001
VITE_ARGOS_API_URL=http://localhost:8001

# API pública de Colombia
VITE_COLOMBIA_API_URL=https://api-colombia.com/api/v1
```
*💡 ¡Asegúrate de que tus microservicios backend estén corriendo en esos puertos para que la app funcione al 100%!*

---

## 🏃‍♂️ 4. ¡A Levantar el Servidor de Desarrollo!

Una vez instaladas las dependencias, estamos listos para encender los motores. 🏎️

En tu terminal (dentro de la carpeta del frontend), ejecuta:

```bash
npm run dev
```

### ¿Qué verás en la terminal?
Normalmente verás algo como esto:

```bash
D:\ESTUDIO\IA\frontend> npm run dev

> frontend@0.0.0 dev
> vite

Port 5173 is in use, trying another one...

  VITE v8.0.9  ready in 294 ms

  ➜  Local:   http://localhost:5174/
  ➜  Network: use --host to expose
  ➜  press h + enter to show help
```

**Explicación de lo que pasó:**
- Vite intenta iniciar en el puerto `5173` por defecto. Si tienes otra cosa corriendo ahí, inteligentemente buscará el siguiente puerto libre (en este caso el `5174`).
- Te dirá que está listo en cuestión de milisegundos (`ready in 294 ms` ⚡).

### 🌐 5. Abrir la Aplicación

Para ver tu aplicación, simplemente:
- Mantén presionada la tecla `Ctrl` en tu teclado y **haz clic** en el enlace azul que dice `http://localhost:5174/` en tu terminal.
- O copia esa dirección y pégala directamente en la barra de tu navegador web favorito (Chrome, Edge, Firefox).

¡Y listo! 🎉 Deberías estar viendo la interfaz del panel "Panoptes".

---

## 🚨 Solución de Problemas Comunes (Troubleshooting)

- **Error: `npm no se reconoce como un comando interno o externo`**
  👉 *Solución:* Significa que no has instalado Node.js o no reiniciaste la terminal después de instalarlo.
  
- **Veo la página en blanco o no cargan datos:**
  👉 *Solución:* Revisa tu consola del navegador (Clic derecho > Inspeccionar > Console). Probablemente algún servicio Backend (FastAPI o Node Scraper) no está corriendo o los puertos en tu `.env` no coinciden.

- **Para detener el servidor:**
  👉 *Solución:* Simplemente haz clic en tu terminal y presiona `Ctrl + C`. Te preguntará si deseas terminar el proceso, escribe `S` (o `Y`) y presiona Enter.

¡Feliz código! 💻🔥
