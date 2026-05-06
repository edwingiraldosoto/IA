require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { ejecutarPipeline } = require('./app');
const { crearJob, actualizarJob, obtenerJob, listarJobs } = require('./jobs-store');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// =====================
// POST /api/jobs — Crear nuevo job de scraping
// =====================
app.post('/api/jobs', async (req, res) => {
    const { departamento, municipios, searchQueries, maxPlaces, maxImages } = req.body;
    
    if (!departamento || !municipios || !Array.isArray(municipios) || municipios.length === 0) {
        return res.status(400).json({ error: 'Se requiere departamento y al menos un municipio' });
    }
    if (!searchQueries || !Array.isArray(searchQueries) || searchQueries.length === 0) {
        return res.status(400).json({ error: 'Se requiere al menos una búsqueda (searchQueries)' });
    }
    
    // Generar un job por cada municipio (para poder procesar en paralelo si quieres luego)
    const jobsCreados = [];
    
    for (const municipio of municipios) {
        const locationQuery = `${municipio}, ${departamento}, Colombia`;
        const job = crearJob({
            departamento,
            municipio,
            locationQuery,
            searchQueries,
            maxPlaces: maxPlaces || 50,
            maxImages: maxImages || 10
        });
        jobsCreados.push(job);
        
        // Ejecutar en background (no await)
        ejecutarJobEnBackground(job.id);
    }
    
    res.status(202).json({ 
        mensaje: `${jobsCreados.length} job(s) creado(s)`,
        jobs: jobsCreados.map(j => ({ id: j.id, municipio: j.config.municipio, status: j.status }))
    });
});

// =====================
// GET /api/jobs — Listar todos los jobs
// =====================
app.get('/api/jobs', (req, res) => {
    res.json(listarJobs());
});

// =====================
// GET /api/jobs/:id — Consultar estado de un job específico
// =====================
app.get('/api/jobs/:id', (req, res) => {
    const job = obtenerJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job no encontrado' });
    res.json(job);
});

// =====================
// FUNCIÓN PARA EJECUTAR JOB EN BACKGROUND
// =====================
async function ejecutarJobEnBackground(jobId) {
    actualizarJob(jobId, { status: 'running', startedAt: new Date().toISOString() });
    
    const job = obtenerJob(jobId);
    
    try {
        const resultado = await ejecutarPipeline({
            searchQueries: job.config.searchQueries,
            locationQuery: job.config.locationQuery,
            maxPlaces: job.config.maxPlaces,
            maxImages: job.config.maxImages,
            onProgress: (progreso) => {
                actualizarJob(jobId, { progress: progreso });
            }
        });
        
        actualizarJob(jobId, { 
            status: 'completed', 
            finishedAt: new Date().toISOString(),
            result: resultado
        });
        console.log(`✅ Job ${jobId} completado`);
        
    } catch (error) {
        actualizarJob(jobId, { 
            status: 'failed', 
            finishedAt: new Date().toISOString(),
            error: error.message
        });
        console.error(`❌ Job ${jobId} falló:`, error.message);
    }
}

app.listen(PORT, () => {
    console.log(`🚀 API corriendo en http://localhost:${PORT}`);
    console.log(`📖 Endpoints:`);
    console.log(`   POST /api/jobs       → crear job`);
    console.log(`   GET  /api/jobs       → listar jobs`);
    console.log(`   GET  /api/jobs/:id   → ver job`);
});