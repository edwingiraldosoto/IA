require('dotenv').config();
const axios = require('axios');
const { RekognitionClient, DetectTextCommand, DetectLabelsCommand } = require('@aws-sdk/client-rekognition');

const rekognition = new RekognitionClient({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

// URLs de prueba - Ferretería La Bomba
const URLs_IMAGENES = [
    "https://lh3.googleusercontent.com/p/AF1QipOZfMK0t54s94vRp908SmB1QSfk9UTZipU5oDzt=w1920-h1080-k-no",
    "https://lh3.googleusercontent.com/p/AF1QipN6ynsonePMJBv8egRTjbffh2_xBtuulftHMxrF=w1920-h1080-k-no",
    "https://lh3.googleusercontent.com/p/AF1QipPqR5LBM8kDtt4152R8vHQx8assYvCQ0OOTf15_=w1920-h1080-k-no"
];

async function descargarImagen(url) {
    try {
        console.log(`\n📥 Descargando: ${url.substring(0, 60)}...`);
        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 20000
        });
        return Buffer.from(response.data);
    } catch (error) {
        console.error(`   ❌ Error descarga: ${error.message}`);
        return null;
    }
}

async function analizarImagenRekognition(imageBuffer, imagenIndice) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`📸 IMAGEN ${imagenIndice + 1} - ANÁLISIS DETALLADO`);
    console.log(`${'='.repeat(70)}`);

    try {
        // 1. Detectar objetos/escena
        console.log(`\n🏷️  DETECCIÓN DE OBJETOS Y ESCENA:`);
        const labelCommand = new DetectLabelsCommand({
            Image: { Bytes: imageBuffer },
            MaxLabels: 30,
            MinConfidence: 40
        });
        const labelResponse = await rekognition.send(labelCommand);

        if (labelResponse.Labels && labelResponse.Labels.length > 0) {
            console.log(`   Encontrados ${labelResponse.Labels.length} objetos:`);
            labelResponse.Labels.slice(0, 15).forEach(label => {
                console.log(`   - ${label.Name}: ${label.Confidence.toFixed(1)}%`);
            });
        }

        // 2. Detectar texto con detalles
        console.log(`\n📝 DETECCIÓN DE TEXTO (OCR):`);
        const textCommand = new DetectTextCommand({
            Image: { Bytes: imageBuffer }
        });
        const textResponse = await rekognition.send(textCommand);

        if (textResponse.TextDetections && textResponse.TextDetections.length > 0) {
            console.log(`   Total detecciones: ${textResponse.TextDetections.length}`);

            // Separar por tipo
            const lineas = textResponse.TextDetections.filter(t => t.Type === 'LINE');
            const palabras = textResponse.TextDetections.filter(t => t.Type === 'WORD');

            console.log(`\n   📋 LÍNEAS (${lineas.length}):`);
            lineas.forEach((line, i) => {
                console.log(`      [${i}] "${line.DetectedText}" | Conf: ${line.Confidence?.toFixed(1)}%`);
            });

            console.log(`\n   📊 PALABRAS (${palabras.length}):`);
            palabras.slice(0, 20).forEach((word, i) => {
                console.log(`      [${i}] "${word.DetectedText}" | Conf: ${word.Confidence?.toFixed(1)}%`);
            });

            // 3. Buscar números de teléfono
            console.log(`\n   📱 BÚSQUEDA DE NÚMEROS:`);
            const textoCompleto = lineas.map(t => t.DetectedText).join(' ');
            const textoPalabras = palabras.map(t => t.DetectedText).join(' ');

            // Regex para celulares (con espacios)
            const regexCelular = /3[\s.-]?[0-2][\s.-]?\d[\s.-]?\d[\s.-]?\d[\s.-]?\d[\s.-]?\d[\s.-]?\d[\s.-]?\d[\s.-]?\d/gi;
            const celularesEspaciados = textoPalabras.match(regexCelular) || [];

            if (celularesEspaciados.length > 0) {
                console.log(`      ✅ Celulares detectados:`);
                celularesEspaciados.forEach(cel => {
                    const limpio = cel.replace(/[\s.-]/g, '');
                    console.log(`         "${cel}" → ${limpio}`);
                });
            } else {
                console.log(`      ❌ No se detectaron celulares con formato espaciado`);
            }

            // Regex para fijos (7-8 dígitos)
            const regexFijo = /\b\d{3}[\s.-]?\d{2}[\s.-]?\d{2}\b|\b\d{3}[\s.-]?\d{4}\b/g;
            const fijos = textoCompleto.match(regexFijo) || [];
            if (fijos.length > 0) {
                console.log(`      ✅ Teléfonos fijos detectados:`);
                fijos.forEach(fijo => {
                    const limpio = fijo.replace(/[\s.-]/g, '');
                    console.log(`         "${fijo}" → ${limpio}`);
                });
            }
        } else {
            console.log(`   ❌ No se detectó texto en esta imagen`);
        }

        // 4. Análisis de visibilidad
        console.log(`\n👁️  ANÁLISIS DE VISIBILIDAD/ÁNGULO:`);
        const tieneLetrero = labelResponse.Labels?.some(l =>
            l.Name.toLowerCase().includes('sign') ||
            l.Name.toLowerCase().includes('text') ||
            l.Name.toLowerCase().includes('storefront')
        );

        const tieneNumeros = textResponse.TextDetections?.some(t =>
            /\d/.test(t.DetectedText) && t.Confidence > 70
        );

        console.log(`   Letrero/señalización visible: ${tieneLetrero ? '✅ SÍ' : '❌ NO'}`);
        console.log(`   Números/dígitos claros (>70%): ${tieneNumeros ? '✅ SÍ' : '❌ NO'}`);

        return {
            indices: imagenIndice,
            tieneLetrero,
            tieneNumeros,
            lineasDetectadas: textResponse.TextDetections?.filter(t => t.Type === 'LINE').length || 0,
            palabrasDetectadas: textResponse.TextDetections?.filter(t => t.Type === 'WORD').length || 0,
            textoCompleto: textResponse.TextDetections?.filter(t => t.Type === 'LINE').map(t => t.DetectedText).join(' ') || '',
            confianzaPromedio: textResponse.TextDetections?.reduce((a, t) => a + (t.Confidence || 0), 0) / (textResponse.TextDetections?.length || 1) || 0
        };

    } catch (error) {
        console.error(`   ❌ Error Rekognition: ${error.message}`);
        return null;
    }
}

async function main() {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`🔬 ANÁLISIS DETALLADO REKOGNITION - FERRETERÍA LA BOMBA`);
    console.log(`   Validando extracción de datos desde Street View e imágenes Google Maps`);
    console.log(`${'='.repeat(70)}`);

    const resultados = [];

    for (let i = 0; i < URLs_IMAGENES.length; i++) {
        const buffer = await descargarImagen(URLs_IMAGENES[i]);
        if (buffer) {
            const analisis = await analizarImagenRekognition(buffer, i);
            if (analisis) resultados.push(analisis);
        }

        if (i < URLs_IMAGENES.length - 1) {
            await new Promise(r => setTimeout(r, 1000));
        }
    }

    // Resumen final
    console.log(`\n${'='.repeat(70)}`);
    console.log(`📊 RESUMEN FINAL`);
    console.log(`${'='.repeat(70)}`);

    console.log(`\n   Imágenes analizadas: ${resultados.length}/${URLs_IMAGENES.length}`);
    console.log(`   Con letrero visible: ${resultados.filter(r => r.tieneLetrero).length}`);
    console.log(`   Con números claros: ${resultados.filter(r => r.tieneNumeros).length}`);

    const confianzaPromedio = resultados.reduce((a, r) => a + r.confianzaPromedio, 0) / resultados.length;
    console.log(`   Confianza promedio OCR: ${confianzaPromedio.toFixed(1)}%`);

    console.log(`\n   RECOMENDACIÓN:`);
    if (confianzaPromedio > 75) {
        console.log(`   ✅ Rekognition está detectando bien el texto. Los números son confiables.`);
    } else if (confianzaPromedio > 60) {
        console.log(`   ⚠️  Confianza media. Validar números contra múltiples imágenes.`);
    } else {
        console.log(`   ❌ Baja confianza. Priorizar validación manual o visión (Gemini).`);
    }

    console.log(`\n${'='.repeat(70)}\n`);
}

main().catch(err => {
    console.error('❌ Error fatal:', err.message);
    process.exit(1);
});
