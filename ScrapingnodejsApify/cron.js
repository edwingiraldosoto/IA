require('dotenv').config();
require('events').EventEmitter.defaultMaxListeners = 30;

const cron = require('node-cron');
const { ejecutarPipeline } = require('./app');

const SCHEDULE = process.env.CRON_SCHEDULE || '0 3 * * *';
const DEPARTAMENTO = process.env.CRON_DEPARTAMENTO || 'Antioquia';
const MUNICIPIOS = (process.env.CRON_MUNICIPIOS || 'Envigado').split(',').map(s => s.trim());
const SEARCH_QUERIES = (process.env.CRON_SEARCH_QUERIES || 'ferreterías').split(',').map(s => s.trim());
const MAX_PLACES = parseInt(process.env.CRON_MAX_PLACES || '50');

console.log(`⏰ Cron configurado: ${SCHEDULE}`);
console.log(`📍 Departamento: ${DEPARTAMENTO}`);
console.log(`📍 Municipios: ${MUNICIPIOS.join(', ')}`);
console.log(`🔎 Queries: ${SEARCH_QUERIES.join(', ')}`);

async function ejecutarCron() {
    console.log(`\n⏰ [${new Date().toISOString()}] Cron iniciado`);
    
    for (const municipio of MUNICIPIOS) {
        const locationQuery = `${municipio}, ${DEPARTAMENTO}, Colombia`;
        console.log(`\n🔄 Procesando: ${locationQuery}`);
        
        try {
            await ejecutarPipeline({
                searchQueries: SEARCH_QUERIES,
                locationQuery,
                maxPlaces: MAX_PLACES,
                maxImages: 10
            });
        } catch (err) {
            console.error(`❌ Error en ${municipio}:`, err.message);
        }
    }
    
    console.log(`\n✅ Cron finalizado: ${new Date().toISOString()}`);
}

cron.schedule(SCHEDULE, ejecutarCron);

if (process.argv.includes('--run-now')) {
    ejecutarCron();
}

console.log('⏳ Cron corriendo en background (Ctrl+C para detener)');