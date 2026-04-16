require("dotenv").config();

const axios = require("axios");
const sql = require("mssql");
const xlsx = require("xlsx");

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
const safeSqlString = (v) => v ? String(v) : "";

// =====================
// CLASIFICAR NÚMERO DE TELÉFONO COLOMBIANO
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
// DETECTAR CEMENTO POR NOMBRE
// =====================
function detectarCementoPorNombre(nombre) {
    if (!nombre) return false;
    const palabras = ['cemento', 'argos', 'materiales', 'construccion', 'deposito', 'ferreteria'];
    return palabras.some(p => nombre.toLowerCase().includes(p));
}

// =====================
// VERIFICAR SI EL EMAIL ES COMERCIAL (MEJORADO)
// =====================
function esEmailComercial(email) {
    if (!email) return false;
    
    const emailLower = email.toLowerCase();
    
    const palabrasComerciales = [
        'ferreteria', 'materiales', 'construccion', 'vidriera', 
        'deposito', 'almacen', 'tienda', 'distribuciones', 
        'industrias', 'comercial', 'servicios', 'elpaisa', 
        'londono', 'loma', 'pinturas', 'ebanista', 'bomba',
        'bombita', 'electricos', 'edemco'
    ];
    
    const nombreEmail = emailLower.split('@')[0];
    for (const palabra of palabrasComerciales) {
        if (nombreEmail.includes(palabra)) {
            return true;
        }
    }
    
    const dominiosGratuitos = [
        'gmail.com', 'hotmail.com', 'yahoo.com', 'outlook.com', 
        'icloud.com', 'aol.com', 'mail.com', 'protonmail.com',
        'yandex.com', 'gmx.com', 'zoho.com', 'tutanota.com',
        'live.com', 'msn.com', 'me.com', 'mac.com'
    ];
    
    const dominio = emailLower.split('@')[1];
    
    if (dominio && !dominiosGratuitos.includes(dominio)) {
        console.log(`   📧 Dominio corporativo detectado: ${dominio}`);
        return true;
    }
    
    return false;
}

// =====================
// EXTRAER NOMBRE DEL EMAIL (MEJORADO)
// =====================
function extraerNombreDelEmail(email) {
    if (!email || !email.includes('@')) return null;
    
    const nombreEmail = email.split('@')[0].toLowerCase();
    const dominio = email.split('@')[1].toLowerCase();
    
    let limpio = nombreEmail.replace(/[0-9]/g, '').replace(/[._-]/g, ' ');
    
    const dominiosGratuitos = ['gmail', 'hotmail', 'yahoo', 'outlook', 'icloud', 'aol', 'mail', 'protonmail', 'yandex', 'gmx', 'zoho', 'tutanota', 'live', 'msn', 'me', 'mac'];
    
    const dominioBase = dominio.split('.')[0];
    if (!dominiosGratuitos.includes(dominioBase)) {
        limpio = dominioBase;
    }
    
    const resultado = limpio.split(' ').map(w => 
        w.charAt(0).toUpperCase() + w.slice(1)
    ).join(' ');
    
    return resultado;
}

// =====================
// GEOCODE MEJORADO CON VALIDACIÓN DE MUNICIPIO
// =====================
async function geocodeConValidacion(direccion, municipio, departamento) {
    try {
        const direccionCompleta = `${direccion}, ${municipio}, ${departamento}, Colombia`;
        console.log(`   🌐 Geocodificando: "${direccionCompleta}"`);
        
        const { data } = await axios.get("https://maps.googleapis.com/maps/api/geocode/json", {
            params: { 
                address: direccionCompleta,
                key: GOOGLE_KEY
            }
        });
        
        if (data.status !== "OK" || !data.results || data.results.length === 0) {
            console.log(`   ⚠️ Geocode falló: ${data.status}`);
            return { lat: 0, lng: 0, exacta: false };
        }
        
        const result = data.results[0];
        const loc = result.geometry.location;
        const direccionEncontrada = result.formatted_address;
        
        const municipioLower = municipio.toLowerCase();
        const direccionLower = direccionEncontrada.toLowerCase();
        
        if (!direccionLower.includes(municipioLower)) {
            console.log(`   ⚠️ Advertencia: La dirección geocodificada no coincide con el municipio ${municipio}`);
            console.log(`   📍 Dirección encontrada: ${direccionEncontrada}`);
            
            console.log(`   🔍 Reintentando solo con municipio y departamento...`);
            const { data: data2 } = await axios.get("https://maps.googleapis.com/maps/api/geocode/json", {
                params: { 
                    address: `${municipio}, ${departamento}, Colombia`,
                    key: GOOGLE_KEY
                }
            });
            
            if (data2.status === "OK" && data2.results.length > 0) {
                const loc2 = data2.results[0].geometry.location;
                console.log(`   📍 Usando coordenadas del municipio: ${loc2.lat}, ${loc2.lng}`);
                return { lat: loc2.lat, lng: loc2.lng, exacta: false };
            }
        }
        
        console.log(`   📍 Dirección encontrada: ${direccionEncontrada}`);
        return { lat: loc.lat, lng: loc.lng, exacta: direccionLower.includes(municipioLower) };
        
    } catch (err) {
        console.log(`   ⚠️ Error en geocode: ${err.message}`);
        return { lat: 0, lng: 0, exacta: false };
    }
}

// =====================
// LEER EXCEL (SOLO REGISTROS CON NIT VÁLIDO)
// =====================
function leerExcel() {
    const wb = xlsx.readFile("./FerreteriasRUES.xlsx");
    const rows = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
    
    const registrosValidos = rows.filter(row => {
        const nit = row.numero_identificacion || "";
        const nitStr = String(nit).trim();
        return nitStr.length > 3 && !isNaN(nitStr);
    });
    
    console.log(`📊 Total registros en Excel: ${rows.length}`);
    console.log(`📊 Registros con NIT válido: ${registrosValidos.length}`);
    
    return registrosValidos;
}

// =====================
// BUSCAR NEGOCIO POR TEXTO EXACTO
// =====================
async function buscarPorTexto(lat, lng, texto) {
    try {
        const { data } = await axios.get("https://maps.googleapis.com/maps/api/place/nearbysearch/json", {
            params: { location: `${lat},${lng}`, radius: 100, keyword: texto, key: GOOGLE_KEY }
        });
        return data.results || [];
    } catch (err) {
        return [];
    }
}

// =====================
// BUSCAR NEGOCIO CERCANO (RADIO 50m)
// =====================
async function buscarCercano(lat, lng) {
    try {
        const { data } = await axios.get("https://maps.googleapis.com/maps/api/place/nearbysearch/json", {
            params: { location: `${lat},${lng}`, radius: 50, key: GOOGLE_KEY }
        });
        return data.results || [];
    } catch (err) {
        return [];
    }
}

// =====================
// GET PLACE DETAILS
// =====================
async function getPlaceDetails(placeId) {
    try {
        const { data } = await axios.get("https://maps.googleapis.com/maps/api/place/details/json", {
            params: { 
                place_id: placeId, 
                fields: "name,formatted_phone_number,photos,website",
                key: GOOGLE_KEY 
            }
        });
        return data.result || {};
    } catch (err) {
        return {};
    }
}

// =====================
// GET PLACE PHOTOS (HASTA 20 FOTOS)
// =====================
async function getPlacePhotos(placeId) {
    try {
        const details = await getPlaceDetails(placeId);
        const photos = details.photos || [];
        console.log(`   📸 Total fotos disponibles en Google Places: ${photos.length}`);
        const photoUrls = [];
        const maxFotos = Math.min(photos.length, 20);
        for (let i = 0; i < maxFotos; i++) {
            try {
                const response = await axios.get(
                    `https://maps.googleapis.com/maps/api/place/photo?maxwidth=1600&photoreference=${photos[i].photo_reference}&key=${GOOGLE_KEY}`,
                    { responseType: "arraybuffer", timeout: 20000 }
                );
                photoUrls.push(Buffer.from(response.data).toString("base64"));
                console.log(`   📸 Foto ${i+1}/${maxFotos} obtenida`);
            } catch (err) {
                console.log(`   ⚠️ Error en foto ${i+1}: ${err.message}`);
            }
        }
        return photoUrls;
    } catch (err) {
        console.log(`   ⚠️ Error obteniendo fotos: ${err.message}`);
        return [];
    }
}

// =====================
// STREET VIEW (4 DIRECCIONES)
// =====================
// =====================
// STREET VIEW (8 DIRECCIONES + ZOOM)
// =====================
async function getStreetView(lat, lng) {
    const headings = [0, 45, 90, 135, 180, 225, 270, 315];
    const fotos = [];
    
    // Pasada 1: vista amplia (contexto general)
    for (const heading of headings) {
        try {
            const res = await axios.get("https://maps.googleapis.com/maps/api/streetview", {
                params: { 
                    size: "1200x800", 
                    location: `${lat},${lng}`, 
                    key: GOOGLE_KEY, 
                    fov: 80, 
                    heading: heading, 
                    pitch: 10 
                },
                responseType: "arraybuffer", 
                timeout: 15000
            });
            if (res.data && res.data.length > 5000) {
                fotos.push(Buffer.from(res.data).toString("base64"));
            }
        } catch (err) {
            console.log(`   ⚠️ Error Street View heading ${heading}°: ${err.message}`);
        }
    }
    
    // Pasada 2: zoom a letreros (FOV pequeño + pitch arriba)
    for (const heading of headings) {
        try {
            const res = await axios.get("https://maps.googleapis.com/maps/api/streetview", {
                params: { 
                    size: "1200x800", 
                    location: `${lat},${lng}`, 
                    key: GOOGLE_KEY, 
                    fov: 40, 
                    heading: heading, 
                    pitch: 25 
                },
                responseType: "arraybuffer", 
                timeout: 15000
            });
            if (res.data && res.data.length > 5000) {
                fotos.push(Buffer.from(res.data).toString("base64"));
            }
        } catch (err) {
            console.log(`   ⚠️ Error Street View zoom heading ${heading}°: ${err.message}`);
        }
    }
    
    console.log(`   📸 Street View: ${fotos.length} imágenes obtenidas (8 amplias + 8 zoom)`);
    return fotos;
}

// =====================
// ANALYZE WITH GEMINI (CON DETECCIÓN DE MATERIALES)
// =====================
async function analyzeWithGemini(imagesBase64, nombreNegocio = '') {
    try {
        const url = `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`;
        
        const promptText = `Eres un EXPERTO en leer números de contacto DIRECTAMENTE de imágenes de negocios.

Analiza CADA UNA de estas imágenes de "${nombreNegocio}".

## ⚠️ REGLA DE ORO: NO INVENTES NÚMEROS ⚠️
- SOLO extrae números que puedas VER CLARAMENTE escritos en las imágenes

## CÓMO IDENTIFICAR CADA TIPO DE NÚMERO EN COLOMBIA:

**WHATSAPP/CELULAR** (10 dígitos que empiezan con 3):
- Pueden aparecer como: "3001234567", "300 123 45 67", "Cel: 3001234567"
- También pueden estar SOLOS en el letrero

**TELÉFONO FIJO** (7-8 dígitos o 10 dígitos que NO empiezan con 3):
- Pueden aparecer como: "2705025", "270 50 25", "Tel: 2705025"
- También pueden tener prefijo: "6042705025"

## MATERIALES A DETECTAR:
Observa si el negocio vende estos materiales (por letreros, exhibición visible, o sacos/bultos):
- **cemento**: bultos de cemento (Argos, Cemex, Holcim), letreros de cemento
- **tubos**: tubería PVC, tubos de presión, tubería sanitaria
- **varillas**: varillas de hierro/acero, barras corrugadas
- **ladrillos**: ladrillos, bloques, adoquines
- **agregados**: arena, gravilla, triturado, piedra, recebo (montones de material a granel)

## RESPUESTA (SOLO JSON):
{
 "vende_cemento": false,
 "vende_tubos": false,
 "vende_varillas": false,
 "vende_ladrillos": false,
 "vende_agregados": false,
 "materiales_observados": [],
 "whatsapp": "",
 "telefono_fijo": "",
 "nivel_confianza": "alto/medio/bajo"
}`;

        const parts = [{ text: promptText }];
        
        const maxImagenes = Math.min(imagesBase64.length, 20);
        for (let i = 0; i < maxImagenes; i++) {
            if (imagesBase64[i]) {
                parts.push({ inline_data: { mime_type: "image/jpeg", data: imagesBase64[i] } });
            }
        }

        console.log(`   🤖 Analizando ${maxImagenes} imágenes con Gemini...`);
        
        const { data } = await axios.post(url, { 
            contents: [{ parts }], 
            generationConfig: { temperature: 0.1, topP: 0.9 } 
        }, { timeout: 120000 });
        
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) throw new Error("No hay texto");
        
        let cleanText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
        if (jsonMatch) cleanText = jsonMatch[0];
        
        const result = JSON.parse(cleanText);
        console.log(`   🤖 Gemini respuesta: ${JSON.stringify(result)}`);
        
        let whatsapp = "";
        let telefonoFijo = "";
        
        if (result.whatsapp) {
            let limpio = result.whatsapp.replace(/[\s\-\(\)]/g, '');
            if (limpio.length === 10 && limpio.startsWith('3')) {
                whatsapp = limpio;
                console.log(`   📱 WhatsApp detectado: ${whatsapp}`);
            } else if (limpio.length > 10 && limpio.slice(-10).startsWith('3')) {
                whatsapp = limpio.slice(-10);
                console.log(`   📱 WhatsApp detectado (extraído): ${whatsapp}`);
            }
        }
        
        if (result.telefono_fijo) {
    let limpio = result.telefono_fijo.replace(/[\s\-\(\)]/g, '');
    // Fijo de 7-8 dígitos (sin prefijo de área)
    if (limpio.length >= 7 && limpio.length <= 8) {
        telefonoFijo = limpio;
        console.log(`   📞 Teléfono fijo detectado: ${telefonoFijo}`);
    }
    // Fijo de 10 dígitos con prefijo de área (NO empieza con 3)
    else if (limpio.length === 10 && !limpio.startsWith('3')) {
        telefonoFijo = limpio;
        console.log(`   📞 Teléfono fijo con área detectado: ${telefonoFijo}`);
    }
    // Fijo de 10+ dígitos, extraer los últimos 7
    else if (limpio.length > 8) {
        const ultimos7 = limpio.slice(-7);
        if (!isNaN(ultimos7)) {
            telefonoFijo = ultimos7;
            console.log(`   📞 Teléfono fijo extraído (últimos 7): ${telefonoFijo}`);
        }
    }
}
        
        if (!whatsapp && result.telefono_fijo && result.telefono_fijo.length >= 10) {
            let posibleWhatsApp = result.telefono_fijo.replace(/[\s\-\(\)]/g, '');
            if (posibleWhatsApp.length === 10 && posibleWhatsApp.startsWith('3')) {
                whatsapp = posibleWhatsApp;
                telefonoFijo = "";
                console.log(`   📱 WhatsApp detectado (desde campo teléfono): ${whatsapp}`);
            }
        }
        
        if (!result.vende_cemento && detectarCementoPorNombre(nombreNegocio)) {
            result.vende_cemento = true;
            if (!result.materiales_observados) result.materiales_observados = [];
            result.materiales_observados.push('cemento_por_nombre');
        }
        
        return {
            vende_cemento: result.vende_cemento || false,
            vende_tubos: result.vende_tubos || false,
            vende_varillas: result.vende_varillas || false,
            vende_ladrillos: result.vende_ladrillos || false,
            vende_agregados: result.vende_agregados || false,
            materiales_observados: result.materiales_observados || [],
            whatsapp_detectado: whatsapp,
            telefono_detectado: telefonoFijo,
            nivel_confianza: result.nivel_confianza || "bajo"
        };
        
    } catch (err) {
        console.log(`   ⚠️ Gemini error: ${err.message}`);
        return { 
            vende_cemento: detectarCementoPorNombre(nombreNegocio), 
            vende_tubos: false,
            vende_varillas: false,
            vende_ladrillos: false,
            vende_agregados: false,
            materiales_observados: detectarCementoPorNombre(nombreNegocio) ? ['cemento_por_nombre'] : [], 
            whatsapp_detectado: "", 
            telefono_detectado: "",
            nivel_confianza: "bajo" 
        };
    }
}

// =====================
// SCORE
// =====================
function score(ai) {
    let s = 20;
    if (ai.vende_cemento) s += 20;
    if (ai.vende_tubos) s += 10;
    if (ai.vende_varillas) s += 10;
    if (ai.vende_ladrillos) s += 5;
    if (ai.vende_agregados) s += 5;
    if (ai.whatsapp_detectado) s += 15;
    if (ai.telefono_detectado) s += 10;
    if (ai.nivel_confianza === 'alto') s += 5;
    return Math.min(s, 100);
}

// =====================
// SAVE
// =====================
async function save(pool, data) {
    const sc = score(data);
    await pool.request()
        .input("nombre", sql.NVarChar, safeSqlString(data.nombre))
        .input("telefono", sql.NVarChar, data.telefono || "")
        .input("whatsapp", sql.NVarChar, data.whatsapp || "")
        .input("nit", sql.NVarChar, safeSqlString(data.nit))
        .input("lat", sql.Decimal(10, 7), data.lat)
        .input("lng", sql.Decimal(10, 7), data.lng)
        .input("cemento", sql.Bit, data.vende_cemento ? 1 : 0)
        .input("tubos", sql.Bit, data.vende_tubos ? 1 : 0)
        .input("varillas", sql.Bit, data.vende_varillas ? 1 : 0)
        .input("ladrillos", sql.Bit, data.vende_ladrillos ? 1 : 0)
        .input("agregados", sql.Bit, data.vende_agregados ? 1 : 0)
        .input("score", sql.Int, sc)
        .input("materiales", sql.NVarChar, (data.materiales_observados || []).join(', '))
        .input("confianza", sql.NVarChar, data.nivel_confianza || 'bajo')
        .input("ultimo_analisis", sql.DateTime, new Date())
        .input("razon_social", sql.NVarChar, safeSqlString(data.razon_social))
        .input("tipo_id", sql.NVarChar, safeSqlString(data.tipo_identificacion))
        .input("num_id", sql.NVarChar, safeSqlString(data.numero_identificacion))
        .input("depto", sql.NVarChar, safeSqlString(data.departamento))
        .input("muni", sql.NVarChar, safeSqlString(data.municipio))
        .input("dir", sql.NVarChar, safeSqlString(data.direccion_comercial))
        .input("correo", sql.NVarChar, safeSqlString(data.correo_comercial))
        .input("rep", sql.NVarChar, safeSqlString(data.rep_legal))
        .query(`
MERGE FERRETERIASRUES AS T
USING (SELECT @nit nit) S
ON T.NIT = S.nit
WHEN MATCHED THEN UPDATE SET
    NOMBRE=@nombre, TELEFONO=@telefono, WHATSAPP=@whatsapp,
    LAT=@lat, LNG=@lng,
    VENDE_CEMENTO=@cemento, VENDE_TUBOS=@tubos, VENDE_VARILLAS=@varillas,
    VENDE_LADRILLOS=@ladrillos, VENDE_AGREGADOS=@agregados,
    SCORE=@score, MATERIALES_OBSERVADOS=@materiales, NIVEL_CONFIANZA=@confianza,
    ULTIMO_ANALISIS=@ultimo_analisis, FECHA_ACTUALIZACION=GETDATE(),
    RAZON_SOCIAL_RUES=@razon_social, TIPO_IDENTIFICACION_RUES=@tipo_id,
    NUMERO_IDENTIFICACION_RUES=@num_id, DEPARTAMENTO_RUES=@depto,
    MUNICIPIO_RUES=@muni, DIRECCION_COMERCIAL_RUES=@dir,
    CORREO_COMERCIAL_RUES=@correo, REP_LEGAL_RUES=@rep
WHEN NOT MATCHED THEN
INSERT (NOMBRE, TELEFONO, WHATSAPP, NIT, LAT, LNG,
    VENDE_CEMENTO, VENDE_TUBOS, VENDE_VARILLAS, VENDE_LADRILLOS, VENDE_AGREGADOS,
    SCORE, MATERIALES_OBSERVADOS, NIVEL_CONFIANZA, ULTIMO_ANALISIS,
    RAZON_SOCIAL_RUES, TIPO_IDENTIFICACION_RUES, NUMERO_IDENTIFICACION_RUES,
    DEPARTAMENTO_RUES, MUNICIPIO_RUES, DIRECCION_COMERCIAL_RUES,
    CORREO_COMERCIAL_RUES, REP_LEGAL_RUES)
VALUES (@nombre,@telefono,@whatsapp,@nit,@lat,@lng,
    @cemento,@tubos,@varillas,@ladrillos,@agregados,
    @score,@materiales,@confianza,@ultimo_analisis,
    @razon_social,@tipo_id,@num_id,@depto,@muni,@dir,@correo,@rep);
        `);
    console.log(`✅ ${data.nombre} | Cemento:${data.vende_cemento ? 'SÍ' : 'NO'} | Tubos:${data.vende_tubos ? 'SÍ' : 'NO'} | Varillas:${data.vende_varillas ? 'SÍ' : 'NO'} | WhatsApp:${data.whatsapp || 'NO'} | Tel:${data.telefono || 'NO'} | Score:${sc}`);
}

// =====================
// DETECTAR SI ES UNA FERRETERÍA REAL
// =====================
function esFerreteriaReal(nombre) {
    if (!nombre) return false;
    
    const nombreLower = nombre.toLowerCase();
    
    const palabrasSi = [
        'ferreteria', 'ferretería', 'materiales', 'construccion', 'construcción',
        'deposito', 'depósito', 'cemento', 'argos', 'varilla', 'tubo', 'ladrillo',
        'hierro', 'acero', 'ferre', 'constru', 'bloquera', 'blockera', 'agregados',
        'loma', 'londoño', 'almacen y ferreteria', 'deposito de materiales'
    ];
    
    const palabrasNo = [
        'repuestos', 'autos', 'carros', 'vehiculos', 'galeria', 'restaurante',
        'peluqueria', 'clinica', 'farmacia', 'supermercado', 'taller', 'mecanica',
        'pinturas', 'vidriera', 'ebanista', 'decoracion', 'muebles', 'telarana',
        'constructora', 'sumas', 'restas', 'motos', 'autopartes', 'llantas',
        'concesionario', 'pizzeria', 'heladeria', 'papeleria', 'libreria'
    ];
    
    for (const palabra of palabrasNo) {
        if (nombreLower.includes(palabra)) return false;
    }
    
    for (const palabra of palabrasSi) {
        if (nombreLower.includes(palabra)) return true;
    }
    
    return false;
}

// =====================
// MAIN
// =====================
async function main() {
    console.log("🔥 SISTEMA DE ANÁLISIS DE FERRETERÍAS");
    console.log("=".repeat(60));
    
    try {
        const pool = await sql.connect(dbConfig);
        console.log("✅ Conectado a BD");
        
        const rows = leerExcel();
        console.log(`\n🚀 Procesando ${rows.length} registros...\n`);
        
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            
            console.log(`\n📌 [${i+1}/${rows.length}]`);
            console.log(`   NIT: ${row.numero_identificacion}`);
            
            const direccion = [safe(row.direccion_comercial), safe(row.municipio), safe(row.departamento)].filter(Boolean).join(", ");
            const email = row.correo_comercial || "";
            const nit = String(row.numero_identificacion || "").trim();
            const municipio = safe(row.municipio);
            const departamento = safe(row.departamento);

            // ===== VALIDACIÓN DE DIRECCIÓN =====
            const dirComercial = safe(row.direccion_comercial);
            if (!dirComercial || dirComercial.length < 5) {
                console.log("⚠️ Sin dirección comercial válida, saltando...");
                continue;
            }
            if (!municipio) {
                console.log("⚠️ Sin municipio, saltando...");
                continue;
            }
            // ====================================
            
            console.log(`📍 ${direccion}`);
            if (email) console.log(`📧 ${email}`);
            
            // Geocode con validación de municipio
            const { lat, lng, exacta } = await geocodeConValidacion(direccion, municipio, departamento);
            if (!lat || !lng) { console.log("⚠️ No se pudo geocodificar"); continue; }
            if (!exacta) {
                console.log(`   ⚠️ La ubicación puede no ser exacta para ${municipio}`);
            }
            
            console.log(`📍 ${lat}, ${lng}`);
            
            // 1. Buscar por email (solo si es comercial)
            let place = null;
            if (email && esEmailComercial(email)) {
                const nombreEmail = extraerNombreDelEmail(email);
                if (nombreEmail) {
                    console.log(`🔍 Buscando por email comercial: "${nombreEmail}"`);
                    const resultados = await buscarPorTexto(lat, lng, nombreEmail);
                    if (resultados.length > 0) {
                        place = resultados[0];
                        console.log(`✅ Encontrado por email: "${place.name}"`);
                    }
                }
            }
            
            // 2. Buscar negocios cercanos y filtrar ferreterías
            if (!place) {
                const cercanos = await buscarCercano(lat, lng);
                console.log(`   🔍 Negocios encontrados en radio 50m: ${cercanos.length}`);
                
                for (const p of cercanos.slice(0, 5)) {
                    console.log(`      - "${p.name}"`);
                }
                
                const ferreterias = cercanos.filter(p => esFerreteriaReal(p.name));
                
                if (ferreterias.length > 0) {
                    place = ferreterias[0];
                    console.log(`✅ Encontrada ferretería real: "${place.name}"`);
                } else {
                    console.log(`🔍 Buscando "ferretería" en radio 100m...`);
                    const busquedaFerreteria = await buscarPorTexto(lat, lng, "ferretería");
                    if (busquedaFerreteria.length > 0) {
                        place = busquedaFerreteria[0];
                        console.log(`✅ Encontrada por búsqueda: "${place.name}"`);
                    }
                }
            }
            
            if (!place) { console.log("⚠️ No se encontró negocio"); continue; }
            
            console.log(`🏪 ${place.name}`);
            
            // Obtener fotos
            const userPhotos = await getPlacePhotos(place.place_id);
            const streetViewImgs = await getStreetView(lat, lng);
            const imagesToAnalyze = [...userPhotos, ...streetViewImgs];
            
            console.log(`📸 ${userPhotos.length} fotos usuarios + ${streetViewImgs.length} Street View = ${imagesToAnalyze.length} total`);
            
            const ai = await analyzeWithGemini(imagesToAnalyze, place.name);
            
            const info = await getPlaceDetails(place.place_id);
            
            // CLASIFICACIÓN DE NÚMEROS
            let telefonoFinal = "";
            let whatsappFinal = "";
            
            const googlePhone = info.formatted_phone_number || "";
            const clasificadoGoogle = clasificarNumeroColombiano(googlePhone);
            
            if (clasificadoGoogle.tipo === "whatsapp") {
                whatsappFinal = clasificadoGoogle.limpio;
                console.log(`   📱 WhatsApp desde Google Places: ${whatsappFinal}`);
            } else if (clasificadoGoogle.tipo === "fijo") {
                telefonoFinal = clasificadoGoogle.limpio;
                console.log(`   📞 Teléfono desde Google Places: ${telefonoFinal}`);
            }
            
            if (!whatsappFinal && ai.whatsapp_detectado) {
                whatsappFinal = ai.whatsapp_detectado;
                console.log(`   📱 WhatsApp desde Gemini: ${whatsappFinal}`);
            }
            
            if (!telefonoFinal && ai.telefono_detectado) {
                telefonoFinal = ai.telefono_detectado;
                console.log(`   📞 Teléfono desde Gemini: ${telefonoFinal}`);
            }
            
            console.log(`📊 Resultado final:`);
            console.log(`   📞 Teléfono: "${telefonoFinal}"`);
            console.log(`   📱 WhatsApp: "${whatsappFinal}"`);
            console.log(`   🧱 Cemento: ${ai.vende_cemento ? 'SÍ' : 'NO'}`);
            console.log(`   🔧 Tubos: ${ai.vende_tubos ? 'SÍ' : 'NO'}`);
            console.log(`   🪨 Varillas: ${ai.vende_varillas ? 'SÍ' : 'NO'}`);
            console.log(`   🧱 Ladrillos: ${ai.vende_ladrillos ? 'SÍ' : 'NO'}`);
            console.log(`   ⛰️ Agregados: ${ai.vende_agregados ? 'SÍ' : 'NO'}`);
            
            await save(pool, {
                nombre: place.name,
                telefono: telefonoFinal,
                whatsapp: whatsappFinal,
                nit: nit,
                lat, lng,
                vende_cemento: ai.vende_cemento,
                vende_tubos: ai.vende_tubos,
                vende_varillas: ai.vende_varillas,
                vende_ladrillos: ai.vende_ladrillos,
                vende_agregados: ai.vende_agregados,
                materiales_observados: ai.materiales_observados,
                nivel_confianza: ai.nivel_confianza,
                // Datos del Excel (RUES)
                razon_social: row.razon_social || "",
                tipo_identificacion: row.tipo_identificacion || "",
                numero_identificacion: String(row.numero_identificacion || ""),
                departamento: departamento,
                municipio: municipio,
                direccion_comercial: safe(row.direccion_comercial),
                correo_comercial: email,
                rep_legal: row.rep_legal || ""
            });
            
            console.log(`   ⏳ Esperando 5 segundos antes del siguiente registro...`);
            await new Promise(r => setTimeout(r, 5000));
        }
        
        console.log("\n" + "=".repeat(60));
        console.log("🔥 COMPLETADO");
        await pool.close();
    } catch (err) {
        console.error("❌ Error:", err);
    }
}

main().catch(console.error);