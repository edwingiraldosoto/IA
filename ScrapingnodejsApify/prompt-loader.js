const fs = require('fs');
const path = require('path');

const DEFAULT_PROMPT_PATH = path.join(__dirname, 'prompts', 'evaluacion-imagenes.txt');

function renderTemplate(template, variables) {
    return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) => {
        if (!Object.prototype.hasOwnProperty.call(variables, key)) return match;
        return String(variables[key]);
    });
}

function cargarPromptEvaluacionImagenes({ cantidadImagenes, nombreNegocio }) {
    const promptPath = process.env.PROMPT_EVALUACION_IMAGENES_PATH
        ? path.resolve(process.env.PROMPT_EVALUACION_IMAGENES_PATH)
        : DEFAULT_PROMPT_PATH;

    const template = fs.readFileSync(promptPath, 'utf8');

    return renderTemplate(template, {
        cantidad_imagenes: cantidadImagenes,
        nombre_negocio: nombreNegocio
    });
}

module.exports = { cargarPromptEvaluacionImagenes };
