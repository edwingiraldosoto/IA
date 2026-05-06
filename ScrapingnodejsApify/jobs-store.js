const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const JOBS_DIR = './jobs';
if (!fs.existsSync(JOBS_DIR)) fs.mkdirSync(JOBS_DIR);

const jobs = new Map(); // jobs en memoria

function crearJob(config) {
    const jobId = crypto.randomBytes(8).toString('hex');
    const job = {
        id: jobId,
        status: 'pending',        // pending | running | completed | failed
        createdAt: new Date().toISOString(),
        startedAt: null,
        finishedAt: null,
        config,
        progress: { current: 0, total: 0, currentItem: null },
        result: null,
        error: null
    };
    jobs.set(jobId, job);
    guardarJob(job);
    return job;
}

function actualizarJob(jobId, cambios) {
    const job = jobs.get(jobId);
    if (!job) return null;
    Object.assign(job, cambios);
    guardarJob(job);
    return job;
}

function obtenerJob(jobId) {
    if (jobs.has(jobId)) return jobs.get(jobId);
    // Si no está en memoria, buscar en disco (útil si reinicias el server)
    const filePath = path.join(JOBS_DIR, `${jobId}.json`);
    if (fs.existsSync(filePath)) {
        const job = JSON.parse(fs.readFileSync(filePath));
        jobs.set(jobId, job);
        return job;
    }
    return null;
}

function listarJobs() {
    return Array.from(jobs.values()).sort((a, b) => 
        new Date(b.createdAt) - new Date(a.createdAt)
    );
}

function guardarJob(job) {
    const filePath = path.join(JOBS_DIR, `${job.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(job, null, 2));
}

// Cargar jobs persistidos al arrancar
function cargarJobsExistentes() {
    if (!fs.existsSync(JOBS_DIR)) return;
    const archivos = fs.readdirSync(JOBS_DIR).filter(f => f.endsWith('.json'));
    for (const archivo of archivos) {
        try {
            const job = JSON.parse(fs.readFileSync(path.join(JOBS_DIR, archivo)));
            // Jobs "running" que quedaron colgados tras reinicio → marcar como failed
            if (job.status === 'running') {
                job.status = 'failed';
                job.error = 'Servidor reiniciado durante ejecución';
            }
            jobs.set(job.id, job);
        } catch (e) {
            console.error(`Error cargando ${archivo}:`, e.message);
        }
    }
    console.log(`📂 Cargados ${jobs.size} jobs existentes`);
}

cargarJobsExistentes();

module.exports = { crearJob, actualizarJob, obtenerJob, listarJobs };