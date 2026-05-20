require('dotenv').config();
const axios = require('axios');

// =====================
// BUSCAR UBICACIÓN EXACTA EN GOOGLE MAPS
// =====================
async function buscarUbicacionEnMaps(nombreNegocio, direccion) {
    const GOOGLE_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

    if (!GOOGLE_API_KEY) {
        return null;
    }

    try {
        const query = `${nombreNegocio} ${direccion}`;
        const response = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
            params: {
                address: query,
                key: GOOGLE_API_KEY
            },
            timeout: 10000
        });

        if (response.data.results && response.data.results.length > 0) {
            const resultado = response.data.results[0];
            return {
                lat: resultado.geometry.location.lat,
                lng: resultado.geometry.location.lng,
                direccionFormato: resultado.formatted_address,
                precision: resultado.geometry.location_type
            };
        }
        return null;
    } catch (error) {
        console.error(`   ⚠️  Error geocodificación: ${error.message}`);
        return null;
    }
}

// =====================
// DESCARGAR STREET VIEW CON ORIENTACIÓN INTELIGENTE
// =====================
async function descargarStreetView(lat, lng, heading = 0, pitch = 0) {
    const GOOGLE_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

    if (!GOOGLE_API_KEY) {
        return null;
    }

    try {
        const response = await axios.get('https://maps.googleapis.com/maps/api/streetview', {
            params: {
                size: '800x600',          // Cambiar de 1920x1080 a 800x600 (Google comprime menos)
                location: `${lat},${lng}`,
                heading: heading,
                pitch: pitch,
                fov: 75,                  // Reducir FOV para mejor zoom/detalle
                key: GOOGLE_API_KEY
            },
            responseType: 'arraybuffer',
            timeout: 15000
        });

        if (response.status === 200) {
            const buffer = Buffer.from(response.data);
            const sizeKB = (buffer.length / 1024).toFixed(1);
            // Estimación de resolución basada en tamaño
            const estimatedRes = buffer.length > 200000 ? '800x600+' : buffer.length > 100000 ? '640x480' : '408x240';
            console.log(`          [SV API] Descargado: ${sizeKB} KB (estimado: ${estimatedRes})`);
            return buffer;
        }
        return null;
    } catch (error) {
        // Error silencioso - Street View puede no estar disponible
        return null;
    }
}

// =====================
// DESCARGAR STREET VIEW DESDE NOMBRE + DIRECCIÓN
// =====================
// Versión con zoom (FOV más pequeño para capturar letreros con mayor detalle)
async function descargarStreetViewZoom(lat, lng, heading = 0, pitch = 0) {
    const GOOGLE_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
    if (!GOOGLE_API_KEY) return null;

    try {
        const response = await axios.get('https://maps.googleapis.com/maps/api/streetview', {
            params: {
                size: '800x600',
                location: `${lat},${lng}`,
                heading: heading,
                pitch: pitch,
                fov: 40,  // FOV pequeño = zoom, mejor resolución de letreros cercanos
                key: GOOGLE_API_KEY
            },
            responseType: 'arraybuffer',
            timeout: 15000
        });

        if (response.status === 200) {
            const buffer = Buffer.from(response.data);
            const sizeKB = (buffer.length / 1024).toFixed(1);
            console.log(`          [SV ZOOM] Descargado: ${sizeKB} KB (fov=40, detalle mejorado)`);
            return buffer;
        }
        return null;
    } catch (error) {
        return null;
    }
}

async function descargarStreetViewDesdeNegocio(nombreNegocio, direccion, angulosDeseados = [0, 90, 180, 270]) {
    console.log(`\n📍 Localizando: ${nombreNegocio}`);

    // 1. Buscar ubicación exacta
    const ubicacion = await buscarUbicacionEnMaps(nombreNegocio, direccion);
    if (!ubicacion) {
        console.log(`   ❌ No se encontró la ubicación en Google Maps`);
        return [];
    }

    console.log(`   ✅ Ubicación encontrada: ${ubicacion.direccionFormato}`);
    console.log(`   📍 Coordenadas: ${ubicacion.lat.toFixed(4)}, ${ubicacion.lng.toFixed(4)}`);
    console.log(`   Descargando Street View desde ${angulosDeseados.length} ángulos...`);

    const imagenes = [];

    for (const heading of angulosDeseados) {
        // Cobertura 360° completa con 22 ángulos = cada ángulo es importante
        // Usar pitch=0 para cobertura consistente (22 ángulos es suficiente cobertura)
        const pitch = 0;

        const bufferNormal = await descargarStreetView(ubicacion.lat, ubicacion.lng, heading, pitch);
        const bufferZoom = await descargarStreetViewZoom(ubicacion.lat, ubicacion.lng, heading, pitch);

        // Elegir la que tenga mejor tamaño (zoom típicamente es mejor para letrero)
        let bufferMejor = bufferNormal;
        let fuente = 'normal';

        if (bufferZoom && bufferNormal) {
            // Si zoom tiene mejor tamaño (menos comprimido), usarlo
            if (bufferZoom.length > bufferNormal.length * 0.8) {
                bufferMejor = bufferZoom;
                fuente = 'zoom';
            }
        } else if (bufferZoom && !bufferNormal) {
            bufferMejor = bufferZoom;
            fuente = 'zoom';
        }

        if (bufferMejor) {
            const base64 = bufferMejor.toString('base64');
            imagenes.push({
                heading: heading,
                angulo: `${heading}°`,
                base64: base64,
                tamaño: bufferMejor.length,
                ubicacion: ubicacion,
                fuente: fuente
            });
            console.log(`   ✅ ${heading}° descargado (${(bufferMejor.length / 1024).toFixed(1)}KB, fuente: ${fuente})`);
        } else {
            console.log(`   ⚠️  ${heading}° - no disponible en esta ubicación`);
        }

        if (heading !== angulosDeseados[angulosDeseados.length - 1]) {
            await new Promise(r => setTimeout(r, 300));
        }
    }

    return imagenes;
}

// =====================
// DESCARGAR STREET VIEW MÚLTIPLES ÁNGULOS (versión original con coords)
// =====================
async function descargarStreetViewMultiplesAngulos(lat, lng, angulosDeseados = [0, 90, 180, 270]) {
    const imagenes = [];

    console.log(`\n📍 Street View para: ${lat.toFixed(4)}, ${lng.toFixed(4)}`);
    console.log(`   Descargando desde ${angulosDeseados.length} ángulos...`);

    for (const heading of angulosDeseados) {
        const buffer = await descargarStreetView(lat, lng, heading, 0);
        if (buffer) {
            const base64 = buffer.toString('base64');
            imagenes.push({
                heading: heading,
                angulo: `${heading}°`,
                base64: base64,
                tamaño: buffer.length
            });
            console.log(`   ✅ ${heading}° descargado`);
        }

        if (heading !== angulosDeseados[angulosDeseados.length - 1]) {
            await new Promise(r => setTimeout(r, 300));
        }
    }

    return imagenes;
}

module.exports = {
    descargarStreetView,
    descargarStreetViewMultiplesAngulos,
    descargarStreetViewDesdeNegocio,
    buscarUbicacionEnMaps
};
