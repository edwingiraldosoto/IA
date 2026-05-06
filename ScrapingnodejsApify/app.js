require('dotenv').config();
require('events').EventEmitter.defaultMaxListeners = 30;

const { ApifyClient } = require('apify-client');
const sql = require('mssql');
const axios = require('axios');
const fs = require('fs');
const { cargarPromptEvaluacionImagenes } = require('./prompt-loader');

const apifyClient = new ApifyClient({ token: process.env.APIFY_TOKEN });

const dbConfig = {
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    server: process.env.DB_SERVER,
    database: process.env.DB_NAME,
    options: { encrypt: false, trustServerCertificate: true }
};

// =====================
// CONFIGURACIÓN (defaults para modo CLI)
// =====================
const DATASET_FILE = './dataset.json';
const PAUSA_ENTRE_REGISTROS_MS = 5000;
const DEFAULT_SEARCH_QUERIES = ["ferreterias"];
const DEFAULT_MAX_PLACES = 3;
const DEFAULT_MAX_IMAGES = 10;
const DEFAULT_LOCATION = 'Envigado, Antioquia, Colombia';

// =====================
// FLAGS CLI
// =====================
const args = process.argv.slice(2);
const MODO_SCRAPE = args.includes('--scrape');
const MODO_ANALYZE = args.includes('--analyze');

// =====================
// MODELOS GEMINI
// =====================
const MODELOS_GEMINI = [
    'gemini-2.5-flash-lite',
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite'
];

// =====================
// DESCARGA FOTO CON AXIOS
// =====================
async function urlToBase64(url) {
    try {
        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });
        return Buffer.from(response.data).toString('base64');
    } catch (error) {
        console.error(`   ⚠️ Error Axios: ${error.message}`);
        return null;
    }
}

// =====================
// ANÁLISIS CON GEMINI
// =====================
async function analyzeWithGemini(imagesBase64, nombreNegocio, intento = 1, modeloIdx = 0) {
    const MAX_INTENTOS = 2;
    const modelo = MODELOS_GEMINI[modeloIdx];
    
    if (!modelo) {
        return { 
            vende_cemento: false, vende_tubos: false, vende_varillas: false, 
            vende_ladrillos: false, vende_agregados: false, 
            materiales_observados: ["Error IA - sin modelos disponibles"], 
            whatsapp: "", telefono_fijo: "", nivel_confianza: "bajo", score_confianza: 0 
        };
    }
    
    const geminiUrl = `https://generativelanguage.googleapis.com/v1/models/${modelo}:generateContent?key=${process.env.GEMINI_API_KEY}`;
    console.log(`   🔗 Probando ${modelo} (intento ${intento}/${MAX_INTENTOS})...`);
    
    const promptText = cargarPromptEvaluacionImagenes({
        cantidadImagenes: imagesBase64.length,
        nombreNegocio
    });

    const parts = [{ text: promptText }];
    for (const base64 of imagesBase64) {
        if (base64) parts.push({ inline_data: { mime_type: "image/jpeg", data: base64 } });
    }

    const safetySettings = [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
    ];

    try {
        const { data } = await axios.post(geminiUrl, { 
            contents: [{ parts }], safetySettings, generationConfig: { temperature: 0.1 } 
        }, { timeout: 60000 });
        
        if (data.error) throw new Error(data.error.message);
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) throw new Error("Respuesta vacía");
        
        const cleanText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        console.log(`   ✅ ${modelo} respondió correctamente`);
        return JSON.parse(cleanText);
        
    } catch (err) {
        const status = err.response?.status;
        console.error(`   ⚠️ Error ${modelo}: ${err.message} (HTTP ${status || 'N/A'})`);
        
        if (status === 503 && intento < MAX_INTENTOS) {
            await new Promise(r => setTimeout(r, 10000));
            return analyzeWithGemini(imagesBase64, nombreNegocio, intento + 1, modeloIdx);
        }
        if (status === 503 || status === 429) {
            return analyzeWithGemini(imagesBase64, nombreNegocio, 1, modeloIdx + 1);
        }
        return { 
            vende_cemento: false, vende_tubos: false, vende_varillas: false, 
            vende_ladrillos: false, vende_agregados: false, 
            materiales_observados: ["Error IA o Bloqueo"], 
            whatsapp: "", telefono_fijo: "", nivel_confianza: "bajo", score_confianza: 0 
        };
    }
}

// =====================
// CLASIFICAR TELÉFONO
// =====================
function clasificarTelefono(telefonoBruto) {
    if (!telefonoBruto) return { telefono: null, whatsapp: null };
    const limpio = telefonoBruto.replace(/[^\d+]/g, '');
    const esCelular = /^(\+57)?3\d{9}$/.test(limpio);
    return esCelular ? { telefono: null, whatsapp: telefonoBruto } : { telefono: telefonoBruto, whatsapp: null };
}

// =====================
// FASE SCRAPE
// =====================
async function fazeScrape({ searchQueries, locationQuery, maxPlaces, maxImages }) {
    console.log('🌐 FASE SCRAPE: Ejecutando Apify...\n');
    
    const run = await apifyClient.actor(process.env.APIFY_ACTOR_ID).call({
        "searchStringsArray": searchQueries,
        "maxCrawledPlacesPerSearch": maxPlaces, 
        "languageCode": "es",
        "maxImages": maxImages,
        "language": "es-419",
        "locationQuery": locationQuery,
    });
    
    const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems();
    fs.writeFileSync(DATASET_FILE, JSON.stringify(items, null, 2));
    console.log(`💾 Dataset guardado (${items.length} registros)`);
    return items;
}

// =====================
// FASE ANALYZE
// =====================
async function fazeAnalyze(items, onProgress = null) {
    console.log(`🤖 FASE ANALYZE: ${items.length} registros\n`);
    
    let pool;
    let exitosos = 0, fallidos = 0;
    const registrosFallidos = [];
    
    try {
        pool = await sql.connect(dbConfig);

        for (let idx = 0; idx < items.length; idx++) {
            const item = items[idx];
            
            if (onProgress) {
                onProgress({ current: idx + 1, total: items.length, currentItem: item.title });
            }
            
            try {
                console.log(`\n[${idx + 1}/${items.length}] 👁️ ${item.title}`);
                
                let fotosUrls = [];
                if (item.imageUrls?.length) fotosUrls = item.imageUrls;
                else if (item.photos?.length) fotosUrls = item.photos.map(p => p.url);
                const stringFotos = fotosUrls.length > 0 ? JSON.stringify(fotosUrls) : null;
                
                console.log(`   -> Descargando ${fotosUrls.length} fotos...`);
                let fotosBase64 = [];
                for (const url of fotosUrls) {
                    const base64 = await urlToBase64(url);
                    if (base64) fotosBase64.push(base64);
                }
                
                let iaData = {
                    vende_cemento: 1, vende_tubos: 0, vende_varillas: 0, vende_ladrillos: 0, vende_agregados: 0,
                    materiales_observados: 'sin_fotos_descargadas', score_confianza: 10, nivel_confianza: 'bajo',
                    whatsapp_ia: '', telefono_ia: ''
                };
                
                if (fotosBase64.length > 0) {
    const analisisIA = await analyzeWithGemini(fotosBase64, item.title);
    
    // Procesar materiales observados primero
    let materialesArr = Array.isArray(analisisIA.materiales_observados) 
        ? analisisIA.materiales_observados : ["Error"];
    iaData.materiales_observados = materialesArr.join(', ').substring(0, 499);
    
    // Convertir a texto en minúsculas para búsqueda
    const materialesTexto = iaData.materiales_observados.toLowerCase();
    
    // VALIDACIÓN CRUZADA: si el material está en la lista, el flag debe ser true
    // Esto corrige inconsistencias de Gemini
    iaData.vende_tubos = (analisisIA.vende_tubos || materialesTexto.includes('tubo')) ? 1 : 0;
    iaData.vende_varillas = (analisisIA.vende_varillas || materialesTexto.includes('varilla')) ? 1 : 0;
    iaData.vende_ladrillos = (analisisIA.vende_ladrillos || materialesTexto.includes('ladrillo') || materialesTexto.includes('bloque')) ? 1 : 0;
    iaData.vende_agregados = (analisisIA.vende_agregados || materialesTexto.includes('agregado') || materialesTexto.includes('arena') || materialesTexto.includes('piedra') || materialesTexto.includes('gravilla')) ? 1 : 0;
    
                // Cemento siempre toma prioridad del flag (porque lo usamos para nivel_confianza)
                if (analisisIA.vende_cemento || materialesTexto.includes('cemento')) {
                        iaData.vende_cemento = 1;
                    }
                    
                    iaData.score_confianza = analisisIA.score_confianza || 50;
                    iaData.whatsapp_ia = analisisIA.whatsapp || '';
                    iaData.telefono_ia = analisisIA.telefono_fijo || '';
                    
                    // Calcular nivel de confianza basado en flags CORREGIDOS
                    if (iaData.vende_cemento) iaData.nivel_confianza = 'alto';
                    else if (iaData.vende_tubos || iaData.vende_varillas || iaData.vende_ladrillos || iaData.vende_agregados) iaData.nivel_confianza = 'medio';
                    else iaData.nivel_confianza = 'bajo';
                    
                    console.log(`   🤖 ${iaData.materiales_observados} | ${iaData.nivel_confianza.toUpperCase()}`);
                    if (iaData.whatsapp_ia) console.log(`   📱 WhatsApp: ${iaData.whatsapp_ia}`);
                }
                
                const telfApify = item.phoneUnformatted || item.phone;
                let { telefono, whatsapp } = clasificarTelefono(telfApify);
                if (!whatsapp && iaData.whatsapp_ia) whatsapp = iaData.whatsapp_ia;
                if (!telefono && iaData.telefono_ia) telefono = iaData.telefono_ia;
                
                let sitioWeb = item.website || null;
                let facebook = null, instagram = null;
                if (sitioWeb) {
                    if (sitioWeb.toLowerCase().includes('facebook.com')) { facebook = sitioWeb; sitioWeb = null; }
                    else if (sitioWeb.toLowerCase().includes('instagram.com')) { instagram = sitioWeb; sitioWeb = null; }
                }
                
                await pool.request()
                    .input('NOMBRE', sql.NVarChar, item.title)
                    .input('TELEFONO', sql.NVarChar, telefono)
                    .input('WHATSAPP', sql.NVarChar, whatsapp)
                    .input('LAT', sql.Decimal(10, 7), item.location?.lat)
                    .input('LNG', sql.Decimal(10, 7), item.location?.lng)
                    .input('URL_GOOGLE', sql.NVarChar, item.url)
                    .input('URLS_IMAGENES', sql.NVarChar, stringFotos)
                    .input('FACEBOOK', sql.NVarChar, facebook)
                    .input('INSTAGRAM', sql.NVarChar, instagram)
                    .input('VENDE_CEMENTO', sql.Bit, iaData.vende_cemento)
                    .input('VENDE_TUBOS', sql.Bit, iaData.vende_tubos)
                    .input('VENDE_VARILLAS', sql.Bit, iaData.vende_varillas)
                    .input('VENDE_LADRILLOS', sql.Bit, iaData.vende_ladrillos)
                    .input('VENDE_AGREGADOS', sql.Bit, iaData.vende_agregados)
                    .input('SCORE', sql.Int, iaData.score_confianza)
                    .input('MATERIALES_OBSERVADOS', sql.NVarChar, iaData.materiales_observados)
                    .input('NIVEL_CONFIANZA', sql.NVarChar, iaData.nivel_confianza)
                    .input('DEPARTAMENTO', sql.NVarChar, item.state || 'SIN DEPTO')
                    .input('MUNICIPIO', sql.NVarChar, item.city || 'SIN MPIO')
                    .input('DIRECCION_COMERCIAL', sql.NVarChar, item.address)
                    .input('SITIO_WEB', sql.NVarChar, sitioWeb)
                    .query(`MERGE FerreteriasApify AS T USING (SELECT @NOMBRE AS nombre, @DIRECCION_COMERCIAL AS direccion) AS S ON T.NOMBRE = S.nombre AND T.DIRECCION_COMERCIAL = S.direccion WHEN MATCHED THEN UPDATE SET TELEFONO = @TELEFONO, WHATSAPP = @WHATSAPP, LAT = @LAT, LNG = @LNG, URL_GOOGLE = @URL_GOOGLE, URLS_IMAGENES = @URLS_IMAGENES, FACEBOOK = @FACEBOOK, INSTAGRAM = @INSTAGRAM, VENDE_CEMENTO = @VENDE_CEMENTO, VENDE_TUBOS = @VENDE_TUBOS, VENDE_VARILLAS = @VENDE_VARILLAS, VENDE_LADRILLOS = @VENDE_LADRILLOS, VENDE_AGREGADOS = @VENDE_AGREGADOS, SCORE = @SCORE, MATERIALES_OBSERVADOS = @MATERIALES_OBSERVADOS, NIVEL_CONFIANZA = @NIVEL_CONFIANZA, SITIO_WEB = @SITIO_WEB, FECHA_ACTUALIZACION = GETDATE() WHEN NOT MATCHED THEN INSERT (NOMBRE, TELEFONO, WHATSAPP, LAT, LNG, URL_GOOGLE, URLS_IMAGENES, FACEBOOK, INSTAGRAM, VENDE_CEMENTO, VENDE_TUBOS, VENDE_VARILLAS, VENDE_LADRILLOS, VENDE_AGREGADOS, SCORE, MATERIALES_OBSERVADOS, NIVEL_CONFIANZA, DEPARTAMENTO, MUNICIPIO, DIRECCION_COMERCIAL, SITIO_WEB) VALUES (@NOMBRE, @TELEFONO, @WHATSAPP, @LAT, @LNG, @URL_GOOGLE, @URLS_IMAGENES, @FACEBOOK, @INSTAGRAM, @VENDE_CEMENTO, @VENDE_TUBOS, @VENDE_VARILLAS, @VENDE_LADRILLOS, @VENDE_AGREGADOS, @SCORE, @MATERIALES_OBSERVADOS, @NIVEL_CONFIANZA, @DEPARTAMENTO, @MUNICIPIO, @DIRECCION_COMERCIAL, @SITIO_WEB);`);
                
                console.log(`   💾 Guardado en BD`);
                exitosos++;
                await new Promise(r => setTimeout(r, PAUSA_ENTRE_REGISTROS_MS));
                
            } catch (errRegistro) {
                fallidos++;
                registrosFallidos.push({ title: item.title, error: errRegistro.message });
                console.error(`   ❌ Error: ${errRegistro.message}`);
            }
        }
    } finally {
        if (pool) await sql.close();
    }
    
    return { exitosos, fallidos, total: items.length, registrosFallidos };
}

// =====================
// FUNCIÓN PÚBLICA (importable)
// =====================
async function ejecutarPipeline({ searchQueries, locationQuery, maxPlaces, maxImages, onProgress }) {
    const items = await fazeScrape({ searchQueries, locationQuery, maxPlaces, maxImages });
    const resultado = await fazeAnalyze(items, onProgress);
    return resultado;
}

// =====================
// CLI (solo cuando ejecutas `node app.js`)
// =====================
async function mainCli() {
    console.log('🚀 INICIANDO PIPELINE (modo CLI)');
    console.log('='.repeat(60));
    
    const config = {
        searchQueries: DEFAULT_SEARCH_QUERIES,
        locationQuery: DEFAULT_LOCATION,
        maxPlaces: DEFAULT_MAX_PLACES,
        maxImages: DEFAULT_MAX_IMAGES
    };
    
    if (MODO_SCRAPE) { await fazeScrape(config); return; }
    
    if (MODO_ANALYZE) {
        if (!fs.existsSync(DATASET_FILE)) {
            console.error(`❌ No existe ${DATASET_FILE}. Corre primero: node app.js --scrape`);
            return;
        }
        const items = JSON.parse(fs.readFileSync(DATASET_FILE));
        await fazeAnalyze(items);
        return;
    }
    
    await ejecutarPipeline(config);
}

if (require.main === module) {
    mainCli().catch(err => {
        console.error('❌ Error fatal:', err.message);
        process.exit(1);
    });
}

module.exports = { ejecutarPipeline, fazeScrape, fazeAnalyze };
