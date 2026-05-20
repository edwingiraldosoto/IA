require('dotenv').config();
require('events').EventEmitter.defaultMaxListeners = 30;

const { ApifyClient } = require('apify-client');
const sql = require('mssql');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { cargarPromptEvaluacionImagenes } = require('./prompt-loader');
const { descargarStreetViewDesdeNegocio } = require('./streetview-loader');
const { capturarStreetViewPuppeteer, puppeteerDisponible } = require('./streetview-puppeteer');
const AnalizadorUnificado = require('./analisis-unificado');
const VisionAnalyzer = require('./vision-analyzer');

// =====================
// GUARDAR IMÁGENES DESCARGADAS
// =====================
function crearCarpetaImagenes(nombreNegocio, placeId) {
    // Usar timestamp Unix (más legible y consistente)
    const timestampUnix = Math.floor(Date.now() / 1000);  // Segundos desde 1970

    const nombreSanitizado = nombreNegocio
        .replace(/[<>:"|?*\\/]/g, '')  // Caracteres inválidos en Windows
        .replace(/\s+/g, '_')
        .substring(0, 80);  // Limitar longitud (dejando espacio para timestamp)

    // Formato coherente: NombreNegocio_UnixTimestamp
    // Ej: Deposito_Y_Ferreteria_Los_Roja_1779048431
    const nombreCarpeta = `${nombreSanitizado}_${timestampUnix}`;
    const rutaCarpeta = path.join(__dirname, 'descargadas_imagenes', nombreCarpeta);

    if (!fs.existsSync(path.join(__dirname, 'descargadas_imagenes'))) {
        fs.mkdirSync(path.join(__dirname, 'descargadas_imagenes'), { recursive: true });
    }

    if (!fs.existsSync(rutaCarpeta)) {
        fs.mkdirSync(rutaCarpeta, { recursive: true });
    }

    return rutaCarpeta;
}

function guardarImagenBase64(base64, nombreArchivo, rutaCarpeta) {
    try {
        const buffer = Buffer.from(base64, 'base64');
        const rutaCompleta = path.join(rutaCarpeta, nombreArchivo);
        fs.writeFileSync(rutaCompleta, buffer);
        return rutaCompleta;
    } catch (error) {
        console.error(`   ❌ Error guardando imagen: ${error.message}`);
        return null;
    }
}

const apifyClient = new ApifyClient({ token: process.env.APIFY_TOKEN });

const dbConfig = {
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    server: process.env.DB_SERVER,
    database: process.env.DB_NAME,
    options: { encrypt: false, trustServerCertificate: true }
};

// Inicializar analizador unificado
const analizadorUnificado = new AnalizadorUnificado(
    process.env.GEMINI_API_KEY,
    {
        region: process.env.AWS_REGION || 'us-east-1',
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
);

// Inicializar Google Cloud Vision (para mejor OCR en Google Maps photos)
const visionAnalyzer = new VisionAnalyzer(process.env.GOOGLE_CLOUD_VISION_API_KEY);

// =====================
// CONFIGURACIÓN (defaults para modo CLI)
// =====================
const DATASET_FILE = './dataset.json';
const PAUSA_ENTRE_REGISTROS_MS = 8000;
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
// MODELOS GEMINI (visión - analizan imágenes)
// =====================
const MODELOS_GEMINI = [
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-2.5-pro'
];

// =====================
// DESCARGA FOTO CON AXIOS
// =====================
async function urlToBase64(url) {
    try {
        await new Promise(r => setTimeout(r, 1000));  // Pequeño delay entre descargas
        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 20000,
            maxRedirects: 5,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'image/*',
                'Accept-Language': 'es-ES,es;q=0.9',
                'Accept-Encoding': 'gzip, deflate',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache'
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
    
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${process.env.GEMINI_API_KEY}`;
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

        if ((status === 503 || status === 429 || status === 403) && intento < MAX_INTENTOS) {
            console.log(`   ⏳ Esperando 15s antes de reintentar...`);
            await new Promise(r => setTimeout(r, 15000));
            return analyzeWithGemini(imagesBase64, nombreNegocio, intento + 1, modeloIdx);
        }
        if (status === 403 || status === 429 || status === 503) {
            console.log(`   🔄 Probando modelo alternativo...`);
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
// ANALIZAR VISIBILIDAD/ÁNGULO DE IMÁGENES
// =====================
function analizarVisibilidadImagen(etiquetas, textos) {
    const etiquetasLower = etiquetas.map(e => e.nombre.toLowerCase());

    const tieneLetrero = etiquetasLower.some(e =>
        e.includes('sign') || e.includes('text') || e.includes('storefront') ||
        e.includes('shop') || e.includes('display') || e.includes('label')
    );

    const tieneAngulo = etiquetasLower.some(e =>
        e.includes('perspective') || e.includes('angle') || e.includes('building')
    );

    const tieneNumeros = textos.some(t => /\d{3,}/.test(t));

    const confianzaPromedio = etiquetas.length > 0
        ? etiquetas.reduce((a, e) => a + e.confianza, 0) / etiquetas.length
        : 0;

    let visibilidad = 'desconocida';
    let confianzaExtracion = 50;

    if (tieneLetrero && tieneNumeros && confianzaPromedio > 70) {
        visibilidad = 'excelente';
        confianzaExtracion = 95;
    } else if (tieneLetrero && tieneNumeros) {
        visibilidad = 'buena';
        confianzaExtracion = 75;
    } else if (tieneLetrero && confianzaPromedio > 60) {
        visibilidad = 'media';
        confianzaExtracion = 60;
    } else if (tieneAngulo) {
        visibilidad = 'angulada';
        confianzaExtracion = 50;
    } else {
        visibilidad = 'pobre';
        confianzaExtracion = 30;
        // DEBUG: Mostrar por qué es pobre
        console.log(`         📊 Análisis Visibilidad POBRE:`);
        console.log(`            - Letrero detectado: ${tieneLetrero}`);
        console.log(`            - Números en texto: ${tieneNumeros}`);
        console.log(`            - Ángulo válido: ${tieneAngulo}`);
        console.log(`            - Confianza promedio etiquetas: ${confianzaPromedio.toFixed(1)}%`);
        console.log(`            - Etiquetas detectadas: ${etiquetas.map(e => e.nombre).slice(0,5).join(', ')}`);
        console.log(`            ❌ RAZÓN: ${!tieneLetrero ? 'No se detectó letrero/rótulo' : !tieneNumeros ? 'No hay números en texto OCR' : 'Confianza baja'}`);
    }

    return { visibilidad, confianzaExtracion, tieneLetrero, tieneNumeros, confianzaPromedio };
}

// =====================
// ANÁLISIS CON REKOGNITION (MEJORADO v2)
// =====================
async function analyzeWithRekognition(fotosBase64, nombreNegocio) {
    const { RekognitionClient, DetectLabelsCommand, DetectTextCommand } = require('@aws-sdk/client-rekognition');

    const rekognition = new RekognitionClient({
        region: process.env.AWS_REGION || 'us-east-1',
        credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
        }
    });

    const resultados = {
        etiquetas: [],
        textos: [],
        textosCaracter: [],
        visibilidad: [],
        mejorVisibilidad: 'desconocida'
    };

    try {
        for (let imgIdx = 0; imgIdx < fotosBase64.length; imgIdx++) {
            const base64 = fotosBase64[imgIdx];
            if (!base64) continue;

            const buffer = Buffer.from(base64, 'base64');

            // 1. Detectar etiquetas y objetos
            const labelCommand = new DetectLabelsCommand({
                Image: { Bytes: buffer },
                MaxLabels: 20,
                MinConfidence: 50
            });

            const labelResponse = await rekognition.send(labelCommand);

            if (labelResponse.Labels) {
                resultados.etiquetas.push(...labelResponse.Labels.map(l => ({
                    nombre: l.Name,
                    confianza: l.Confidence
                })));
            }

            // 2. Detectar texto (OCR) - MEJORADO
            const textCommand = new DetectTextCommand({
                Image: { Bytes: buffer }
            });

            const textResponse = await rekognition.send(textCommand);

            if (textResponse.TextDetections) {
                // Líneas con confianza > 60 (MÁS AGRESIVO)
                const textosAltos = textResponse.TextDetections
                    .filter(t => t.Type === 'LINE' && t.Confidence > 60)
                    .map(t => t.DetectedText);
                resultados.textos.push(...textosAltos);

                // Palabras/números con confianza > 20 (MUY AGRESIVO - para números pequeños)
                const caracteres = textResponse.TextDetections
                    .filter(t => t.Type === 'WORD' && t.Confidence > 20)
                    .map(t => t.DetectedText);
                resultados.textosCaracter.push(...caracteres);

                // NUEVO: Caracteres individuales para números telefónicos (confianza > 15)
                const digitos = textResponse.TextDetections
                    .filter(t => t.Type === 'WORD' && /^\d+$/.test(t.DetectedText) && t.Confidence > 15)
                    .map(t => t.DetectedText);
                resultados.textosCaracter.push(...digitos);

                // Analizar visibilidad de esta imagen
                const etiquetasFormato = (labelResponse.Labels || []).map(l => ({
                    nombre: l.Name,
                    confianza: l.Confidence
                }));
                const visibilidadImg = analizarVisibilidadImagen(etiquetasFormato, textosAltos);
                resultados.visibilidad.push({
                    imagenIdx: imgIdx,
                    ...visibilidadImg
                });
            }
        }

        // Determinar mejor visibilidad entre todas las imágenes
        if (resultados.visibilidad.length > 0) {
            const ranking = { excelente: 5, buena: 4, media: 3, angulada: 2, pobre: 1, desconocida: 0 };
            const mejor = resultados.visibilidad.reduce((a, b) =>
                ranking[a.visibilidad] >= ranking[b.visibilidad] ? a : b
            );
            resultados.mejorVisibilidad = mejor.visibilidad;
        }

        const nombresEtiquetas = resultados.etiquetas.map(e => e.nombre).join(', ');
        console.log(`   🔍 Rekognition - Etiquetas: ${nombresEtiquetas.substring(0, 60)}...`);
        console.log(`   👁️  Visibilidad de letrero: ${resultados.mejorVisibilidad.toUpperCase()}`);
        if (resultados.textos.length > 0) {
            console.log(`   📝 Texto detectado: ${resultados.textos.join(' | ').substring(0, 60)}...`);
        }
        return resultados;

    } catch (error) {
        console.error(`   ⚠️ Error Rekognition: ${error.message}`);
        return resultados;
    }
}

// =====================
// COMPARAR STREET VIEW vs GOOGLE MAPS
// =====================
async function compararStreetViewVsMaps(item, fotosMapBase64) {
    console.log(`\n   🔄 Comparando Street View vs Google Maps...`);

    const resultados = {
        streetviewData: null,
        mapsData: null,
        telefonoFinal: '',
        whatsappFinal: '',
        fuente: 'desconocida',
        confianzaFinal: 50
    };

    try {
        // 1. Descargar y analizar Street View
        if (item.location?.lat && item.location?.lng) {
            console.log(`   📍 Analizando Street View...`);
            const svImages = await descargarStreetViewMultiplesAngulos(
                item.location.lat,
                item.location.lng,
                [0, 90, 180, 270]  // N, E, S, O
            );

            if (svImages.length > 0) {
                console.log(`   ✅ Street View: ${svImages.length} ángulos descargados`);

                // Analizar cada ángulo con Rekognition
                for (const svImg of svImages) {
                    const rekData = await analyzeWithRekognition([svImg.base64], item.title);
                    const textoProcesado = procesarTextoConRegex(
                        rekData.textos || [],
                        rekData.textosCaracter || []
                    );

                    if (textoProcesado.whatsapps?.length > 0) {
                        console.log(`      ✅ Street View ${svImg.angulo}: WhatsApp ${textoProcesado.whatsapps[0]}`);
                        resultados.streetviewData = {
                            angulo: svImg.angulo,
                            whatsapp: textoProcesado.whatsapps[0],
                            telefono: textoProcesado.telefonos[0] || '',
                            visibilidad: rekData.mejorVisibilidad
                        };
                        break;  // Usar el primer ángulo que tenga números
                    }
                }
            }
        }

        // 2. Analizar Google Maps (que ya tenemos)
        if (fotosMapBase64.length > 0) {
            console.log(`   📸 Analizando Google Maps...`);
            const rekDataMaps = await analyzeWithRekognition(fotosMapBase64.slice(0, 3), item.title);
            const textoProcesadoMaps = procesarTextoConRegex(
                rekDataMaps.textos || [],
                rekDataMaps.textosCaracter || []
            );

            if (textoProcesadoMaps.whatsapps?.length > 0 || textoProcesadoMaps.telefonos?.length > 0) {
                console.log(`      ✅ Google Maps: WhatsApp ${textoProcesadoMaps.whatsapps[0] || 'N/A'}`);
                resultados.mapsData = {
                    whatsapp: textoProcesadoMaps.whatsapps[0] || '',
                    telefono: textoProcesadoMaps.telefonos[0] || '',
                    visibilidad: rekDataMaps.mejorVisibilidad
                };
            }
        }

        // 3. Priorizar: Street View > Google Maps
        if (resultados.streetviewData?.whatsapp) {
            resultados.whatsappFinal = resultados.streetviewData.whatsapp;
            resultados.telefonoFinal = resultados.streetviewData.telefono || '';
            resultados.fuente = `Street View (${resultados.streetviewData.angulo})`;
            resultados.confianzaFinal = 90;
            console.log(`   🏆 Usando Street View como fuente principal`);
        } else if (resultados.mapsData?.whatsapp) {
            resultados.whatsappFinal = resultados.mapsData.whatsapp;
            resultados.telefonoFinal = resultados.mapsData.telefono || '';
            resultados.fuente = 'Google Maps';
            resultados.confianzaFinal = 70;
            console.log(`   📸 Usando Google Maps (Street View no disponible)`);
        }

    } catch (error) {
        console.log(`   ⚠️  Error comparación: ${error.message}`);
    }

    return resultados;
}

// =====================
// EXTRAER NÚMEROS TELEFÓNICOS ROBUSTAMENTE (AGRESIVO)
// =====================
function extraerTelefonosRobustamente(textos, textosCaracter = []) {
    const textoCompleto = textos.join(' ');
    const todosLosTextos = [textoCompleto, ...(textosCaracter || [])].join(' ');

    const telefonos = [];
    const whatsapps = [];

    // ESTRATEGIA 1: Números celulares con espacios/puntos/dashes (317 368 01 07, 317-3-6-8-0-1-0-7, etc)
    // Muy flexible: acepta cualquier separador entre dígitos
    const regexCelularEspaciado = /3[\s.()-]?[0-2][\s.()-]?\d[\s.()-]?\d[\s.()-]?\d[\s.()-]?\d[\s.()-]?\d[\s.()-]?\d[\s.()-]?\d[\s.()-]?\d/gi;
    const celularesEspaciados = todosLosTextos.match(regexCelularEspaciado) || [];

    for (const tel of celularesEspaciados) {
        const limpio = tel.replace(/[\s.()-]/g, '');
        if (limpio.length === 10 && limpio.startsWith('3') && /^\d+$/.test(limpio)) {
            if (!whatsapps.includes(limpio)) whatsapps.push(limpio);
        }
    }

    // ESTRATEGIA 2: Números celulares continuos (3173680101)
    const regexCelularContinuo = /\b3[0-2]\d{8}\b/g;
    const celularesMatch = todosLosTextos.match(regexCelularContinuo) || [];
    for (const tel of celularesMatch) {
        if (!whatsapps.includes(tel)) whatsapps.push(tel);
    }

    // ESTRATEGIA 3: Números incompletos o parciales (si detecta 3XXX XXXXX aunque falte un dígito)
    const regexCelularParcial = /3[0-2]\d{7,8}(?!\d)/g;
    const celularesParciales = todosLosTextos.match(regexCelularParcial) || [];
    for (const tel of celularesParciales) {
        if (tel.length >= 9 && !whatsapps.includes(tel)) {
            whatsapps.push(tel);
        }
    }

    // ESTRATEGIA 4: Teléfonos fijos con espacios/puntos (604 2762585, 604-276-2585, etc)
    const regexFijoEspaciado = /(?<![0-9])(\d{3}[\s.()-]?\d{2}[\s.()-]?\d{2}|\d{3}[\s.()-]?\d{4}|\d{4}[\s.()-]?\d{4})(?![0-9])/g;
    const fijosParciales = todosLosTextos.match(regexFijoEspaciado) || [];

    for (const tel of fijosParciales) {
        const limpio = tel.replace(/[\s.()-]/g, '');
        if ((limpio.length === 7 || limpio.length === 8) && /^\d+$/.test(limpio)) {
            if (!telefonos.includes(limpio) && !whatsapps.includes(limpio)) {
                telefonos.push(limpio);
            }
        }
    }

    // ESTRATEGIA 5: Teléfonos fijos continuos (6042762585, 2705025)
    const regexFijoContinuo = /(?<![0-9])(\d{7,8})(?![0-9])/g;
    const fijosMatch = todosLosTextos.match(regexFijoContinuo) || [];
    for (const tel of fijosMatch) {
        if ((tel.length === 7 || tel.length === 8) && /^\d+$/.test(tel)) {
            if (!telefonos.includes(tel) && !whatsapps.includes(tel)) {
                telefonos.push(tel);
            }
        }
    }

    return {
        telefonos: [...new Set(telefonos)],
        whatsapps: [...new Set(whatsapps)]
    };
}

// =====================
// PROCESAR TEXTO CON REGEX (Fallback) - MEJORADO
// =====================
function procesarTextoConRegex(textos, textosCaracter = []) {
    const textoCompleto = textos.join(' ');

    // Extraer teléfonos con la función mejorada
    const telefonicaData = extraerTelefonosRobustamente(textos, textosCaracter);

    return {
        telefonos: telefonicaData.telefonos,
        whatsapps: telefonicaData.whatsapps,
        marcas: extraerMarcas(textoCompleto),
        texto_bruto: textoCompleto.substring(0, 200)
    };
}

// =====================
// EXTRAER MARCAS CONOCIDAS (MEJORADO - MÁS AGRESIVO)
// =====================
function extraerMarcas(texto) {
    const marcasConocidas = {
        cemento: [
            // Marcas principales Colombia
            { nombre: 'ARGOS', patron: /\b(ARGOS|ARGOS\s*NAFFCO)\b/i },
            // ALION: tolerante a errores OCR (ALIOS, ALION, ALI0N)
            // Rekognition frecuentemente lee ALIOS en lugar de ALION
            { nombre: 'ALION', patron: /\b(ALI[O0]N|ALI[O0]S|ALION\s*NAFFCO|ALIO\s*NAFFCO)\b(?!\s+JARA)/i },
            { nombre: 'HOLCIM', patron: /\b(HOLCIM|HOLCIM\s*APASCO)\b/i },
            { nombre: 'CEMEX', patron: /\bCEMEX\b/i },
            { nombre: 'ULTRACEM', patron: /\b(ULTRACEM|ULTRA\s*CEM|ULTRA\s?CEMENT)\b/i },
            { nombre: 'TEQUENDAMA', patron: /\b(TEQUENDAMA|TEQUEN)\b/i },
            { nombre: 'SAN MARCOS', patron: /\bSAN\s+MARCOS\b/i },
            { nombre: 'LAFARGE', patron: /\b(LAFARGE|LA\s*FARGE)\b/i },
            { nombre: 'ANDINO', patron: /\bANDINO\b(?!\s+JARA)/i },
            { nombre: 'PORTLAND', patron: /\b(PORTLAND|PORTLAND\s*BLANCO)\b/i },
            { nombre: 'PACÍFICO', patron: /\b(PACIFICO|PACÍFICO)\b/i },
            { nombre: 'ACESCO', patron: /\b(ACESCO|ACE\s*SCO)\b/i },
            { nombre: 'MULTICEM', patron: /\b(MULTICEM|MULTI\s*CEM)\b/i }
        ],
        pinturas: [
            { nombre: 'PINTUCO', patron: /\b(PINTUCO|PINTU\s*CO)\b/i },
            { nombre: 'KORAZA', patron: /\b(KORAZA|KORAZ?A)\b/i },
            { nombre: 'BRONCO', patron: /\b(BRONCO|BRONCES?)\b/i },
            { nombre: 'SIKA', patron: /\bSIKA\b/i },
            { nombre: 'SHERWIN', patron: /\b(SHERWIN|SHERWIN\s*WILLIAMS)\b/i }
        ],
        herramientas: [
            { nombre: 'DEWALT', patron: /\b(DEWALT|DE\s*WALT)\b/i },
            { nombre: 'MAKITA', patron: /\bMAKITA\b/i },
            { nombre: 'BOSCH', patron: /\bBOSCH\b/i },
            { nombre: 'STANLEY', patron: /\bSTANLEY\b/i },
            { nombre: 'TRUPER', patron: /\bTRUPER\b/i }
        ],
        sellantes: [
            { nombre: 'MAPEI', patron: /\bMAPEI\b/i },
            { nombre: 'ALUMBAND', patron: /\b(ALUMBAND|ALUM\s*BAND)\b/i },
            { nombre: 'MAYOR TAPA GOTERAS', patron: /\b(MAYOR\s+TAPA\s+GOTERAS|MAYOR\s+TAPA|TAPA\s+GOTERAS)\b/i },
            { nombre: 'SIKAFLEX', patron: /\b(SIKAFLEX|SIKA\s*FLEX)\b/i }
        ],
        tuberias: [
            { nombre: 'GRIVAL', patron: /\b(GRIVAL|GRIAL)\b/i },
            { nombre: 'PAVCO', patron: /\b(PAVCO|PAV\s*CO)\b/i },
            { nombre: 'COLOMBIANA', patron: /\b(COLOMBIANA|TUBERIAS\s+COLOMBIANAS?)\b/i }
        ]
    };

    const marcasEncontradas = [];
    const textoNormalizado = texto.toUpperCase().replace(/[^\w\s]/g, ' ');

    // Extraer marcas (AGRESIVO - case insensitive)
    for (const categoria of Object.values(marcasConocidas)) {
        for (const marca of categoria) {
            if (marca.patron.test(textoNormalizado) && !marcasEncontradas.includes(marca.nombre)) {
                marcasEncontradas.push(marca.nombre);
            }
        }
    }

    // FALLBACK: Variaciones parciales agresivas
    const fallbackPatterns = {
        'ULTRACEM': /ULTRA/i,
        'TEQUENDAMA': /TEQUEN/i,
        'HOLCIM': /HOLC/i,
        'CEMEX': /CEMEX|CEX/i,
        'LAFARGE': /LAFAR|LAFA/i,
        'ANDINO': /ANDIN/i,
        'PINTUCO': /PINTU|PINT/i,
        'KORAZA': /KORA|KORZ/i,
        'SIKA': /SIKA|SIKAFLEX/i,
        'MAPEI': /MAPEI|MAP/i,
        'GRIVAL': /GRIVAL|GRIVA|GRIV/i
    };

    for (const [marca, patron] of Object.entries(fallbackPatterns)) {
        if (!marcasEncontradas.includes(marca) && patron.test(textoNormalizado)) {
            marcasEncontradas.push(marca);
        }
    }

    return [...new Set(marcasEncontradas)];
}

// =====================
// ANALIZAR CON GEMINI (solo texto)
// =====================
async function analizarConGeminiTexto(textos, etiquetas, nombreNegocio) {
    if (textos.length === 0) return null;

    const modelo = 'gemini-pro';
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${process.env.GEMINI_API_KEY}`;

    const prompt = `Eres un experto en ferreterías de Colombia. Analiza los siguientes textos e imágenes detectadas de una ferretería y crea una lista detallada de TODOS los productos y materiales que vende.

TEXTOS DETECTADOS:
${textos.join(' | ')}

OBJETOS DETECTADOS EN FOTOS:
${etiquetas.slice(0, 20).map(e => e.nombre).join(', ')}

Responde en este EXACTO formato JSON (sin markdown):
{
  "materiales_lista": ["cemento (Alion, Argos)", "tubos PVC", "varillas", "ladrillos"],
  "telefonos": ["telefonolocalizado"],
  "whatsapps": ["3XXXXXXXXX"]
}`;

    try {
        const { data } = await axios.post(geminiUrl, {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.3 }
        }, { timeout: 30000 });

        if (data.error) throw new Error(data.error.message);
        const respuesta = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!respuesta) throw new Error("Sin respuesta");

        const limpio = respuesta.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        return JSON.parse(limpio);
    } catch (error) {
        console.log(`   ⚠️ Gemini no pudo procesar: ${error.message}`);
        return null;
    }
}

// =====================
// ESTRUCTURAR MATERIALES COMPLETO
// =====================
function estructurarMaterialesCompleto(rekognitionData, textosProcesados) {
    const etiquetasReko = rekognitionData.etiquetas.map(e => e.nombre.toLowerCase());
    const marcasDetectadas = textosProcesados?.marcas || [];
    const textoCompleto = rekognitionData.textos.join(' ').toUpperCase();



    // Mapeo inteligente de categorías
    // IMPORTANTE: Detectar SOLO si:
    // 1. Hay marca específica conocida, O
    // 2. La palabra está EXPLÍCITAMENTE en el texto OCR detectado (no en etiquetas genéricas)
    const categorias = {
        'cemento': {
            keywords: ['cemento'],  // Buscar palabra "cemento" si está en OCR
            marcas: ['ARGOS', 'ALION', 'HOLCIM', 'CEMEX', 'ULTRACEM', 'TEQUENDAMA', 'SAN MARCOS', 'LAFARGE', 'ANDINO', 'PORTLAND', 'PACÍFICO']
        },
        'pinturas': {
            keywords: ['pintura'],  // Palabras en texto
            marcas: ['MAPEI']
        },
        'tubos PVC': {
            keywords: ['tubo', 'pvc', 'tubería', 'cañería'],  // Palabras españolas
            marcas: []
        },
        'tubos metálicos': {
            keywords: ['tubo metálico'],  // Más específico
            marcas: []
        },
        'varillas': {
            keywords: ['varilla'],  // Palabra específica
            marcas: []
        },
        'ladrillos': {
            keywords: ['ladrillo', 'bloque'],  // Palabras en español, NO etiquetas genéricas
            marcas: []
        },
        'perfiles metálicos': {
            keywords: ['perfil'],  // Palabra específica
            marcas: []
        },
        'herramientas': {
            keywords: ['herramienta', 'martillo', 'destornillador', 'taladro'],  // Palabras españolas
            marcas: ['DEWALT', 'MAKITA', 'BOSCH', 'STANLEY', 'TRUPER']
        },
        'cables eléctricos': {
            keywords: ['cable'],  // Palabra en texto
            marcas: []
        },
        'accesorios eléctricos': {
            keywords: ['interruptor', 'toma', 'enchufe'],  // Palabras españolas
            marcas: []
        }
    };

    const materialesEncontrados = [];

    // Buscar por marca específica O por palabra clave EN EL TEXTO (no en etiquetas genéricas)
    for (const [material, config] of Object.entries(categorias)) {
        const marcasEnEste = config.marcas.filter(m => marcasDetectadas.includes(m));
        const estaEnMarcas = marcasEnEste.length > 0;

        // Buscar keywords en el TEXTO OCR (no en etiquetas genéricas de Rekognition)
        const estaEnTexto = config.keywords.length > 0 &&
            config.keywords.some(kw => textoCompleto.toLowerCase().includes(kw.toLowerCase()));

        // Búsqueda especial en etiquetas Rekognition para productos ESPECÍFICOS (no ambiguos)
        let estaEnEtiquetas = false;
        if (material === 'tubos PVC' && etiquetasReko.some(e =>
            e.includes('pipe') || e.includes('tube') || e.includes('pvc') ||
            e.includes('tubing') || e.includes('conduit') || e.includes('plastic'))) {
            estaEnEtiquetas = true;
        } else if (material === 'varillas' && etiquetasReko.some(e =>
            e.includes('rebar') || e.includes('rod') || e.includes('steel') ||
            e.includes('iron') || e.includes('bar') || e.includes('armature'))) {
            estaEnEtiquetas = true;
        }

        if (estaEnMarcas || estaEnTexto || estaEnEtiquetas) {
            if (marcasEnEste.length > 0) {
                materialesEncontrados.push(`${material} (${marcasEnEste.join(', ')})`);
            } else {
                materialesEncontrados.push(material);
            }
        }
    }

    // Agregar otras marcas detectadas que no tengan categoría
    const marcasAgregadas = materialesEncontrados.flat().join();
    for (const marca of marcasDetectadas) {
        if (!marcasAgregadas.includes(marca) && !['CORONA', 'FERRETERIA'].includes(marca)) {
            materialesEncontrados.push(marca);
        }
    }

    // Determinar qué se vende
    const texto = materialesEncontrados.join(' ').toLowerCase();
    const vende_cemento = texto.includes('cemento') || categorias.cemento.marcas.some(m => marcasDetectadas.includes(m)) ? 1 : 0;
    const vende_tubos = (texto.includes('tubo') || texto.includes('pvc')) ? 1 : 0;
    const vende_varillas = texto.includes('varilla') ? 1 : 0;
    const vende_ladrillos = texto.includes('ladrillo') ? 1 : 0;
    const vende_agregados = (texto.includes('agregado') || texto.includes('arena') || texto.includes('grava')) ? 1 : 0;

    // Teléfonos
    const whatsapp = textosProcesados?.whatsapps?.[0] || '';
    const telefono = textosProcesados?.telefonos?.[0] || '';

    // Nivel confianza
    let nivel_confianza = 'bajo';
    let score = 50;
    if (vende_cemento) {
        nivel_confianza = 'alto';
        score = 90;
    } else if (vende_tubos || vende_varillas || vende_ladrillos) {
        nivel_confianza = 'medio';
        score = 70;
    }

    return {
        vende_cemento, vende_tubos, vende_varillas, vende_ladrillos, vende_agregados,
        materiales_observados: materialesEncontrados,
        whatsapp, telefono_fijo: telefono,
        nivel_confianza, score_confianza: score
    };
}

// =====================
// UNIFICAR REKOGNITION + GEMINI (DEPRECATED)
// =====================
async function unificarAnalisisCompleto(rekognitionData, textosProcesados, analisisGemini) {
    let materiales = [];

    // 1. Si Gemini tuvo éxito, usar su lista
    if (analisisGemini?.materiales_lista) {
        materiales = analisisGemini.materiales_lista;
    } else {
        // 2. Si no, construir desde Rekognition + regex
        if (textosProcesados?.marcas) {
            materiales.push(...textosProcesados.marcas);
        }

        // Agregar por etiquetas
        const etiquetasReko = rekognitionData.etiquetas.map(e => e.nombre.toLowerCase());
        if (etiquetasReko.some(e => ['cement', 'concrete'].some(p => e.includes(p)))) {
            materiales.push('cemento');
        }
        if (etiquetasReko.some(e => ['brick', 'block'].some(p => e.includes(p)))) {
            materiales.push('ladrillos');
        }
        if (etiquetasReko.some(e => ['pipe', 'tube', 'pvc'].some(p => e.includes(p)))) {
            materiales.push('tubos PVC');
        }
        if (etiquetasReko.some(e => ['rebar', 'rod', 'steel'].some(p => e.includes(p)))) {
            materiales.push('varillas');
        }
    }

    // Determinar qué se vende
    const materialesStr = materiales.join(' ').toLowerCase();
    const vende_cemento = (materialesStr.includes('cemento') || textosProcesados?.marcas?.some(m => ['ARGOS', 'ALION', 'HOLCIM', 'CEMEX', 'LAFARGE'].includes(m))) ? 1 : 0;
    const vende_tubos = materialesStr.includes('tubo') ? 1 : 0;
    const vende_varillas = materialesStr.includes('varilla') ? 1 : 0;
    const vende_ladrillos = materialesStr.includes('ladrillo') ? 1 : 0;
    const vende_agregados = (materialesStr.includes('agregado') || materialesStr.includes('arena') || materialesStr.includes('grava')) ? 1 : 0;

    // Teléfonos: preferir Gemini, sino usar regex
    const whatsapp = analisisGemini?.whatsapps?.[0] || textosProcesados?.whatsapps?.[0] || '';
    const telefono = analisisGemini?.telefonos?.[0] || textosProcesados?.telefonos?.[0] || '';

    // Nivel confianza
    let nivel_confianza = 'bajo';
    if (vende_cemento) nivel_confianza = 'alto';
    else if (vende_tubos || vende_varillas || vende_ladrillos) nivel_confianza = 'medio';

    return {
        vende_cemento, vende_tubos, vende_varillas, vende_ladrillos, vende_agregados,
        materiales_observados: [...new Set(materiales)],
        whatsapp, telefono_fijo: telefono,
        nivel_confianza,
        score_confianza: vende_cemento ? 90 : (vende_tubos || vende_varillas ? 70 : 50)
    };
}

// =====================
// PROCESAR RESULTADOS DE REKOGNITION
// =====================
function procesarResultadosRekognition(rekognitionData, textosProcesados) {
    const etiquetasReko = rekognitionData.etiquetas.map(e => e.nombre.toLowerCase()) || [];
    const materiales = [];

    // Marcas de cemento colombianas
    const marcasCementoColombia = [
        'ARGOS', 'ALION', 'HOLCIM', 'CEMEX', 'LAFARGE',
        'ANDINO', 'PORTLAND', 'PACÍFICO', 'ACESCO'
    ];

    // Detectar materiales por etiquetas
    const keywords = {
        'cemento': ['cement', 'concrete', 'powder', 'bag', 'barrel'],
        'ladrillos': ['brick', 'block', 'adobe'],
        'tubos': ['pipe', 'tube', 'pvc', 'pipeline'],
        'varillas': ['rebar', 'rod', 'steel'],
        'agregados': ['sand', 'gravel', 'aggregate', 'stone', 'gravel']
    };

    for (const [material, palabras] of Object.entries(keywords)) {
        if (etiquetasReko.some(e => palabras.some(p => e.includes(p)))) {
            materiales.push(material);
        }
    }

    // Agregar marcas y materiales del texto
    if (textosProcesados) {
        if (textosProcesados.marcas?.length > 0) {
            materiales.push(...textosProcesados.marcas);
        }
    }

    // Determinar qué se vende según etiquetas, marcas y texto
    const marcasDetectadas = materiales.map(m => m.toUpperCase());
    const tieneMarqaCemento = marcasCementoColombia.some(marca => marcasDetectadas.includes(marca));

    const vende_cemento = (etiquetasReko.some(e => ['cement', 'concrete', 'powder'].some(p => e.includes(p))) ||
                          materiales.some(m => m.toLowerCase().includes('cemento')) ||
                          tieneMarqaCemento) ? 1 : 0;

    const vende_ladrillos = (etiquetasReko.some(e => ['brick', 'block'].some(p => e.includes(p))) ||
                            materiales.some(m => m.toLowerCase().includes('ladrillo'))) ? 1 : 0;

    const vende_tubos = (etiquetasReko.some(e => ['pipe', 'tube', 'pvc'].some(p => e.includes(p))) ||
                        materiales.some(m => m.toLowerCase().includes('tubo'))) ? 1 : 0;

    const vende_varillas = (etiquetasReko.some(e => ['rebar', 'rod', 'steel'].some(p => e.includes(p))) ||
                           materiales.some(m => m.toLowerCase().includes('varilla'))) ? 1 : 0;

    const vende_agregados = (etiquetasReko.some(e => ['sand', 'gravel', 'aggregate', 'stone'].some(p => e.includes(p))) ||
                            materiales.some(m => m.toLowerCase().includes('agregado'))) ? 1 : 0;

    // Teléfonos desde texto
    const whatsapp = textosProcesados?.whatsapps?.[0] || '';
    const telefono = textosProcesados?.telefonos?.[0] || '';

    // Nivel de confianza
    let nivel_confianza = 'bajo';
    if (vende_cemento) nivel_confianza = 'alto';
    else if (vende_tubos || vende_varillas || vende_ladrillos || vende_agregados) nivel_confianza = 'medio';

    const score_confianza = vende_cemento ? 90 : (vende_tubos || vende_varillas ? 70 : 50);

    return {
        vende_cemento,
        vende_tubos,
        vende_varillas,
        vende_ladrillos,
        vende_agregados,
        materiales_observados: [...new Set(materiales)],
        whatsapp,
        telefono_fijo: telefono,
        nivel_confianza,
        score_confianza
    };
}

// =====================
// VALIDAR Y NORMALIZAR TELÉFONO COLOMBIANO
// =====================
function validarTelefonoColombia(numero) {
    if (!numero) return null;

    // Limpiar
    let limpio = numero.toString().replace(/[\s()\-.]/g, '');

    // Si tiene +57, remover
    if (limpio.startsWith('+57')) {
        limpio = limpio.substring(3);
    }

    // Celular: debe tener exactamente 10 dígitos, empezar con 3, segundo dígito 0-2
    if (/^3[0-2]\d{8}$/.test(limpio)) {
        return { tipo: 'celular', numero: limpio, valido: true };
    }

    // Fijo: múltiples formatos
    // - 7-8 dígitos: "4289860" o "42898600"
    // - 10 dígitos con código área 60x: "6044289860"
    if (/^\d{7,8}$/.test(limpio) || /^60[4-5]\d{7}$/.test(limpio)) {
        return { tipo: 'fijo', numero: limpio, valido: true };
    }

    return { tipo: 'desconocido', numero: limpio, valido: false };
}

// =====================
// CLASIFICAR TELÉFONO
// =====================
function clasificarTelefono(telefonoBruto) {
    if (!telefonoBruto) return { telefono: null, whatsapp: null };

    const validacion = validarTelefonoColombia(telefonoBruto);
    if (!validacion.valido) return { telefono: null, whatsapp: null };

    return validacion.tipo === 'celular'
        ? { telefono: null, whatsapp: validacion.numero }
        : { telefono: validacion.numero, whatsapp: null };
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

                // LOG: Mostrar qué devolvió Apify (teléfonos de Google Maps)
                const telefonoApify = item.phoneUnformatted || item.phone || 'N/A';
                const websiteApify = item.website || item.websiteUrl || 'N/A';
                console.log(`   📍 Apify - Teléfono: ${telefonoApify}, Website: ${websiteApify}`);

                let fotosUrls = [];
                if (item.imageUrls?.length) fotosUrls = item.imageUrls;
                else if (item.photos?.length) fotosUrls = item.photos.map(p => p.url);

                // FILTRO: Ignorar URLs de thumbnail de Street View (muy baja resolución)
                // Google devuelve: https://streetviewpixels-pa.googleapis.com/v1/thumbnail?...
                // Estas son 408x240 (32 KB) - mejor descargar via nuestro endpoint
                fotosUrls = fotosUrls.filter(url => !url.includes('streetviewpixels'));

                const stringFotos = fotosUrls.length > 0 ? JSON.stringify(fotosUrls) : null;

                console.log(`   📸 FASE 1: Descargar TODAS las Google Maps photos...`);
                let fotosBase64 = [];
                let tieneAltaResolucion = false;

                // 1. Descargar TODAS las Google Places photos (sin límite)
                console.log(`      → ${fotosUrls.length} fotos encontradas en Google Maps`);
                for (let imgIdx = 0; imgIdx < fotosUrls.length; imgIdx++) {
                    const url = fotosUrls[imgIdx];
                    const base64 = await urlToBase64(url);
                    if (base64) {
                        const imgBuffer = Buffer.from(base64, 'base64');
                        const sizeKB = (imgBuffer.length / 1024).toFixed(1);
                        const isHighRes = imgBuffer.length > 200000;
                        if (isHighRes) tieneAltaResolucion = true;

                        const resLabel = isHighRes ? '✅ ALTA RES' : '⚠️ BAJA RES';
                        console.log(`      [${imgIdx + 1}/${fotosUrls.length}] Google Photo (${sizeKB} KB, ${resLabel})`);
                        fotosBase64.push(base64);
                    }
                }

                // 2. SIEMPRE descargar Street View (complementario, inteligente)
                console.log(`   🛣️  FASE 2: Descargar Street View (complementario)...`);
                if (item.title && item.address && process.env.GOOGLE_MAPS_API_KEY) {
                    // Estrategia inteligente:
                    // - Si hay Google Maps photos: descargar pocos ángulos SV como complemento
                    // - Si NO hay Google Maps: descargar MUCHOS ángulos SV (24 = cada 15°) para máxima cobertura
                    let angulos = [];
                    if (fotosUrls.length > 0) {
                        angulos = [0, 45, 315];  // Frente + esquinas si ya hay Google Photos
                    } else {
                        // 24 ángulos = 360°/24 = 15° entre cada uno
                        // Asegura capturar el frente desde múltiples perspectivas
                        for (let i = 0; i < 24; i++) {
                            angulos.push(Math.round((i * 360) / 24));
                        }
                    }

                    console.log(`      → Descargando ${angulos.length} ángulos Street View${fotosUrls.length > 0 ? ' (complemento, tenemos Google Photos)' : ' (cobertura completa, sin Google Photos)'}...`);

                    const svImages = await descargarStreetViewDesdeNegocio(item.title, item.address, angulos);

                    if (svImages.length > 0) {
                        console.log(`      ✅ Street View: ${svImages.length}/${angulos.length} ángulos descargados`);
                        for (let svIdx = 0; svIdx < svImages.length; svIdx++) {
                            const svImg = svImages[svIdx];
                            const sizeKB = (svImg.tamaño / 1024).toFixed(1);
                            const tipoAngulo = svImg.esMercaderia ? '🏪' : '🗺️';
                            console.log(`         [${svIdx + 1}/${svImages.length}] ${tipoAngulo} ${svImg.angulo} (${sizeKB}KB, fuente: ${svImg.fuente})`);
                            fotosBase64.push(Buffer.from(svImg.base64, 'base64'));
                        }
                    } else {
                        console.log(`      ⚠️ Street View no disponible para esta ubicación`);
                    }
                }

                // Crear carpeta para guardar imágenes descargadas (disponible para toda la fase de análisis)
                const rutaCarpeta = fotosBase64.length > 0 ? crearCarpetaImagenes(item.title, item.placeId) : null;

                if (fotosBase64.length > 0 && rutaCarpeta) {
                    const nombreCarpeta = path.basename(rutaCarpeta);
                    console.log(`   📁 Guardando imágenes en: descargadas_imagenes/${nombreCarpeta}/`);

                    // Guardar imágenes en disco
                    let imgIdx = 0;
                    for (const base64 of fotosBase64) {
                        imgIdx++;
                        const imgBuffer = Buffer.from(base64, 'base64');
                        const sizeKB = (imgBuffer.length / 1024).toFixed(1);
                        const isGooglePhoto = sizeKB > 200;  // Google photos > 200KB
                        const nombreArchivo = isGooglePhoto
                            ? `GooglePhoto_${imgIdx}.jpg`
                            : `StreetView_${(imgIdx - 1) % 8}_deg.jpg`;

                        const rutaGuardada = guardarImagenBase64(base64, nombreArchivo, rutaCarpeta);
                        if (rutaGuardada) {
                            console.log(`      [${imgIdx}] ${sizeKB} KB ✅ Guardada: ${nombreArchivo}`);
                        }
                    }

                    if (!tieneAltaResolucion && fotosBase64.length > 0) {
                        console.log(`   ⚠️ ANÁLISIS CON LIMITACIONES: Usando imágenes de baja resolución`);
                        console.log(`      ├─ Detección de teléfono: ✅ Posible`);
                        console.log(`      ├─ Detección de marcas: ⚠️ Limitada`);
                        console.log(`      └─ Detección de materiales: ⚠️ Incompleta`);
                    } else if (tieneAltaResolucion) {
                        console.log(`   ✅ Imágenes de alta resolución (Google Places photos)`);
                        console.log(`      Análisis completo esperado`);
                    }
                } else {
                    console.log(`   ❌ No se descargaron imágenes. Usando teléfono de Apify como fallback.`);
                }
                
                let iaData = {
                    vende_cemento: 1, vende_tubos: 0, vende_varillas: 0, vende_ladrillos: 0, vende_agregados: 0,
                    materiales_observados: 'sin_fotos_descargadas', score_confianza: 10, nivel_confianza: 'bajo',
                    whatsapp_ia: '', telefono_ia: ''
                };
                
                if (fotosBase64.length > 0) {
                    // ===== ESTRATEGIA MEJORADA: Google Cloud Vision PRIMERO =====
                    const fotosMaps = fotosUrls.filter(url => !url.includes('streetviewpixels')).length;
                    const fotosStreetView = Math.max(0, fotosBase64.length - fotosMaps);

                    console.log(`   🔗 FASE 3: Análisis con Google Cloud Vision + Rekognition...`);
                    console.log(`      → Analizando ${fotosBase64.length} imágenes totales:`);
                    console.log(`         📸 Google Maps: ${fotosMaps} fotos`);
                    console.log(`         🛣️  Street View: ${fotosStreetView} fotos`);
                    console.log(`      → Buscando materiales, marcas y teléfonos con nombre: "${item.title}"`);

                    // PASO 1: Analizar PRIMERO con Google Cloud Vision (mejor OCR que Rekognition)
                    // Prioridad: Google Maps > Street View
                    let resultadosVision = {
                        textosEncontrados: [],
                        marcasEncontradas: [],
                        confianzaVisual: 0,
                        imagenesProcesadas: 0
                    };

                    if (visionAnalyzer.credentialsAvailable) {
                        // Decidir cuáles fotos analizar con Vision
                        let fotosParaVision = [];
                        let tipoFotos = 'desconocido';

                        if (fotosMaps > 0) {
                            fotosParaVision = fotosBase64.slice(0, fotosMaps);
                            tipoFotos = 'Google Maps';
                        } else if (fotosBase64.length > 0) {
                            // Si no hay Google Maps, analizar los PRIMEROS ángulos de Street View
                            // (típicamente son los más relevantes: 0°, 15°, 30°, 45°, 180°)
                            const cantidadAAnalizar = Math.min(5, fotosBase64.length);
                            fotosParaVision = fotosBase64.slice(0, cantidadAAnalizar);
                            tipoFotos = `Street View (primeros ${cantidadAAnalizar} ángulos)`;
                        }

                        if (fotosParaVision.length > 0) {
                            console.log(`   📖 Google Cloud Vision: Analizando ${fotosParaVision.length} fotos de ${tipoFotos}...`);

                            for (let idx = 0; idx < fotosParaVision.length; idx++) {
                                const fotoBase64 = fotosParaVision[idx];
                                const resultado = await visionAnalyzer.analizarImagenBase64(fotoBase64);

                                if (resultado && resultado.texto) {
                                    const textoCompleto = resultado.texto.textoCompleto || '';
                                    const preview = textoCompleto.substring(0, 80).replace(/\n/g, ' ');
                                    console.log(`      [${idx + 1}/${fotosParaVision.length}] Texto: ${preview}${textoCompleto.length > 80 ? '...' : ''}`);

                                    resultadosVision.textosEncontrados.push(textoCompleto);

                                    // Detectar marcas de cemento
                                    const marcas = visionAnalyzer.detectarMarcasCemento(textoCompleto);
                                    if (marcas.length > 0) {
                                        console.log(`      ✅ Marcas detectadas: ${marcas.map(m => m.marca).join(', ')}`);
                                        resultadosVision.marcasEncontradas.push(...marcas);
                                    }

                                    resultadosVision.imagenesProcesadas++;
                                }
                            }
                        }
                    }

                    // PASO 2: Análisis unificado complementario (Gemini + Rekognition)
                    const analisisUnificado = await analizadorUnificado.analizarConUnificacion(
                        fotosBase64,
                        item.title
                    );

                    // Fusionar resultados de Vision con análisis unificado
                    if (resultadosVision.marcasEncontradas.length > 0) {
                        console.log(`   🎯 Marcas de cemento detectadas por Vision:`);
                        for (const marca of resultadosVision.marcasEncontradas) {
                            console.log(`      ✅ ${marca.marca} (confianza: ${marca.confianza})`);
                        }
                        // Asegurar que marcas de Vision se reflejen en resultados finales
                        if (!analisisUnificado.vende_cemento && resultadosVision.marcasEncontradas.length > 0) {
                            analisisUnificado.vende_cemento = true;
                            analisisUnificado.score_confianza = Math.max(analisisUnificado.score_confianza, 85);
                            console.log(`   📈 Confianza elevada por detección de Vision`);
                        }
                    }

                    // Extraer valores del análisis unificado
                    let vCemento  = analisisUnificado.vende_cemento ? 1 : 0;
                    let vTubos    = analisisUnificado.vende_tubos ? 1 : 0;
                    let vVarillas = analisisUnificado.vende_varillas ? 1 : 0;
                    let vLadrillos = analisisUnificado.vende_ladrillos ? 1 : 0;
                    let vAgregados = analisisUnificado.vende_agregados ? 1 : 0;
                    let materialesFinales = Array.isArray(analisisUnificado.materiales_observados)
                        ? analisisUnificado.materiales_observados : [];
                    let score = analisisUnificado.score_confianza || 50;
                    let nivel = analisisUnificado.nivel_confianza || 'bajo';
                    let waFinal = analisisUnificado.whatsapp || '';
                    let telFinal = analisisUnificado.telefono_fijo || '';

                    // Determinar fuente de teléfono
                    let telefonoFuente = 'ninguna';
                    if (waFinal) {
                        telefonoFuente = 'Rekognition OCR (prioridad)';
                    }
                    if (telFinal) {
                        if (telefonoFuente === 'ninguna') {
                            telefonoFuente = 'Rekognition OCR (prioridad)';
                        }
                    }

                    // 3. FALLBACK: Si Rekognition no encontró teléfono, intentar Street View
                    if (!waFinal && !telFinal && item.title && item.address && process.env.GOOGLE_MAPS_API_KEY) {
                        console.log(`   🔄 Analizando Street View como fallback...`);
                        // Si solo había fotos de baja resolución, intentar 8 ángulos en lugar de 4
                        const angulos = !tieneAltaResolucion ? [0, 45, 90, 135, 180, 225, 270, 315] : [0, 90, 180, 270];
                        console.log(`   📐 Intentando ${angulos.length} ángulos de Street View...`);
                        const svImages = await descargarStreetViewDesdeNegocio(item.title, item.address, angulos);

                        if (svImages.length > 0) {
                            console.log(`   ✅ Street View: ${svImages.length} ángulos descargados`);

                            // Guardar imágenes de Street View en la carpeta
                            for (const svImg of svImages) {
                                const nombreArchivoSV = `StreetView_${svImg.angulo}deg.jpg`;
                                const rutaGuardadaSV = guardarImagenBase64(svImg.base64, nombreArchivoSV, rutaCarpeta);
                                if (rutaGuardadaSV) {
                                    console.log(`      📁 Guardada: ${nombreArchivoSV}`);
                                }
                            }

                            // Analizar cada ángulo con Rekognition
                            for (const svImg of svImages) {
                                const rekData = await analyzeWithRekognition([svImg.base64], item.title);
                                const textoProcesado = procesarTextoConRegex(
                                    rekData.textos || [],
                                    rekData.textosCaracter || []
                                );

                                if (textoProcesado.whatsapps?.length > 0 || textoProcesado.telefonos?.length > 0) {
                                    console.log(`      ✅ Street View ${svImg.angulo}: WhatsApp ${textoProcesado.whatsapps[0] || 'N/A'}, Fijo ${textoProcesado.telefonos[0] || 'N/A'}`);

                                    // Solo usar Street View si Rekognition inicial no encontró nada
                                    if (!waFinal && textoProcesado.whatsapps?.length > 0) {
                                        waFinal = textoProcesado.whatsapps[0];
                                        telefonoFuente = `Street View ${svImg.angulo} (fallback)`;
                                        console.log(`   ✅ Usando WhatsApp de Street View`);
                                        break;
                                    }
                                    if (!telFinal && textoProcesado.telefonos?.length > 0) {
                                        telFinal = textoProcesado.telefonos[0];
                                        telefonoFuente = `Street View ${svImg.angulo} (fallback)`;
                                        console.log(`   ✅ Usando Fijo de Street View`);
                                        break;
                                    }
                                }
                            }
                        }
                    }

                    // 4. ÚLTIMO FALLBACK: Usar teléfono de Apify si nada más funcionó
                    if (!waFinal && !telFinal && item.phoneUnformatted) {
                        const val = validarTelefonoColombia(item.phoneUnformatted);
                        if (val.valido) {
                            if (val.tipo === 'celular') {
                                waFinal = val.numero;
                                telefonoFuente = 'Apify (últimofallback)';
                            } else {
                                telFinal = val.numero;
                                telefonoFuente = 'Apify (último fallback)';
                            }
                        }
                    }

                    // 5. FALLBACK PUPPETEER: Si confianza es baja, intenta capturar de navegador
                    if (nivel === 'bajo' && puppeteerDisponible && item.title && item.address && !tieneAltaResolucion) {
                        console.log(`   🎬 FALLBACK PUPPETEER: Intentando captura de navegador de alta resolución...`);
                        try {
                            const screenshotBase64 = await capturarStreetViewPuppeteer(item.title, item.address);
                            if (screenshotBase64) {
                                console.log(`   ✅ Captura Puppeteer exitosa, re-analizando...`);

                                // Re-analizar con imagen de Puppeteer
                                const analisisUnificadoPuppeteer = await analizadorUnificado.analizarConUnificacion(
                                    [screenshotBase64],
                                    item.title
                                );

                                // Si mejora significativamente, usar resultados de Puppeteer
                                if (analisisUnificadoPuppeteer.score_confianza > score) {
                                    console.log(`   📈 Puppeteer mejoró análisis: ${score}% → ${analisisUnificadoPuppeteer.score_confianza}%`);
                                    score = analisisUnificadoPuppeteer.score_confianza;
                                    nivel = analisisUnificadoPuppeteer.nivel_confianza;
                                    materialesFinales = analisisUnificadoPuppeteer.materiales_observados || materialesFinales;
                                    vCemento = analisisUnificadoPuppeteer.vende_cemento ? 1 : vCemento;
                                    vTubos = analisisUnificadoPuppeteer.vende_tubos ? 1 : vTubos;
                                    vVarillas = analisisUnificadoPuppeteer.vende_varillas ? 1 : vVarillas;
                                    vLadrillos = analisisUnificadoPuppeteer.vende_ladrillos ? 1 : vLadrillos;
                                    vAgregados = analisisUnificadoPuppeteer.vende_agregados ? 1 : vAgregados;
                                } else {
                                    console.log(`   ⚠️  Puppeteer no mejoró (${analisisUnificadoPuppeteer.score_confianza}% ≤ ${score}%)`);
                                }
                            }
                        } catch (errPuppeteer) {
                            console.warn(`   ⚠️  Error Puppeteer: ${errPuppeteer.message}`);
                        }
                    } else if (nivel === 'bajo' && !puppeteerDisponible) {
                        console.log(`   💡 Puppeteer no disponible. Para activar fallback de navegador:`);
                        console.log(`      npm install puppeteer`);
                    }

                    if (telefonoFuente !== 'ninguna') {
                        console.log(`   📞 Fuente de números: ${telefonoFuente}`);
                    }

                    // LOG: Resultados de análisis unificado
                    console.log(`   ✅ Análisis unificado:`);
                    console.log(`      - Cemento: ${vCemento ? 'SÍ' : 'NO'}`);
                    console.log(`      - Confianza: ${nivel.toUpperCase()} (${score}%)`);
                    if (waFinal) console.log(`      - WhatsApp: ${waFinal}`);
                    if (telFinal) console.log(`      - Fijo: ${telFinal}`);
                    // Asignar resultados a iaData
                    iaData.vende_cemento   = vCemento;
                    iaData.vende_tubos     = vTubos;
                    iaData.vende_varillas  = vVarillas;
                    iaData.vende_ladrillos = vLadrillos;
                    iaData.vende_agregados = vAgregados;

                    // Generar descripción de materiales
                    let descripcMateriales = '';
                    if (Array.isArray(materialesFinales) && materialesFinales.length > 0) {
                        descripcMateriales = materialesFinales
                            .filter(m => m && m.length > 0 && typeof m === 'string')
                            .join(', ');

                        // Truncar a 1800 caracteres si es muy largo
                        if (descripcMateriales.length > 1800) {
                            descripcMateriales = descripcMateriales.substring(0, 1800) + '...';
                        }
                    }
                    iaData.materiales_observados = descripcMateriales || 'Sin materiales detectados';

                    iaData.score_confianza = score;
                    iaData.nivel_confianza = nivel;
                    iaData.whatsapp_ia = waFinal;
                    iaData.telefono_ia = telFinal;
                }
                
                const telfApify = item.phoneUnformatted || item.phone;

                // LOG detallado: mostrar qué clasificó del teléfono de Apify
                if (telfApify) {
                    const { telefono: telProcessed, whatsapp: waProcessed } = clasificarTelefono(telfApify);
                    console.log(`   ☎️ Apify devolvió: "${telfApify}" → WhatsApp: "${waProcessed}", Fijo: "${telProcessed}"`);
                }

                let { telefono, whatsapp } = clasificarTelefono(telfApify);

                // Prioridad: IA primero, luego Apify como fallback
                if (!whatsapp && iaData.whatsapp_ia) {
                    whatsapp = iaData.whatsapp_ia;
                    console.log(`   → Usando WhatsApp de IA: ${whatsapp}`);
                }
                if (!telefono && iaData.telefono_ia) {
                    telefono = iaData.telefono_ia;
                    console.log(`   → Usando Fijo de IA: ${telefono}`);
                }
                
                // Extraer redes sociales de todos los campos posibles de Apify
                let sitioWeb = null;
                let facebook = null;
                let instagram = null;

                const urlsCandidate = [
                    item.website,
                    ...(item.socialMedia || []).map(s => s.url || s),
                    ...(item.websiteUrl ? [item.websiteUrl] : []),
                    ...(item.links || []).map(l => l.url || l)
                ].filter(Boolean);

                for (const url of urlsCandidate) {
                    const u = String(url).toLowerCase();
                    if (u.includes('facebook.com') && !facebook) facebook = url;
                    else if (u.includes('instagram.com') && !instagram) instagram = url;
                    else if (!sitioWeb && !u.includes('google.com')) sitioWeb = url;
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
                    .input('MATERIALES_OBSERVADOS', sql.NVarChar(2000), iaData.materiales_observados)
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
