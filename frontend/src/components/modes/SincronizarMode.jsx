import { useState, useEffect, useRef } from 'react';

const SYNC_API_URL = import.meta.env.VITE_SYNC_API_URL || 'http://127.0.0.1:8001';

export default function SincronizarMode() {
    const [estado, setEstado] = useState('idle'); // idle | encolado | procesando | completado | error
    const [jobId, setJobId] = useState(null);
    const [detalle, setDetalle] = useState(null);
    const [mensaje, setMensaje] = useState('');
    const intervalRef = useRef(null);

    const detenerPolling = () => {
        if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
        }
    };

    useEffect(() => {
        return () => detenerPolling();
    }, []);

    const consultarEstado = async (id) => {
        try {
            const res = await fetch(`${SYNC_API_URL}/sincronizar/${id}`);
            const data = await res.json();
            const s = data.estado;

            setMensaje(data.mensaje || '');

            if (s === 'completado') {
                setEstado('completado');
                setDetalle(data.detalle);
                detenerPolling();
            } else if (s === 'error') {
                setEstado('error');
                detenerPolling();
            } else {
                setEstado(s); // pendiente | procesando
            }
        } catch {
            // si falla el polling, no detener — puede ser un parpadeo de red
        }
    };

    const sincronizar = async () => {
        setEstado('encolado');
        setJobId(null);
        setDetalle(null);
        setMensaje('');
        detenerPolling();

        try {
            const res = await fetch(`${SYNC_API_URL}/sincronizar`, { method: 'POST' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();

            setJobId(data.job_id);
            setMensaje(data.mensaje || '');
            setEstado(data.estado || 'pendiente');

            // Iniciar polling cada 2s
            intervalRef.current = setInterval(() => consultarEstado(data.job_id), 2000);
        } catch (err) {
            setEstado('error');
            setMensaje(`Error al conectar con el servidor: ${err.message}`);
        }
    };

    const reiniciar = () => {
        detenerPolling();
        setEstado('idle');
        setJobId(null);
        setDetalle(null);
        setMensaje('');
    };

    const enProceso = estado === 'encolado' || estado === 'pendiente' || estado === 'procesando';

    return (
        <section className="card">
            <div className="card-header">
                <span className="card-number">🔄</span>
                <h2>Sincronizar datos</h2>
            </div>

            <p style={{ color: '#6b7280', fontSize: 14, marginBottom: '1.5rem' }}>
                Unifica los registros de <strong>FERRETERIASRUES</strong>, <strong>FerreteriasApify</strong> y <strong>ARGOS</strong> en una sola tabla consolidada.
            </p>

            {estado === 'idle' && (
                <button onClick={sincronizar} className="btn-launch">
                    🔄 Sincronizar ahora
                </button>
            )}

            {enProceso && (
                <>
                    <button disabled className="btn-launch">
                        ⏳ {estado === 'pendiente' ? 'En cola...' : 'Sincronizando...'}
                    </button>
                    {mensaje && (
                        <div className="info-box" style={{ marginTop: '1rem' }}>
                            <div className="info-box-text">{mensaje}</div>
                        </div>
                    )}
                </>
            )}

            {estado === 'completado' && detalle && (
                <>
                    <div className="file-info show" style={{ marginBottom: '1rem' }}>
                        <div className="file-name">
                            <span>✅</span>
                            <span>{mensaje}</span>
                        </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '1.5rem' }}>
                        <StatBox label="Total RUES"       value={detalle.total_rues}              color="#4338ca" />
                        <StatBox label="Total Apify"      value={detalle.total_apify}             color="#059669" />
                        <StatBox label="Total ARGOS"      value={detalle.total_argos}             color="#003087" />
                        <StatBox label="Solo RUES"        value={detalle.total_solo_rues}        color="#6b7280" />
                        <StatBox label="Solo Apify"       value={detalle.total_solo_apify}       color="#C4D600" dark />
                        <StatBox label="Solo ARGOS"       value={detalle.total_solo_argos}       color="#ef4444" />
                        <StatBox label="Emparejados"      value={detalle.total_unificados}       color="#0046B2" />
                    </div>

                    {detalle.fecha_inicio && detalle.fecha_fin && (
                        <div style={{ fontSize: 13, color: '#6b7280', textAlign: 'center', marginBottom: '1.5rem' }}>
                            ⏱️ Tiempo de ejecución: <strong>{calcularTiempo(detalle.fecha_inicio, detalle.fecha_fin)}</strong>
                        </div>
                    )}

                    <button onClick={reiniciar} className="btn-secondary" style={{ width: '100%' }}>
                        🔄 Nueva sincronización
                    </button>
                </>
            )}

            {estado === 'error' && (
                <>
                    <div className="job-error">{mensaje}</div>
                    <button onClick={reiniciar} className="btn-secondary" style={{ width: '100%', marginTop: '1rem' }}>
                        Reintentar
                    </button>
                </>
            )}
        </section>
    );
}

function calcularTiempo(inicio, fin) {
    const msInicio = new Date(inicio).getTime();
    const msFin = new Date(fin).getTime();
    const diffMs = msFin - msInicio;
    const segundos = Math.floor(diffMs / 1000);
    const minutos = Math.floor(segundos / 60);
    const segs = segundos % 60;

    if (minutos > 0) {
        return `${minutos}m ${segs}s`;
    }
    return `${segundos}s`;
}

function StatBox({ label, value, color, dark }) {
    return (
        <div style={{
            background: 'white',
            border: `2px solid ${color}20`,
            borderRadius: 12,
            padding: '16px',
            textAlign: 'center',
        }}>
            <div style={{ fontSize: 28, fontWeight: 800, color }}>{value ?? '—'}</div>
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>{label}</div>
        </div>
    );
}
