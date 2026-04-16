require("dotenv").config();

const axios = require("axios");
const sql = require("mssql");

// =====================
// KEYS
// =====================
const GOOGLE_KEY = process.env.GOOGLE_API_KEY;
const GEMINI_KEY = process.env.GEMINI_API_KEY;

// =====================
// DB CONFIG
// =====================
const dbConfig = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER,
    database: process.env.DB_DATABASE,
    options: {
        encrypt: false,
        trustServerCertificate: true
    }
};

const safe = (v) => v === null || v === undefined ? "" : String(v).trim();

// =====================
// CONFIGURACIÓN DESDE .ENV
// =====================
const CONFIG = {
    nombreNegocio: process.env.NOMBRE_NEGOCIO || "NEGOCIOS",
    tablaDestino: process.env.TABLA_DESTINO || "NEGOCIOS",
    tiposBusqueda: (process.env.TIPOS_BUSQUEDA || "hardware_store").split(',').map(t => t.trim()),
    keywordsBusqueda: (process.env.KEYWORDS_BUSQUEDA || "ferretería").split(',').map(k => k.trim()),
    palabrasIdentificacion: (process.env.PALABRAS_IDENTIFICACION || "").split(',').map(p => p.trim().toLowerCase()),
    palabrasExcluir: (process.env.PALABRAS_EXCLUIR || "").split(',').map(p => p.trim().toLowerCase()),
    promptCompleto: process.env.PROMPT_COMPLETO || "Analiza esta imagen y responde en JSON",
    scoreBase: parseInt(process.env.SCORE_BASE) || 20,
    scoreVendeLoBuscado: parseInt(process.env.SCORE_VENDE_LO_BUSCADO) || 40,
    scoreTieneWhatsapp: parseInt(process.env.SCORE_TIENE_WHATSAPP) || 15,
    scoreTieneTelefono: parseInt(process.env.SCORE_TIENE_TELEFONO) || 10,
    scoreConfianzaAlto: parseInt(process.env.SCORE_CONFIANZA_ALTO) || 10,
    scoreConfianzaMedia: parseInt(process.env.SCORE_CONFIANZA_MEDIA) || 5,
    departamentos: (process.env.DEPARTAMENTOS || "ANTIOQUIA").split(',').map(d => d.trim().toUpperCase()),
    radioPorPunto: parseInt(process.env.RADIO_BUSQUEDA) || 500,
    overlap: parseFloat(process.env.OVERLAP) || 0.3,
    delayEntrePuntos: parseInt(process.env.DELAY_ENTRE_PUNTOS) || 1000,
    delayEntrePaginas: parseInt(process.env.DELAY_ENTRE_PAGINAS) || 2000,
    delayEntreDepartamentos: parseInt(process.env.DELAY_ENTRE_DEPARTAMENTOS) || 5000,
    maxPaginas: parseInt(process.env.MAX_PAGINAS) || 5,
    maxFotos: parseInt(process.env.MAX_FOTOS) || 10
};

// =====================
// FUNCIÓN PARA IDENTIFICAR SI ES EL NEGOCIO BUSCADO
// =====================
function esNegocioBuscado(nombre) {
    if (!nombre) return false;
    
    const nombreLower = nombre.toLowerCase();
    
    // Excluir por palabras negativas
    for (const palabra of CONFIG.palabrasExcluir) {
        if (palabra && nombreLower.includes(palabra)) {
            return false;
        }
    }
    
    // Si no hay palabras de identificación, aceptar todo
    if (CONFIG.palabrasIdentificacion.length === 0 || 
        (CONFIG.palabrasIdentificacion.length === 1 && CONFIG.palabrasIdentificacion[0] === "")) {
        return true;
    }
    
    // Incluir por palabras positivas
    for (const palabra of CONFIG.palabrasIdentificacion) {
        if (palabra && nombreLower.includes(palabra)) {
            return true;
        }
    }
    
    return false;
}

// =====================
// OBTENER LÍMITES DEL DEPARTAMENTO
// =====================
async function obtenerLimitesDepartamento(departamento) {
    try {
        console.log(`\n📍 Obteniendo límites de ${departamento}...`);
        
        const geoUrl = "https://maps.googleapis.com/maps/api/geocode/json";
        const response = await axios.get(geoUrl, {
            params: {
                address: `${departamento}, Colombia`,
                key: GOOGLE_KEY
            }
        });
        
        if (!response.data.results || response.data.results.length === 0) {
            throw new Error(`No se pudo geocodificar ${departamento}`);
        }
        
        const viewport = response.data.results[0].geometry.viewport;
        
        const limites = {
            north: viewport.northeast.lat,
            south: viewport.southwest.lat,
            east: viewport.northeast.lng,
            west: viewport.southwest.lng
        };
        
        console.log(`   ✅ Límites obtenidos:`);
        console.log(`      Norte: ${limites.north.toFixed(4)}°`);
        console.log(`      Sur: ${limites.south.toFixed(4)}°`);
        console.log(`      Este: ${limites.east.toFixed(4)}°`);
        console.log(`      Oeste: ${limites.west.toFixed(4)}°`);
        
        return limites;
        
    } catch (err) {
        console.error(`   ❌ Error: ${err.message}`);
        return null;
    }
}

// =====================
// GENERAR PUNTOS DE GRILLA
// =====================
function generarPuntosGrilla(limites) {
    const puntos = [];
    const pasoLat = (CONFIG.radioPorPunto * 2 * (1 - CONFIG.overlap)) / 111320;
    const pasoLng = (CONFIG.radioPorPunto * 2 * (1 - CONFIG.overlap)) / (111320 * Math.cos(limites.north * Math.PI / 180));
    
    for (let lat = limites.south; lat <= limites.north; lat += pasoLat) {
        for (let lng = limites.west; lng <= limites.east; lng += pasoLng) {
            puntos.push({ lat, lng });
        }
    }
    
    console.log(`   📍 Generados ${puntos.length} puntos de búsqueda`);
    return puntos;
}

// =====================
// CLASIFICAR NÚMERO DE TELÉFONO
// =====================
function clasificarNumeroColombiano(numero) {
    if (!numero) return { tipo: "ninguno", limpio: "" };
    
    const limpio = numero.replace(/[\s\-\(\)]/g, '');
    
    if (limpio.length === 10 && limpio.startsWith('3')) {
        return { tipo: "whatsapp", limpio: limpio };
    }
    if (limpio.length === 10 && !limpio.startsWith('3')) {
        return { tipo: "fijo", limpio: limpio };
    }
    if (limpio.length >= 7 && limpio.length <= 8) {
        return { tipo: "fijo", limpio: limpio };
    }
    if (limpio.length > 10) {
        const ultimos10 = limpio.slice(-10);
        if (ultimos10.length === 10 && ultimos10.startsWith('3')) {
            return { tipo: "whatsapp", limpio: ultimos10 };
        }
        if (ultimos10.length === 10) {
            return { tipo: "fijo", limpio: ultimos10 };
        }
    }
    
    return { tipo: "desconocido", limpio: limpio };
}

// =====================
// BUSCAR NEGOCIOS EN UN PUNTO
// =====================
async function buscarNegociosEnPunto(lat, lng, puntoIndex, totalPuntos, negociosAcumulados, departamento) {
    console.log(`   🔍 [${puntoIndex}/${totalPuntos}] Escaneando (${lat.toFixed(5)}, ${lng.toFixed(5)})`);
    
    let todosLosNegocios = [];
    let nextPageToken = null;
    
    // Construir lista de búsquedas
    const busquedas = [];
    
    for (const tipo of CONFIG.tiposBusqueda) {
        busquedas.push({ type: tipo, keyword: null, nombre: `tipo:${tipo}` });
    }
    
    for (const keyword of CONFIG.keywordsBusqueda) {
        busquedas.push({ type: null, keyword: keyword, nombre: `keyword:${keyword}` });
    }
    
    for (const busqueda of busquedas) {
        try {
            const params = {
                location: `${lat},${lng}`,
                radius: CONFIG.radioPorPunto,
                key: GOOGLE_KEY
            };
            
            if (busqueda.type) params.type = busqueda.type;
            if (busqueda.keyword) params.keyword = busqueda.keyword;
            
            let paginaActual = 1;
            let token = null;
            
            do {
                if (token) params.pagetoken = token;
                
                const { data } = await axios.get("https://maps.googleapis.com/maps/api/place/nearbysearch/json", {
                    params: params
                });
                
                if (data.results && data.results.length > 0) {
                    const nuevosNegocios = data.results.filter(place => 
                        esNegocioBuscado(place.name) && 
                        !negociosAcumulados.has(place.place_id)
                    );
                    
                    if (nuevosNegocios.length > 0) {
                        todosLosNegocios.push(...nuevosNegocios);
                        nuevosNegocios.forEach(neg => {
                            console.log(`         📍 ${neg.name}`);
                        });
                    }
                }
                
                token = data.next_page_token;
                if (token && paginaActual < CONFIG.maxPaginas) {
                    await new Promise(r => setTimeout(r, CONFIG.delayEntrePaginas));
                    paginaActual++;
                } else {
                    token = null;
                }
                
            } while (token);
            
            await new Promise(r => setTimeout(r, 500));
            
        } catch (err) {
            // Ignorar errores
        }
    }
    
    return todosLosNegocios;
}

// =====================
// BUSCAR EN DEPARTAMENTO
// =====================
async function buscarEnDepartamento(departamento) {
    console.log("\n" + "=".repeat(80));
    console.log(`🔥 BUSCANDO EN: ${departamento}`);
    console.log("=".repeat(80));
    
    const limites = await obtenerLimitesDepartamento(departamento);
    if (!limites) return [];
    
    const puntosGrilla = generarPuntosGrilla(limites);
    let todosLosNegocios = [];
    const seenIds = new Set();
    
    for (let i = 0; i < puntosGrilla.length; i++) {
        const punto = puntosGrilla[i];
        const negociosEnPunto = await buscarNegociosEnPunto(
            punto.lat, punto.lng, i + 1, puntosGrilla.length, seenIds, departamento
        );
        
        for (const negocio of negociosEnPunto) {
            if (!seenIds.has(negocio.place_id)) {
                seenIds.add(negocio.place_id);
                todosLosNegocios.push(negocio);
                console.log(`\n   🎉 NUEVO: ${negocio.name}`);
                console.log(`      📍 ${negocio.vicinity || 'Sin dirección'}`);
                if (negocio.rating) console.log(`      ⭐ Rating: ${negocio.rating}`);
            }
        }
        
        if (i < puntosGrilla.length - 1) {
            await new Promise(r => setTimeout(r, CONFIG.delayEntrePuntos));
        }
    }
    
    console.log(`\n📊 ${departamento}: ${todosLosNegocios.length} negocios encontrados`);
    return todosLosNegocios;
}

// =====================
// GET PLACE DETAILS
// =====================
async function getPlaceDetails(placeId) {
    try {
        const { data } = await axios.get("https://maps.googleapis.com/maps/api/place/details/json", {
            params: { 
                place_id: placeId, 
                fields: "name,formatted_phone_number,formatted_address,vicinity,photos,rating",
                key: GOOGLE_KEY 
            }
        });
        return data.result || {};
    } catch (err) {
        return {};
    }
}

// =====================
// GET PLACE PHOTOS
// =====================
async function getPlacePhotos(photos) {
    try {
        if (!photos || photos.length === 0) return [];
        
        const photoUrls = [];
        const maxFotos = Math.min(photos.length, CONFIG.maxFotos);
        
        for (let i = 0; i < maxFotos; i++) {
            try {
                const response = await axios.get(
                    `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photoreference=${photos[i].photo_reference}&key=${GOOGLE_KEY}`,
                    { responseType: "arraybuffer", timeout: 20000 }
                );
                photoUrls.push(Buffer.from(response.data).toString("base64"));
            } catch (err) {
                // Ignorar
            }
        }
        return photoUrls;
    } catch (err) {
        return [];
    }
}

// =====================
// ANALYZE WITH GEMINI
// =====================
async function analyzeWithGemini(imagesBase64, nombreNegocio = '') {
    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`;
        
        let prompt = CONFIG.promptCompleto.replace(/{nombre_negocio}/g, nombreNegocio);
        
        const parts = [{ text: prompt }];
        
        const maxImagenes = Math.min(imagesBase64.length, 5);
        for (let i = 0; i < maxImagenes; i++) {
            if (imagesBase64[i]) {
                parts.push({ inline_data: { mime_type: "image/jpeg", data: imagesBase64[i] } });
            }
        }
        
        const { data } = await axios.post(url, { 
            contents: [{ parts }], 
            generationConfig: { temperature: 0.1, topP: 0.9 } 
        }, { timeout: 60000 });
        
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) throw new Error("No hay texto");
        
        let cleanText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
        if (jsonMatch) cleanText = jsonMatch[0];
        
        const result = JSON.parse(cleanText);
        
        let whatsapp = "";
        let telefono = "";
        
        if (result.whatsapp) {
            let limpio = result.whatsapp.replace(/[\s\-\(\)]/g, '');
            if (limpio.length === 10 && limpio.startsWith('3')) {
                whatsapp = limpio;
            }
        }
        
        if (result.telefono_fijo) {
            let limpio = result.telefono_fijo.replace(/[\s\-\(\)]/g, '');
            if (limpio.length >= 7 && limpio.length <= 8) {
                telefono = limpio;
            }
        }
        
        return {
            esRelevante: result.vende_lo_que_buscamos || false,
            productosObservados: result.productos_observados || [],
            whatsapp_detectado: whatsapp,
            telefono_detectado: telefono,
            nivel_confianza: result.nivel_confianza || "bajo"
        };
        
    } catch (err) {
        return { 
            esRelevante: false, 
            productosObservados: [],
            whatsapp_detectado: "", 
            telefono_detectado: "",
            nivel_confianza: "bajo" 
        };
    }
}

// =====================
// CALCULAR SCORE
// =====================
function score(ai) {
    let s = CONFIG.scoreBase;
    if (ai.esRelevante) s += CONFIG.scoreVendeLoBuscado;
    if (ai.whatsapp_detectado) s += CONFIG.scoreTieneWhatsapp;
    if (ai.telefono_detectado) s += CONFIG.scoreTieneTelefono;
    if (ai.nivel_confianza === 'alto') s += CONFIG.scoreConfianzaAlto;
    if (ai.nivel_confianza === 'media') s += CONFIG.scoreConfianzaMedia;
    return Math.min(s, 100);
}

// =====================
// GUARDAR EN BASE DE DATOS
// =====================
async function save(pool, data) {
    const sc = score(data);
    const tabla = CONFIG.tablaDestino;
    
    try {
        // Crear tabla si no existe
        await pool.request().query(`
            IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = '${tabla}')
            BEGIN
                CREATE TABLE ${tabla} (
                    ID INT IDENTITY(1,1) PRIMARY KEY,
                    NOMBRE NVARCHAR(255) NOT NULL,
                    TELEFONO NVARCHAR(50),
                    WHATSAPP NVARCHAR(50),
                    DIRECCION NVARCHAR(500),
                    DEPARTAMENTO NVARCHAR(100),
                    LAT DECIMAL(10, 7),
                    LNG DECIMAL(10, 7),
                    ES_RELEVANTE BIT DEFAULT 0,
                    SCORE INT DEFAULT 0,
                    FECHA_CREACION DATETIME DEFAULT GETDATE()
                )
            END
        `);
        
        await pool.request()
            .input("nombre", sql.NVarChar, safe(data.nombre))
            .input("telefono", sql.NVarChar, data.telefono || "")
            .input("whatsapp", sql.NVarChar, data.whatsapp || "")
            .input("direccion", sql.NVarChar, safe(data.direccion))
            .input("departamento", sql.NVarChar, data.departamento)
            .input("lat", sql.Decimal(10, 7), data.lat)
            .input("lng", sql.Decimal(10, 7), data.lng)
            .input("esRelevante", sql.Bit, data.esRelevante ? 1 : 0)
            .input("score", sql.Int, sc)
            .query(`
                INSERT INTO ${tabla} 
                (NOMBRE, TELEFONO, WHATSAPP, DIRECCION, DEPARTAMENTO, LAT, LNG, ES_RELEVANTE, SCORE, FECHA_CREACION)
                VALUES 
                (@nombre, @telefono, @whatsapp, @direccion, @departamento, @lat, @lng, @esRelevante, @score, GETDATE())
            `);
        
        console.log(`   ✅ ${data.nombre} | Relevante:${data.esRelevante ? 'SÍ' : 'NO'} | Score:${sc}`);
    } catch (err) {
        console.error(`   ❌ Error: ${err.message}`);
    }
}

// =====================
// MAIN
// =====================
async function main() {
    console.log("\n" + "=".repeat(80));
    console.log(`🔥 BUSCANDO: ${CONFIG.nombreNegocio}`);
    console.log(`📋 En departamentos: ${CONFIG.departamentos.join(', ')}`);
    console.log(`💾 Guardando en tabla: ${CONFIG.tablaDestino}`);
    console.log("=".repeat(80));
    
    try {
        const pool = await sql.connect(dbConfig);
        console.log("✅ Conectado a BD\n");
        
        let totalNegocios = 0;
        
        for (const departamento of CONFIG.departamentos) {
            const negocios = await buscarEnDepartamento(departamento);
            
            if (negocios.length === 0) {
                console.log(`\n⚠️ No se encontraron negocios en ${departamento}`);
                continue;
            }
            
            console.log(`\n📊 Procesando ${negocios.length} negocios de ${departamento}...\n`);
            
            for (let i = 0; i < negocios.length; i++) {
                const place = negocios[i];
                
                console.log(`\n📌 [${i+1}/${negocios.length}] ${place.name}`);
                
                const details = await getPlaceDetails(place.place_id);
                const lat = place.geometry.location.lat;
                const lng = place.geometry.location.lng;
                
                const userPhotos = await getPlacePhotos(details.photos || []);
                
                let ai = {
                    esRelevante: false,
                    productosObservados: [],
                    whatsapp_detectado: "",
                    telefono_detectado: "",
                    nivel_confianza: "bajo"
                };
                
                if (userPhotos.length > 0) {
                    ai = await analyzeWithGemini(userPhotos, place.name);
                }
                
                let telefonoFinal = "";
                let whatsappFinal = "";
                
                const googlePhone = details.formatted_phone_number || "";
                const clasificadoGoogle = clasificarNumeroColombiano(googlePhone);
                
                if (clasificadoGoogle.tipo === "whatsapp") {
                    whatsappFinal = clasificadoGoogle.limpio;
                } else if (clasificadoGoogle.tipo === "fijo") {
                    telefonoFinal = clasificadoGoogle.limpio;
                }
                
                if (!whatsappFinal && ai.whatsapp_detectado) whatsappFinal = ai.whatsapp_detectado;
                if (!telefonoFinal && ai.telefono_detectado) telefonoFinal = ai.telefono_detectado;
                
                await save(pool, {
                    nombre: place.name,
                    telefono: telefonoFinal,
                    whatsapp: whatsappFinal,
                    direccion: place.vicinity || details.formatted_address || '',
                    departamento: departamento,
                    lat: lat,
                    lng: lng,
                    esRelevante: ai.esRelevante,
                    score: score(ai)
                });
                
                if (i < negocios.length - 1) {
                    await new Promise(r => setTimeout(r, 2000));
                }
            }
            
            totalNegocios += negocios.length;
            
            if (CONFIG.departamentos.indexOf(departamento) < CONFIG.departamentos.length - 1) {
                console.log(`\n⏳ Esperando ${CONFIG.delayEntreDepartamentos/1000} segundos...`);
                await new Promise(r => setTimeout(r, CONFIG.delayEntreDepartamentos));
            }
        }
        
        console.log("\n" + "=".repeat(80));
        console.log(` COMPLETADO - Total: ${totalNegocios} negocios encontrados`);
        console.log("=".repeat(80));
        
        await pool.close();
        
    } catch (err) {
        console.error(" Error:", err);
    }
}

main().catch(console.error);