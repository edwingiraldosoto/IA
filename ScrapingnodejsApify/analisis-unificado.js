/**
 * SISTEMA DE ANÁLISIS UNIFICADO: Gemini + AWS Rekognition
 * Implementa prioridades inteligentes para combinar resultados de IA
 *
 * Reglas clave:
 * 1. TELÉFONOS: SOLO Rekognition (prioridad), NUNCA Gemini
 * 2. MARCAS: Prioridad Rekognition OCR > Gemini visual
 * 3. MATERIALES: Base Gemini + enriquecimiento Rekognition
 * 4. VALIDACIÓN: Teléfono debe aparecer 2+ veces para ser válido
 */

const axios = require('axios');
const { RekognitionClient, DetectLabelsCommand, DetectTextCommand } = require('@aws-sdk/client-rekognition');

class AnalizadorUnificado {
    constructor(geminiApiKey, awsConfig) {
        this.geminiApiKey = geminiApiKey;
        this.rekognition = new RekognitionClient({
            region: awsConfig.region || 'us-east-1',
            credentials: {
                accessKeyId: awsConfig.accessKeyId,
                secretAccessKey: awsConfig.secretAccessKey
            }
        });
    }

    /**
     * ANÁLISIS PRINCIPAL: Recibe imágenes y nombre del negocio
     * Retorna análisis unificado con prioridades
     */
    async analizarConUnificacion(imagenesBase64, nombreNegocio) {
        console.log(`\n[UNIFICADOR] Iniciando análisis para: ${nombreNegocio}`);

        try {
            // Paralelizar análisis de Gemini y Rekognition
            const [analisisGemini, analisisRekognition] = await Promise.all([
                this.analizarConGemini(imagenesBase64, nombreNegocio).catch(e => {
                    console.error('[UNIFICADOR] Error Gemini:', e.message);
                    return {};
                }),
                this.analizarConRekognition(imagenesBase64).catch(e => {
                    console.error('[UNIFICADOR] Error Rekognition:', e.message);
                    return { marcas_cemento: [], telefonos_encontrados: [], texto_ocr_concatenado: '', imagenes: [] };
                })
            ]);

            // Unificar con prioridades
            console.log(`[UNIFICADOR] INPUT UNIFICAR - Gemini: materiales=${analisisGemini.materiales_observados?.length || 0} | Reko: fijos=${analisisRekognition.telefonos_encontrados?.filter(t => t[0]==='fijo').length || 0}, marcas=${analisisRekognition.marcas_cemento?.length || 0}`);

            const resultado = this.unificar(analisisGemini, analisisRekognition, nombreNegocio);

            console.log(`[UNIFICADOR] ✅ Análisis completado`);
            console.log(`   - Cemento: ${resultado.vende_cemento ? 'SÍ' : 'NO'}`);
            console.log(`   - WhatsApp (Rekognition): ${resultado.whatsapp || 'no encontrado'}`);
            console.log(`   - Fijo (Rekognition): ${resultado.telefono_fijo || 'no encontrado'}`);
            console.log(`   - Materiales: ${resultado.materiales_observados.join(' | ') || 'ninguno'}`);
            console.log(`   - Confianza FINAL: ${resultado.nivel_confianza} (${resultado.score_confianza}%)`);

            // CRITICAL DEBUG: Log exactly what's being returned
            console.log(`[DEBUG RETORNO] wa="${resultado.whatsapp}" | fijo="${resultado.telefono_fijo}" | score=${resultado.score_confianza}`);

            return resultado;
        } catch (error) {
            console.error('[UNIFICADOR] Error crítico:', error.message);
            return this.respuestaDefault();
        }
    }

    /**
     * ANÁLISIS CON GEMINI: Visión general de productos
     */
    async analizarConGemini(imagenesBase64, nombreNegocio) {
        const prompt = `ERES UN ANALISTA VISUAL EXPERTO EN FERRETERÍAS COLOMBIANAS.
Tu tarea es inspeccionar CADA IMAGEN CON MÁXIMO DETALLE y reportar EXACTAMENTE LO QUE VES.

NOMBRE DEL NEGOCIO: "${nombreNegocio}"

=== INSTRUCCIONES OBLIGATORIAS ===

1. INSPECCIONA VISUALMENTE CADA ZONA:
   ✓ Fachada, letrero y avisos publicitarios
   ✓ Estanterías, escaparate y vitrinas
   ✓ Piso y base (materiales apilados)
   ✓ Techo y estructura
   ✓ Fondo y profundidad del local
   ✓ Laterales y esquinas
   ✓ Vehículos cargados o en exhibición
   ✓ Objetos parcialmente visibles (aún si no están centrados)

2. DETECTA TODOS LOS MATERIALES (NO DEJES NINGUNO):
   • CEMENTO: bultos/sacos, cualquier marca ARGOS, ALION, HOLCIM, ULTRACEM, CEMEX, TEQUENDAMA, LAFARGE, ANDINO, PORTLAND, PACIFICO, COLOMBIANO
   • TUBOS/TUBERÍAS/CANALES: tubo cilíndrico (PVC, hierro, etc) | canales y bajantes PAVCO | tubería conduit | caños - DESCRIBE COLORES (blanco, gris, naranja, amarillo, rojo, verde, azul)
   • VARILLAS: barras metálicas, hierro redondo, acero, perfilería metálica, estructuras de hierro
   • LADRILLOS/BLOQUES: ladrillo farol, bloque gris, adobe, bloque de concreto, bloques de construcción, adoquines
   • TEJAS: tejas de barro, tejas de cemento, tejas coloniales, tejas rojas, tejas blancas, tejas grises
   • AGREGADOS: arena (concreto, pega, fina, gruesa), grava, piedra, gravilla, triturado (3/4, 1/2, fino), cascajo (en sacos o granel)
   • MADERA: tablas, listones, molduras, vigas, madera aserrada
   • CERÁMICAS/BALDOSAS: pisos, azulejos, porcelanas, mosaicos
   • HERRAMIENTAS: palas, picos, martillos, llanas, pinceles, destornilladores, alicates, taladros
   • PINTURAS: botes de pintura, esmaltes, barnices, selladores, adhesivos
   • ACCESORIOS HIDRÁULICOS: grifería, válvulas, niples, codos, tees, adaptadores
   • ACCESORIOS ELÉCTRICOS: cables, cuerdas, alambres, tomacorrientes, breakers, rejillas metálicas, mallas
   • OTRAS MARCAS IMPORTANTES: PAVCO (tuberías PVC), CORONA, ETERNIT, ACINDAR, DIPAC
   • OTROS: yeso, mortero, cal, grasa, productos químicos, herramientas de seguridad

3. MARCAS Y LOGOS - EXTREMADAMENTE CRÍTICO (INCLUSO SI ES BAJA RESOLUCIÓN):
   BUSCA AGRESIVAMENTE marcas de cemento AUNQUE LA IMAGEN ESTÉ PIXELADA:
   ✓ ALIÓN (busca "AL" + "ON", "ALION", letras amarillas/azules)
   ✓ ARGOS (busca "ARG", letras rojas)
   ✓ HOLCIM (busca "HOL", letras azules/grises)
   ✓ ULTRACEM (busca "ULTRA", letras azules)
   ✓ CEMEX (busca "CEMEX", letras grises)
   ✓ LAFARGE (busca "LAF", letras rojas/azules)
   ✓ TEQUENDAMA (busca "TEQUENDAMA")
   ✓ Otras: ANDINO, PORTLAND, PACIFICO, COLOMBIANO

   ✓ OTRAS MARCAS CRÍTICAS:
     - PAVCO: busca "PAVCO", "Canales y bajantes", "tubería PVC" (marca líder de tuberías)
     - SIKA: adhesivos, selladores, impermeabilizantes
     - CORONA: grifería, accesorios hidráulicos
     - VIMIREX: pinturas, esmaltes, barnices (marca de pintura colombiana)
     - BOYACÁ: pinturas y esmaltes
     - DURALIT: pinturas y esmaltes
     - ETERNIT: tuberías, elementos de asbesto
     - ACINDAR: acero, varillas
     - DIPAC: elementos estructurales

   INSTRUCCIÓN ESPECIAL: Incluso si el texto está parcialmente visible, pixelado o con bajo contraste:
   - Busca formas de letras características
   - Busca colores asociados a marcas (amarillo=ALIÓN, rojo=ARGOS, azul=HOLCIM)
   - Si ves sacos/bultos apilados ASUMIR que hay marcas aunque no se lean perfectamente
   - Reporta: "cemento (probable ALIÓN)" si sospeches pero no estés 100% seguro

4. MAPEO DE MARCAS A CATEGORÍAS:
   Si ves estas marcas → clasifica como:
   • PAVCO + (Canales, bajantes, tuberías) → VENDE_TUBOS = true
   • SIKA → ACCESORIOS HIDRÁULICOS o PINTURAS
   • CORONA → ACCESORIOS HIDRÁULICOS
   • VIMIREX → PINTURAS (esmaltes, barnices, colores específicos)
   • BOYACÁ → PINTURAS
   • DURALIT → PINTURAS
   • ACINDAR → VENDE_VARILLAS (acero estructural)
   • ETERNIT → VENDE_TUBOS (tuberías de asbesto)

5. COLORES ESPECÍFICOS PARA CADA MATERIAL:
   ✗ NO escribas: "tubos"
   ✓ ESCRIBE: "tubos PVC (blancos, grises, naranjas y amarillos)"

   ✗ NO escribas: "ladrillos"
   ✓ ESCRIBE: "ladrillos rojos y bloques de concreto gris"

   ✗ NO escribas: "herramientas"
   ✓ ESCRIBE: "herramientas manuales (palas, picos, martillos, llanas, alicates)"

6. FORMATO DE RESPUESTA:
   Cada material debe incluir:
   - Nombre del material
   - Colores (si aplica)
   - Marcas (si las ves)
   - Cantidad aproximada (si es clara)

   EJEMPLO INCORRECTO: "cemento, tubos, herramientas"
   EJEMPLO CORRECTO: "cemento ALIÓN y ARGOS en bultos apilados, tubos PVC (blancos, grises, naranjas), bloques de concreto gris, herramientas de obra (palas, picos, martillos), pintura y adhesivos marca SIKA, grava y arena en zona exterior"

6. VALIDACIÓN ANTES DE RESPONDER:
   ¿Estoy siendo demasiado genérico? → NO
   ¿Podría describir más detalles? → SÍ
   ¿Ignoro objetos visibles? → NO
   ¿Mi descripción parece exhaustiva? → SÍ

   Si la respuesta es NO a cualquier pregunta, revisa y expande.

8. NUNCA RESPONDAS:
   ✗ "Sin materiales detectados"
   ✗ "Materiales genéricos"
   ✗ "Ferretería general"

   Si hay UNA imagen visible, SIEMPRE hay algo que detectar.
   Si ves un bulto parcial → es cemento
   Si ves un tubo → describe su forma y color
   Si ves metal → describe si es varilla, tubo o estructura

9. SI LA IMAGEN ESTÁ PIXELADA O BAJA RESOLUCIÓN:
   ✓ Busca FORMAS y COLORES característicos de marcas
   ✓ Busca patrones de letras/logos aunque no sean perfectamente legibles
   ✓ Busca LETRERO/CARTEL amarillo (típico de ALIÓN, SIKA)
   ✓ Busca SACOS/BULTOS apilados (tipicamente cemento de alguna marca)
   ✓ Si ves dudoso, reporta: "cemento (marca no completamente clara)"
   ✓ Nunca reportes "sin materiales" si ves ALGO que sugiera producto

   EJEMPLO en baja resolución: "Se ve letrero amarillo con texto parcialmente legible que podría ser ALIÓN, cemento en sacos apilados"

=== RESPUESTA (SOLO JSON VÁLIDO, SIN MARKDOWN) ===

{
  "vende_cemento": true/false,
  "vende_tubos": true/false,
  "vende_varillas": true/false,
  "vende_ladrillos": true/false,
  "vende_tejas": true/false,
  "vende_agregados": true/false,
  "materiales_observados": [
    "material1 con colores y marcas específicas",
    "material2 con descripción detallada",
    "material3 con características observables",
    "...continúa hasta agotar TODOS los materiales detectados"
  ],
  "whatsapp": "",
  "telefono_fijo": "",
  "nivel_confianza": "alto/medio/bajo",
  "score_confianza": número entre 0 y 100
}`;

        try {
            const parts = [{ text: prompt }];

            for (const imgB64 of imagenesBase64) {
                if (!imgB64) continue;
                parts.push({
                    inlineData: {
                        mimeType: "image/jpeg",
                        data: imgB64
                    }
                });
            }

            const response = await axios.post(
                'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
                {
                    contents: [{ parts }],
                    generationConfig: {
                        temperature: 0.3,
                        maxOutputTokens: 1024
                    }
                },
                {
                    headers: { 'x-goog-api-key': this.geminiApiKey },
                    timeout: 60000
                }
            );

            const texto = response.data.candidates[0]?.content?.parts[0]?.text;
            if (!texto) throw new Error("Respuesta vacía de Gemini");

            const jsonLimpio = texto.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

            try {
                const resultado = JSON.parse(jsonLimpio);
                console.log('[Gemini] ✅ Análisis completado');
                return resultado;
            } catch (parseError) {
                console.error('[Gemini] ⚠️ JSON Parse Error:', parseError.message);
                console.error('[Gemini] Raw response:', texto.substring(0, 300));

                // Intentar reparar JSON
                try {
                    let jsonRepaired = texto
                        .replace(/[\n\r]/g, ' ')
                        .replace(/,\s*}/g, '}')
                        .replace(/,\s*]/g, ']')
                        .replace(/:\s*"([^"]*(?:\s+|$))/g, ': "$1"')  // Arreglar strings incompletos
                        .trim();

                    // Si termina con comilla incompleta, cerrarla
                    if (jsonRepaired.match(/"[^"]*$/)) {
                        jsonRepaired += '"';
                    }

                    // Si está incompleto (sin }, ]}, cerrar
                    const openBraces = (jsonRepaired.match(/\{/g) || []).length;
                    const closeBraces = (jsonRepaired.match(/\}/g) || []).length;
                    const openBrackets = (jsonRepaired.match(/\[/g) || []).length;
                    const closeBrackets = (jsonRepaired.match(/\]/g) || []).length;

                    for (let i = 0; i < openBrackets - closeBrackets; i++) {
                        jsonRepaired += ']';
                    }
                    for (let i = 0; i < openBraces - closeBraces; i++) {
                        jsonRepaired += '}';
                    }

                    const resultado = JSON.parse(jsonRepaired);
                    console.log('[Gemini] ✅ JSON reparado y parseado');
                    return resultado;
                } catch (repairError) {
                    console.error('[Gemini] No se pudo reparar JSON:', repairError.message);
                }
                return {};
            }
        } catch (error) {
            console.error('[Gemini] ⚠️ Error crítico:', error.message);
            return {};
        }
    }

    /**
     * ANÁLISIS CON REKOGNITION: OCR y detección de objetos
     */
    async analizarConRekognition(imagenesBase64) {
        const resultado = {
            marcas_cemento: new Set(),
            telefonos_encontrados: [],
            texto_ocr_concatenado: "",
            imagenes: []
        };

        for (let idx = 0; idx < imagenesBase64.length; idx++) {
            const imgB64 = imagenesBase64[idx];
            if (!imgB64) continue;

            console.log(`[Rekognition] Analizando imagen ${idx + 1}/${imagenesBase64.length}...`);

            try {
                const imgBuffer = Buffer.from(imgB64, 'base64');

                // 1. DETECTAR TEXTO (OCR)
                const textoResult = await this.rekognition.send(new DetectTextCommand({
                    Image: { Bytes: imgBuffer }
                }));

                const texto = this.extraerTextoDeRekognition(textoResult.TextDetections || []);
                resultado.texto_ocr_concatenado += "\n" + texto;

                // 2. BUSCAR MARCAS EN TEXTO
                const marcas = this.buscarMarcasCemento(texto);
                marcas.forEach(m => resultado.marcas_cemento.add(m));

                // 3. BUSCAR TELÉFONOS EN TEXTO (OCR)
                const telefonos = this.extraerTelefonosOCR(texto);
                for (const tel of telefonos) {
                    const tipo = tel.startsWith('3') ? 'whatsapp' : 'fijo';
                    resultado.telefonos_encontrados.push([tipo, tel]);
                }

                // 4. DETECTAR ETIQUETAS (LABELS)
                const labelsResult = await this.rekognition.send(new DetectLabelsCommand({
                    Image: { Bytes: imgBuffer }
                }));

                const etiquetas = labelsResult.Labels?.map(l => l.Name) || [];

                resultado.imagenes.push({
                    indice: idx + 1,
                    etiquetas: etiquetas,
                    texto_ocr: texto,
                    marcas_cemento: Array.from(marcas),
                    telefonos_detectados: { whatsapp: '', fijo: '' }
                });

                // Mostrar detalladamente qué detectó
                console.log(`   📊 Imagen ${idx + 1}:`);
                console.log(`      ├─ Etiquetas: ${etiquetas.length} (${etiquetas.slice(0, 3).join(', ')}${etiquetas.length > 3 ? '...' : ''})`);
                console.log(`      ├─ Texto OCR: ${texto.length > 0 ? '✅ Sí' : '❌ No'} ${texto.length > 0 ? `(${texto.substring(0, 60)}...)` : ''}`);
                console.log(`      └─ Teléfonos: ${telefonos.length > 0 ? '✅ ' + telefonos.join(', ') : '❌ No'}`);

                if (marcas.length > 0) {
                    console.log(`      └─ Marcas detectadas: ${marcas.join(', ')}`);
                }
            } catch (error) {
                console.error(`[Rekognition] Error en imagen ${idx + 1}:`, error.message);
            }
        }

        return {
            marcas_cemento: Array.from(resultado.marcas_cemento),
            telefonos_encontrados: resultado.telefonos_encontrados,
            texto_ocr_concatenado: resultado.texto_ocr_concatenado,
            imagenes: resultado.imagenes
        };
    }

    /**
     * UNIFICACIÓN: Combina Gemini + Rekognition con prioridades
     *
     * Reglas:
     * 1. TELÉFONOS: SOLO Rekognition (prioridad), NUNCA Gemini
     * 2. MARCAS: Prioridad Rekognition OCR
     * 3. MATERIALES: Base Gemini + enriquecimiento Rekognition
     */
    unificar(gemini, rekognition, nombreNegocio) {
        // FALLBACK: Si Gemini falló o devolvió vacío, usar Rekognition como base
        const materialesGemini = (gemini.materiales_observados || []).filter(m => m && m.length > 0);
        const marcasCemento = rekognition.marcas_cemento || [];

        // Extraer materiales detectados en imágenes de Rekognition
        const etiquetasDetectadas = new Set();
        for (const imagen of (rekognition.imagenes || [])) {
            for (const etiqueta of (imagen.etiquetas || [])) {
                etiquetasDetectadas.add(etiqueta.toLowerCase());
            }
        }

        // Mapeo de etiquetas Rekognition a materiales - TODOS LOS OBJETOS
        const mapMateriales = {
            'cement': 'cemento',
            'brick': 'ladrillos',
            'adobe': 'adobes',
            'tile': 'baldosas/cerámicas',
            'block': 'bloques de construcción',
            'tube': 'tuberías/tubos',
            'pipe': 'tuberías/tubos',
            'pvc': 'tubería PVC',
            'metal': 'materiales metálicos',
            'steel': 'acero/varillas',
            'iron': 'hierro/varillas',
            'rod': 'varillas',
            'rebar': 'varillas de acero',
            'wood': 'madera',
            'lumber': 'madera',
            'sand': 'arena',
            'aggregate': 'agregados',
            'gravel': 'grava/agregados',
            'rock': 'piedra',
            'concrete': 'concreto',
            'tool': 'herramientas',
            'paint': 'pinturas',
            'varnish': 'barnices',
            'adhesive': 'adhesivos',
            'sealant': 'selladores',
            'faucet': 'griferías',
            'valve': 'válvulas',
            'fitting': 'accesorios de plomería',
            'sandpaper': 'lijas',
            'electrical': 'cables/accesorios eléctricos',
            'hardware': 'herrajes',
            'fastener': 'tornillos/clavos',
            'nail': 'clavos',
            'screw': 'tornillos',
            'plaster': 'yeso/estuco',
            'mortar': 'mortero',
            'window': 'ventanas',
            'door': 'puertas',
            'gutter': 'canaletas',
            'insulation': 'materiales de aislamiento'
        };

        let materialesFinales = materialesGemini;
        if (materialesFinales.length === 0) {
            // FALLBACK INTELIGENTE: Solo etiquetas relacionadas con CONSTRUCCIÓN Y FERRETERÍA
            console.log('[UNIFICADOR] ⚠️ Gemini no devolvió materiales, usando FALLBACK INTELIGENTE');
            const materialesDetectados = [];
            const etiquetasUsadas = new Set();
            const ocr = rekognition.texto_ocr_concatenado?.toLowerCase() || '';

            // Lista de etiquetas INÚTILES a filtrar (genéricas, no relacionadas con ferretería)
            const etiquetasInútiles = new Set([
                'architecture', 'building', 'factory', 'manufacturing', 'workshop',
                'head', 'person', 'art', 'handicraft', 'accessories', 'bag', 'handbag',
                'document', 'receipt', 'text', 'symbol', 'number', 'transportation',
                'vehicle', 'city', 'road', 'street', 'urban', 'outdoors', 'countryside',
                'nature', 'car', 'truck', 'rural', 'fire truck', 'fire station', 'village',
                'bus stop', 'housing', 'device', 'can', 'tin', 'furniture', 'advertisement',
                'fence', 'hedge', 'plant', 'path', 'walkway', 'freeway', 'highway', 'sidewalk',
                'grass', 'garden', 'green', 'potted plant', 'jar', 'planter', 'pottery',
                'vase', 'coupe', 'sports car', 'indoors'
            ]);

            // 1. CEMENTO CON MARCAS (PRIORIDAD MÁXIMA)
            if (marcasCemento.length > 0) {
                const marcasStr = marcasCemento.join(', ');
                materialesDetectados.push(`cemento (${marcasStr})`);
                etiquetasUsadas.add('cement');
                console.log(`   ✅ Cemento con marcas: ${marcasStr}`);
            } else if (ocr.includes('cemento') || ocr.includes('bultos')) {
                materialesDetectados.push('cemento');
                etiquetasUsadas.add('cement');
                console.log(`   ✅ Cemento inferido de OCR`);
            }

            // 2. MAPEAR SOLO ETIQUETAS RELEVANTES (FILTRAR INÚTILES)
            const etiquetasRelevantes = Array.from(etiquetasDetectadas).filter(et => !etiquetasInútiles.has(et.toLowerCase()));
            console.log(`   [Etiquetas relevantes (${etiquetasRelevantes.length})]: ${etiquetasRelevantes.slice(0, 10).join(', ') || '(ninguna)'}`);

            for (const etiqueta of etiquetasRelevantes) {
                const etLower = etiqueta.toLowerCase().trim();

                // Buscar coincidencias en mapMateriales
                let encontrado = false;
                for (const [clave, valor] of Object.entries(mapMateriales)) {
                    if (etLower.includes(clave) && !etiquetasUsadas.has(clave)) {
                        let descripcion = valor;

                        // Enriquecer con colores si es tubería
                        if ((clave === 'tube' || clave === 'pipe' || clave === 'pvc') && !etiquetasUsadas.has('pipe')) {
                            const colores = this.extraerColoresDeTuberias(ocr);
                            if (colores.length > 0) {
                                descripcion = `${valor} (${colores.join(', ')})`;
                            }
                        } else if ((clave === 'brick' || clave === 'block') && !etiquetasUsadas.has('block')) {
                            const colores = this.extraerColoresDeBlock(ocr);
                            if (colores.length > 0) {
                                descripcion = `${valor} (${colores.join(', ')})`;
                            }
                        }

                        materialesDetectados.push(descripcion);
                        etiquetasUsadas.add(clave);
                        encontrado = true;
                        console.log(`   ✅ Mapped: ${etiqueta} → ${descripcion}`);
                        break;
                    }
                }

                // NO agregar etiquetas sin mapeo (evitar ruido)
                if (!encontrado) {
                    console.log(`   ⚠️ Sin mapeo pero relevante, descartada: ${etiqueta}`);
                }
            }

            // 3. BUSCAR PALABRAS CLAVE EN OCR QUE NO ESTÉN EN ETIQUETAS
            if (!etiquetasUsadas.has('pipe') && /tuber|pvc|conducto/.test(ocr)) {
                const colores = this.extraerColoresDeTuberias(ocr);
                const desc = colores.length > 0 ? `tuberías/tubos (${colores.join(', ')})` : 'tuberías/tubos';
                materialesDetectados.push(desc);
            }

            if (!etiquetasUsadas.has('rod') && /varilla|acero|rebar/.test(ocr)) {
                materialesDetectados.push('varillas de acero');
            }

            if (!etiquetasUsadas.has('sand') && /arena|grava|agregado|piedra/.test(ocr)) {
                materialesDetectados.push('agregados (arena, grava, piedra)');
            }

            if (!etiquetasUsadas.has('paint') && /pintura|esmalte|sellador|adhesivo/.test(ocr)) {
                materialesDetectados.push('pinturas, esmaltes y adhesivos de construcción');
            }

            // 4. USAR LO DETECTADO Y ELIMINAR DUPLICADOS
            if (materialesDetectados.length > 0) {
                materialesFinales = [...new Set(materialesDetectados)];
                console.log(`[UNIFICADOR] ✅ FALLBACK: ${materialesFinales.length} materiales detectados`);
            } else {
                // FALLBACK FINAL: Respuesta mínima
                materialesFinales = ['Ferretería (análisis sin detalles específicos)'];
            }
        }

        const resultado = {
            vende_cemento: gemini.vende_cemento || (materialesFinales.length > 0 && materialesFinales.some(m => m.toLowerCase().includes('cemento')) ? true : false),
            vende_tubos: gemini.vende_tubos || false,
            vende_varillas: gemini.vende_varillas || false,
            vende_ladrillos: gemini.vende_ladrillos || false,
            vende_tejas: gemini.vende_tejas || false,
            vende_agregados: gemini.vende_agregados || false,
            materiales_observados: materialesFinales.length > 0 ? materialesFinales : (gemini.materiales_observados || []),
            whatsapp: '',
            telefono_fijo: '',
            nivel_confianza: 'bajo',
            score_confianza: 0,
            fuentes: {
                gemini: gemini || {},
                rekognition: rekognition || {}
            }
        };

        // ===== REGLA 1: TELÉFONOS - SOLO REKOGNITION =====
        console.log('\n[UNIFICADOR] Procesando teléfonos...');

        const telefonos_por_tipo = {};
        for (const [tipo, num] of rekognition.telefonos_encontrados || []) {
            if (!telefonos_por_tipo[tipo]) {
                telefonos_por_tipo[tipo] = {};
            }
            telefonos_por_tipo[tipo][num] = (telefonos_por_tipo[tipo][num] || 0) + 1;
        }

        // WhatsApp: usar el más frecuente
        // AJUSTADO: Si aparece 1+ vez y es válido → USAR (menos restrictivo)
        if (telefonos_por_tipo.whatsapp && Object.keys(telefonos_por_tipo.whatsapp).length > 0) {
            const wa_ordenado = Object.entries(telefonos_por_tipo.whatsapp)
                .sort(([, countA], [, countB]) => countB - countA);

            // Aceptar si aparece 1+ veces (era 2+, ahora es 1+)
            if (wa_ordenado[0][1] >= 1) {
                resultado.whatsapp = wa_ordenado[0][0];
                console.log(`   ✅ WhatsApp de Rekognition (frecuencia: ${wa_ordenado[0][1]}): ${resultado.whatsapp}`);
            }
        } else {
            console.log(`   ℹ️ WhatsApp no encontrado en OCR (Rekognition)`);
        }

        // Fijo: usar el más frecuente
        // AJUSTADO: Si aparece 1+ vez y es válido → USAR
        if (telefonos_por_tipo.fijo && Object.keys(telefonos_por_tipo.fijo).length > 0) {
            const fijo_ordenado = Object.entries(telefonos_por_tipo.fijo)
                .sort(([, countA], [, countB]) => countB - countA);

            if (fijo_ordenado[0][1] >= 1) {
                resultado.telefono_fijo = fijo_ordenado[0][0];
                console.log(`   ✅ Teléfono fijo de Rekognition (frecuencia: ${fijo_ordenado[0][1]}): ${resultado.telefono_fijo}`);
            }
        } else {
            console.log(`   ℹ️ Fijo no encontrado en OCR (Rekognition)`);
        }

        // ===== REGLA 2: MARCAS DE CEMENTO - ENRIQUECIMIENTO =====
        console.log('\n[UNIFICADOR] Procesando marcas de cemento...');

        if (rekognition.marcas_cemento && rekognition.marcas_cemento.length > 0) {
            const marcas_ocr = [...new Set(rekognition.marcas_cemento)];
            console.log(`   ✅ Marcas encontradas en OCR: ${marcas_ocr.join(', ')}`);

            // Si Gemini detectó cemento, enriquecer con marcas
            if (resultado.vende_cemento || resultado.materiales_observados.some(m => m.toLowerCase().includes('cemento'))) {
                const materiales = resultado.materiales_observados;
                const cementoIdx = materiales.findIndex(m => m.toLowerCase().startsWith('cemento'));

                if (cementoIdx >= 0) {
                    // Reemplazar cemento con formato "cemento (marca1, marca2)"
                    const marcas_str = marcas_ocr.join(', ');
                    materiales[cementoIdx] = `cemento (${marcas_str})`;
                    console.log(`   ✅ Actualizado: ${materiales[cementoIdx]}`);
                } else if (resultado.vende_cemento) {
                    // Agregar cemento con marcas si Gemini dice que lo vende pero no está en lista
                    const marcas_str = marcas_ocr.join(', ');
                    materiales.unshift(`cemento (${marcas_str})`);
                    console.log(`   ✅ Agregado: ${materiales[0]}`);
                }
            }
        }

        // ===== CALCULAR CONFIANZA =====
        console.log('\n[UNIFICADOR] Calculando confianza...');
        console.log(`   Estado: wa="${resultado.whatsapp}" | fijo="${resultado.telefono_fijo}"`);
        console.log(`   Cemento: ${resultado.vende_cemento} | Otros: ${resultado.vende_tubos || resultado.vende_varillas || resultado.vende_ladrillos || resultado.vende_tejas || resultado.vende_agregados}`);

        let razonesConfianza = [];

        // LÓGICA NUEVA: Basarse en TIPO DE MATERIAL DETECTADO, no en teléfono
        if (resultado.vende_cemento) {
            // Si detectó cemento → ALTO
            resultado.nivel_confianza = 'alto';
            resultado.score_confianza = 75;  // Base: cemento detectado
            razonesConfianza.push('✅ Cemento detectado');

            // BOOST si también tiene teléfono
            if (resultado.whatsapp) {
                resultado.score_confianza = 90;
                razonesConfianza.push(`📱 WhatsApp=${resultado.whatsapp}`);
            } else if (resultado.telefono_fijo) {
                resultado.score_confianza = 85;
                razonesConfianza.push(`📞 Fijo=${resultado.telefono_fijo}`);
            }
        } else if (resultado.vende_tubos || resultado.vende_varillas || resultado.vende_ladrillos || resultado.vende_tejas || resultado.vende_agregados) {
            // Si detectó otros materiales pero NO cemento → MEDIO
            resultado.nivel_confianza = 'medio';
            resultado.score_confianza = 55;  // Base: otros materiales sin cemento
            razonesConfianza.push('⚠️ Otros materiales (sin cemento)');

            // BOOST si tiene teléfono
            if (resultado.whatsapp || resultado.telefono_fijo) {
                resultado.score_confianza = 70;
                razonesConfianza.push(`📱 Contacto: ${resultado.whatsapp || resultado.telefono_fijo}`);
            }
        } else {
            // Si no detectó nada → BAJO
            resultado.nivel_confianza = 'bajo';
            resultado.score_confianza = 20;
            razonesConfianza.push('❌ Sin materiales de construcción detectados');
        }

        console.log(`   📊 Score: ${resultado.score_confianza}% (${resultado.nivel_confianza.toUpperCase()})`);
        console.log(`   ✓ ${razonesConfianza.join(' | ')}`);

        return resultado;
    }

    // ===== FUNCIONES AUXILIARES =====

    extraerTextoDeRekognition(textDetections) {
        // AGRESIVO: Capturar LÍNEAS (confianza > 30) + PALABRAS (confianza > 10)
        const textos = [];

        for (const item of textDetections) {
            // Líneas: confianza > 30 (menos restrictivo)
            if (item.Type === 'LINE' && item.Confidence > 30) {
                textos.push(item.DetectedText);
            }
            // Palabras/números: confianza > 10 (MUY AGRESIVO para números telefónicos pequeños)
            else if (item.Type === 'WORD' && item.Confidence > 10) {
                textos.push(item.DetectedText);
            }
        }

        return textos.join('\n');
    }

    /**
     * Genera variantes de un texto para tolerar errores OCR comunes
     * O→0, I→1, S→5, L→1, Z→2, N→S, etc.
     */
    generarVariantesOCR(palabra) {
        const variantes = new Set([palabra]);

        // Mapeos de confusiones OCR frecuentes (bidireccionales)
        const mapeosOCR = {
            'O': ['0'],           // Letra O → número 0
            '0': ['O'],           // Número 0 → letra O (inverso)
            'I': ['1', 'L'],      // Letra I → número 1 o L
            '1': ['I', 'L'],      // Número 1 → letra I o L
            'S': ['5'],           // Letra S → número 5
            '5': ['S'],           // Número 5 → letra S
            'Z': ['2'],           // Letra Z → número 2
            '2': ['Z'],           // Número 2 → letra Z
            'B': ['8'],           // Letra B → número 8
            '8': ['B'],           // Número 8 → letra B
            'G': ['9'],           // Letra G → número 9
            '9': ['G'],           // Número 9 → letra G
            'L': ['1'],           // Letra L → número 1
            'N': ['S'],           // Letra N → letra S (confusión frecuente en OCR)
            'S': ['5', 'N'],      // Letra S → 5 o N
        };

        // Generar variantes reemplazando caracteres (hasta 2 caracteres de distancia)
        const chars = palabra.split('');
        for (let i = 0; i < chars.length; i++) {
            const char = chars[i];
            if (mapeosOCR[char]) {
                for (const reemplazo of mapeosOCR[char]) {
                    const variante = chars.map((c, idx) => idx === i ? reemplazo : c).join('');
                    variantes.add(variante);
                }
            }
        }

        return Array.from(variantes);
    }

    buscarMarcasCemento(texto) {
        const marcas_conocidas = [
            // CEMENTOS COLOMBIANOS SOLAMENTE
            { nombre: 'ARGOS', patrones: ['ARGOS', 'ARGO'] },
            { nombre: 'HOLCIM', patrones: ['HOLCIM', 'HOLCI'] },
            { nombre: 'CEMEX', patrones: ['CEMEX', 'CEX'] },
            { nombre: 'ULTRACEM', patrones: ['ULTRACEM', 'ULTRA'] },
            { nombre: 'TEQUENDAMA', patrones: ['TEQUENDAMA', 'TEQUEN'] },
            { nombre: 'ALION', patrones: ['ALION'] },
            { nombre: 'SAN MARCOS', patrones: ['SAN MARCOS', 'SANMARCOS'] },
            { nombre: 'LAFARGE', patrones: ['LAFARGE', 'LAFAR'] },
            { nombre: 'ANDINO', patrones: ['ANDINO'] },
            { nombre: 'PORTLAND', patrones: ['PORTLAND'] },
            { nombre: 'PACÍFICO', patrones: ['PACIFICO', 'PACÍFICO'] }
            // NOTA: Tuberías (PAVCO, GRIVAL), acero (ADELCA, ACESCO), adhesivos (MAPEI),
            // y PVC NO van aquí - estos son OTROS materiales, no cemento
        ];

        const encontradas = new Set();
        const textoUpper = texto.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

        for (const marca of marcas_conocidas) {
            for (const patron of marca.patrones) {
                // Búsqueda 1: Patrón exacto
                if (textoUpper.includes(patron)) {
                    encontradas.add(marca.nombre);
                    console.log(`      ✓ Marca detectada: ${marca.nombre} (exacta)`);
                    break;
                }

                // Búsqueda 2: Generar variantes OCR del patrón y buscar
                const variantes = this.generarVariantesOCR(patron);
                for (const variante of variantes) {
                    if (textoUpper.includes(variante)) {
                        encontradas.add(marca.nombre);
                        console.log(`      ✓ Marca detectada: ${marca.nombre} (variante: ${variante})`);
                        break;
                    }
                }

                if (encontradas.has(marca.nombre)) {
                    break;  // Evitar duplicados
                }
            }
        }

        return Array.from(encontradas);
    }

    extraerTelefonosOCR(texto) {
        const telefonos = new Set();

        // PREPROCESAMIENTO: Normalizar espacios múltiples y quitar saltos de línea
        const textoNorm = texto.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();

        // ESTRATEGIA 1: Números celulares con espacios/guiones flexibles (3XX XXX XXXX, 386 09 90, etc)
        const celularesEspaciados = /3[\s.:-]?[0-2][\s.:-]?\d[\s.:-]?\d[\s.:-]?\d[\s.:-]?\d[\s.:-]?\d[\s.:-]?\d[\s.:-]?\d[\s.:-]?\d/gi;
        const matchesCelular = textoNorm.matchAll(celularesEspaciados);
        for (const match of matchesCelular) {
            const limpio = match[0].replace(/[\s.:-]/g, '');
            if (/^3[0-2]\d{8}$/.test(limpio)) {
                telefonos.add(limpio);
                console.log(`      ✓ Celular encontrado: "${match[0]}" → ${limpio}`);
            }
        }

        // ESTRATEGIA 2: Números fijos con espacios (604/605 XXX XXXX)
        const fijosEspaciados = /(?:604|605)[\s.:-]?\d[\s.:-]?\d[\s.:-]?\d[\s.:-]?\d[\s.:-]?\d[\s.:-]?\d[\s.:-]?\d/gi;
        const matchesFijos = textoNorm.matchAll(fijosEspaciados);
        for (const match of matchesFijos) {
            const limpio = match[0].replace(/[\s.:-]/g, '');
            if (/^(?:604|605)\d{7}$/.test(limpio)) {
                telefonos.add(limpio);
                console.log(`      ✓ Fijo encontrado: "${match[0]}" → ${limpio}`);
            }
        }

        // ESTRATEGIA 3: Paréntesis (604) XXX-XXXX
        const parentesis = /\((?:604|605)\)\s*\d{3}[-\s.]?\d{4}/gi;
        const matchesParentesis = textoNorm.matchAll(parentesis);
        for (const match of matchesParentesis) {
            const limpio = match[0].replace(/[^\d]/g, '');
            if (limpio.length >= 10) {
                telefonos.add(limpio);
                console.log(`      ✓ Fijo (parén) encontrado: "${match[0]}" → ${limpio}`);
            }
        }

        // ESTRATEGIA 4: Prefijo +57 con números
        const conPrefijo = /\+57[\s.]?3[0-2][\s.]?\d[\s.]?\d[\s.]?\d[\s.]?\d[\s.]?\d[\s.]?\d[\s.]?\d[\s.]?\d/gi;
        const matchesPrefijo = textoNorm.matchAll(conPrefijo);
        for (const match of matchesPrefijo) {
            const limpio = match[0].replace(/[^\d]/g, '');
            if (limpio.length === 12 && limpio.startsWith('57')) {
                telefonos.add(limpio.substring(2));
                console.log(`      ✓ Prefijo +57 encontrado: "${match[0]}" → ${limpio.substring(2)}`);
            }
        }

        // ESTRATEGIA 5: Números sin formato (secuencias de 10 dígitos exactos para celular)
        const digitos10 = /\b3[0-2]\d{8}\b/g;
        const matches10 = textoNorm.matchAll(digitos10);
        for (const match of matches10) {
            telefonos.add(match[0]);
            console.log(`      ✓ Celular (10 dígitos) encontrado: ${match[0]}`);
        }

        // ESTRATEGIA 6: Números fijos (7-8 dígitos)
        const digitos7_8 = /(?:604|605)\d{7}\b/g;
        const matches7_8 = textoNorm.matchAll(digitos7_8);
        for (const match of matches7_8) {
            telefonos.add(match[0]);
            console.log(`      ✓ Fijo (7-8 dígitos) encontrado: ${match[0]}`);
        }

        if (telefonos.size === 0) {
            console.log(`      ⚠️ No se encontraron teléfonos en el texto`);
        }

        return Array.from(telefonos);
    }

    extraerColoresDeTuberias(ocr) {
        // Buscar colores típicos de tuberías PVC en el texto OCR
        const colores = new Set();
        const textoLower = ocr.toLowerCase();

        const colorPatterns = {
            'blanco': ['blanco', 'white', 'pvc blanco'],
            'gris': ['gris', 'gray', 'gri', 'pvc gris'],
            'naranja': ['naranja', 'orange', 'naranjo', 'anaranjado'],
            'amarillo': ['amarillo', 'yellow', 'amari'],
            'rojo': ['rojo', 'red'],
            'verde': ['verde', 'green'],
            'azul': ['azul', 'blue']
        };

        for (const [color, patrones] of Object.entries(colorPatterns)) {
            for (const patron of patrones) {
                if (textoLower.includes(patron)) {
                    colores.add(color);
                }
            }
        }

        return Array.from(colores);
    }

    extraerColoresDeBlock(ocr) {
        // Buscar colores de bloques y ladrillos en OCR
        const colores = new Set();
        const textoLower = ocr.toLowerCase();

        const colorPatterns = {
            'gris': ['gris', 'gray', 'gri', 'bloque gris'],
            'rojo': ['rojo', 'red', 'ladrillo rojo'],
            'blanco': ['blanco', 'white'],
            'naranja': ['naranja', 'orange']
        };

        for (const [color, patrones] of Object.entries(colorPatterns)) {
            for (const patron of patrones) {
                if (textoLower.includes(patron)) {
                    colores.add(color);
                }
            }
        }

        return Array.from(colores);
    }

    respuestaDefault() {
        return {
            vende_cemento: false,
            vende_tubos: false,
            vende_varillas: false,
            vende_ladrillos: false,
            vende_tejas: false,
            vende_agregados: false,
            materiales_observados: ['Error: análisis no disponible'],
            whatsapp: '',
            telefono_fijo: '',
            nivel_confianza: 'bajo',
            score_confianza: 0,
            fuentes: {}
        };
    }
}

module.exports = AnalizadorUnificado;
