/**
 * Google Cloud Vision - Análisis de imágenes con OCR y detección de objetos
 * Alternativa a AWS Rekognition con mejor precisión en texto
 */

const axios = require('axios');

class VisionAnalyzer {
    constructor(apiKey) {
        this.credentialsAvailable = false;
        this.apiKey = apiKey || process.env.GOOGLE_CLOUD_VISION_API_KEY;

        // Solo usar Vision si hay una clave explícita de Vision (no Gemini)
        // Esto evita problemas de permisos cuando se usa la clave de Gemini
        if (this.apiKey && process.env.GOOGLE_CLOUD_VISION_API_KEY) {
            this.credentialsAvailable = true;
            this.endpoint = 'https://vision.googleapis.com/v1/images:annotate';
        } else {
            // Vision es opcional - el sistema funciona sin ella
            console.log('[Vision] No habilitada (requiere GOOGLE_CLOUD_VISION_API_KEY separada)');
        }
    }

    async analizarImagenBase64(imageData) {
        if (!this.credentialsAvailable) {
            return null;
        }

        try {
            // Convertir Buffer a string si es necesario
            let base64String = imageData;
            if (Buffer.isBuffer(imageData)) {
                base64String = imageData.toString('base64');
            }

            const cleanBase64 = base64String.replace(/^data:image\/\w+;base64,/, '');

            const request = {
                requests: [
                    {
                        image: {
                            content: cleanBase64
                        },
                        features: [
                            { type: 'TEXT_DETECTION', maxResults: 50 },
                            { type: 'OBJECT_LOCALIZATION', maxResults: 10 },
                            { type: 'LABEL_DETECTION', maxResults: 20 }
                        ]
                    }
                ]
            };

            const response = await axios.post(`${this.endpoint}?key=${this.apiKey}`, request, {
                timeout: 30000,
                headers: { 'Content-Type': 'application/json' }
            });

            const result = response.data.responses?.[0];
            if (!result) {
                return null;
            }

            return {
                texto: this.extraerTexto(result.textAnnotations),
                objetos: this.extraerObjetos(result.localizedObjectAnnotations),
                etiquetas: this.extraerEtiquetas(result.labelAnnotations)
            };
        } catch (error) {
            console.error(`   ❌ Error Google Cloud Vision: ${error.message}`);
            return null;
        }
    }

    extraerTexto(textAnnotations) {
        if (!textAnnotations || textAnnotations.length === 0) {
            return [];
        }

        // Primera anotación es el texto completo (OCR completo)
        const fullText = textAnnotations[0]?.description || '';

        // Resto son palabras individuales con ubicación
        const palabras = textAnnotations.slice(1).map(annotation => ({
            texto: annotation.description,
            confianza: annotation.confidence || 0.9
        }));

        return {
            textoCompleto: fullText,
            palabras: palabras
        };
    }

    extraerObjetos(objects) {
        if (!objects) return [];

        return objects.map(obj => ({
            nombre: obj.name,
            confianza: (obj.score * 100).toFixed(1),
            boundingPoly: obj.boundingPoly
        }));
    }

    extraerEtiquetas(labels) {
        if (!labels) return [];

        return labels.map(label => ({
            descripcion: label.description,
            confianza: (label.score * 100).toFixed(1)
        }));
    }

    detectarMarcasCemento(textoCompleto) {
        const marcas = {
            'ALIÓN': { patron: /al[íi]?[o0]n|ali[o0]n/i, confianza: 0 },
            'ARGOS': { patron: /argos/i, confianza: 0 },
            'HOLCIM': { patron: /holcim/i, confianza: 0 },
            'ULTRACEM': { patron: /ultracem/i, confianza: 0 },
            'CEMEX': { patron: /cemex/i, confianza: 0 },
            'LAFARGE': { patron: /lafarge/i, confianza: 0 },
            'TEQUENDAMA': { patron: /tequendama/i, confianza: 0 },
            'ANDINO': { patron: /andino/i, confianza: 0 },
            'PORTLAND': { patron: /portland/i, confianza: 0 },
            'PACIFICO': { patron: /pac[íi]fico/i, confianza: 0 },
            'COLOMBIANO': { patron: /colombiano/i, confianza: 0 }
        };

        const detectadas = [];
        for (const [marca, config] of Object.entries(marcas)) {
            if (config.patron.test(textoCompleto)) {
                detectadas.push({
                    marca,
                    confianza: 'alto'
                });
            }
        }

        return detectadas;
    }
}

module.exports = VisionAnalyzer;
