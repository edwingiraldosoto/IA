import { useEffect, useState, useRef } from 'react';

const RUES_API_URL = import.meta.env.VITE_RUES_API_URL || 'http://localhost:8001';

export default function HistorialRUES() {
    const [historiales, setHistoriales] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [filtroEstado, setFiltroEstado] = useState('todos');
    const pollingIntervalsRef = useRef([]);

    // Cargar historial al montar componente
    useEffect(() => {
        cargarHistorial();
        return () => {
            // Limpiar polling intervals al desmontar
            pollingIntervalsRef.current.forEach(id => clearInterval(id));
        };
    }, []);

    // Polling para procesamientos en progreso
    useEffect(() => {
        // Limpiar intervalos previos
        pollingIntervalsRef.current.forEach(id => clearInterval(id));
        pollingIntervalsRef.current = [];

        // Crear nuevo polling para items en procesamiento
        const historialesEnProceso = historiales.filter(h => h.estado === 'processing');

        historialesEnProceso.forEach((h) => {
            const id = setInterval(async () => {
                try {
                    const response = await fetch(`${RUES_API_URL}/estado-rues/${h.file_id}`);
                    if (response.ok) {
                        const estado = await response.json();
                        setHistoriales(prev => prev.map(item =>
                            item.file_id === h.file_id
                                ? {
                                    ...item,
                                    estado: estado.estado,
                                    procesados: estado.registros?.procesados || 0,
                                    total: estado.registros?.total || item.total,
                                    mensaje: estado.mensaje || item.mensaje
                                }
                                : item
                        ));
                    }
                } catch (err) {
                    console.error('Error en polling de historial:', err);
                }
            }, 2500);

            pollingIntervalsRef.current.push(id);
        });

        return () => {
            pollingIntervalsRef.current.forEach(id => clearInterval(id));
        };
    }, [historiales]);

    const cargarHistorial = async () => {
        try {
            setLoading(true);
            setError(null);
            const response = await fetch(`${RUES_API_URL}/historial-rues`);

            if (!response.ok) {
                throw new Error(`Error ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            const historialesList = Array.isArray(data) ? data : data.historiales || [];

            // Mapear nombres de propiedades del backend al frontend
            const historialesMapeados = historialesList.map(h => ({
                file_id: h.FILE_ID,
                archivo: h.FILENAME,
                estado: h.STATUS,
                fecha: h.CREATED_AT || h.FECHA_ACTUALIZACION,
                procesados: h.REGISTROS_PROCESADOS || 0,
                total: h.TOTAL_RECORDS || 0,
                departamentos: h.DEPARTAMENTOS ? (Array.isArray(h.DEPARTAMENTOS) ? h.DEPARTAMENTOS.join(', ') : h.DEPARTAMENTOS) : null,
                municipios: h.MUNICIPIOS ? (Array.isArray(h.MUNICIPIOS) ? h.MUNICIPIOS.join(', ') : h.MUNICIPIOS) : null,
                mensaje: h.MENSAJE
            }));

            const ordenados = [...historialesMapeados].sort(
                (a, b) => new Date(b.fecha) - new Date(a.fecha)
            );
            setHistoriales(ordenados);
        } catch (err) {
            setError(`Error cargando historial: ${err.message}`);
            console.error('Error en cargarHistorial:', err);
        } finally {
            setLoading(false);
        }
    };

    const calcularProgreso = (procesados, total) => {
        if (total === 0) return 0;
        return Math.round((procesados / total) * 100);
    };

    const obtenerColorEstado = (status) => {
        switch (status) {
            case 'completed':
                return '#10b981';
            case 'processing':
                return '#3b82f6';
            case 'failed':
                return '#ef4444';
            case 'no_data':
                return '#f59e0b';
            default:
                return '#6b7280';
        }
    };

    const obtenerTextoEstado = (status) => {
        switch (status) {
            case 'completed':
                return '✅ Completado';
            case 'processing':
                return '🔄 En proceso';
            case 'failed':
                return '❌ Fallido';
            case 'no_data':
                return '📭 Sin datos';
            default:
                return '⏳ Desconocido';
        }
    };

    const verDetalles = (historial) => {
        const detalles = `
📋 DETALLES DEL PROCESAMIENTO

Archivo: ${historial.archivo}
ID: ${historial.file_id}

FILTROS APLICADOS:
  • Departamentos: ${historial.departamentos || 'Todos'}
  • Municipios: ${historial.municipios || 'Todos'}

ESTADO: ${obtenerTextoEstado(historial.estado)}
Registros procesados: ${historial.procesados || 0}/${historial.total || 0}
Progreso: ${calcularProgreso(historial.procesados || 0, historial.total || 0)}%

MENSAJE: ${historial.mensaje}

FECHA: ${new Date(historial.fecha).toLocaleString('es-CO')}
        `;
        alert(detalles);
    };

    const historialesFiltrados = historiales.filter(h => {
        if (filtroEstado === 'todos') return true;
        return h.estado === filtroEstado;
    });

    return (
        <section style={{
            padding: '20px',
            background: '#f9fafb',
            borderRadius: '8px',
            marginTop: '2rem'
        }}>
            <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '1.5rem',
                flexWrap: 'wrap',
                gap: '1rem'
            }}>
                <h3 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>
                    📋 Historial de Procesamientos RUES
                </h3>

                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <select
                        value={filtroEstado}
                        onChange={e => setFiltroEstado(e.target.value)}
                        style={{
                            padding: '8px 12px',
                            border: '1px solid #d1d5db',
                            borderRadius: '6px',
                            fontSize: '14px',
                            cursor: 'pointer'
                        }}
                    >
                        <option value="todos">Todos los estados</option>
                        <option value="processing">En procesamiento</option>
                        <option value="completed">Completados</option>
                        <option value="failed">Fallidos</option>
                        <option value="no_data">Sin datos</option>
                    </select>

                    <button
                        onClick={cargarHistorial}
                        disabled={loading}
                        style={{
                            padding: '8px 16px',
                            background: '#3b82f6',
                            color: 'white',
                            border: 'none',
                            borderRadius: '6px',
                            cursor: loading ? 'not-allowed' : 'pointer',
                            fontSize: '14px',
                            fontWeight: 600,
                            opacity: loading ? 0.6 : 1
                        }}
                    >
                        {loading ? '⏳ Cargando...' : '🔄 Actualizar'}
                    </button>
                </div>
            </div>

            {error && (
                <div style={{
                    padding: '12px',
                    background: '#fee2e2',
                    color: '#991b1b',
                    borderRadius: '6px',
                    marginBottom: '1rem',
                    border: '1px solid #fecaca'
                }}>
                    ❌ {error}
                </div>
            )}

            {loading && !historiales.length ? (
                <div style={{
                    textAlign: 'center',
                    padding: '40px',
                    color: '#6b7280'
                }}>
                    <div style={{ fontSize: 32, marginBottom: '10px' }}>⏳</div>
                    <p>Cargando historial...</p>
                </div>
            ) : historialesFiltrados.length === 0 ? (
                <div style={{
                    textAlign: 'center',
                    padding: '40px',
                    color: '#6b7280'
                }}>
                    <div style={{ fontSize: 32, marginBottom: '10px' }}>📭</div>
                    <p>
                        {historiales.length === 0
                            ? 'No hay procesamientos todavía'
                            : `No hay procesamientos con estado "${filtroEstado}"`}
                    </p>
                </div>
            ) : (
                <div style={{
                    background: 'white',
                    borderRadius: '8px',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                    overflowX: 'auto'
                }}>
                    <table style={{
                        width: '100%',
                        borderCollapse: 'collapse',
                        minWidth: '100%'
                    }}>
                        <thead>
                            <tr style={{
                                background: '#f3f4f6',
                                borderBottom: '2px solid #e5e7eb'
                            }}>
                                <th style={{
                                    padding: '10px 8px',
                                    textAlign: 'left',
                                    fontWeight: 600,
                                    fontSize: '13px',
                                    color: '#374151'
                                }}>Archivo</th>
                                <th style={{
                                    padding: '10px 8px',
                                    textAlign: 'left',
                                    fontWeight: 600,
                                    fontSize: '13px',
                                    color: '#374151'
                                }}>Depto(s)</th>
                                <th style={{
                                    padding: '10px 8px',
                                    textAlign: 'left',
                                    fontWeight: 600,
                                    fontSize: '13px',
                                    color: '#374151'
                                }}>Municipio(s)</th>
                                <th style={{
                                    padding: '10px 8px',
                                    textAlign: 'left',
                                    fontWeight: 600,
                                    fontSize: '13px',
                                    color: '#374151'
                                }}>Estado</th>
                                <th style={{
                                    padding: '10px 8px',
                                    textAlign: 'left',
                                    fontWeight: 600,
                                    fontSize: '13px',
                                    color: '#374151'
                                }}>Progreso</th>
                                <th style={{
                                    padding: '10px 8px',
                                    textAlign: 'left',
                                    fontWeight: 600,
                                    fontSize: '13px',
                                    color: '#374151',
                                    minWidth: '120px'
                                }}>Fecha</th>
                                <th style={{
                                    padding: '10px 8px',
                                    textAlign: 'center',
                                    fontWeight: 600,
                                    fontSize: '13px',
                                    color: '#374151',
                                    minWidth: '140px'
                                }}>Info</th>
                            </tr>
                        </thead>
                        <tbody>
                            {historialesFiltrados.map((h) => {
                                const progreso = calcularProgreso(h.procesados || 0, h.total || 0);
                                const color = obtenerColorEstado(h.estado);

                                return (
                                    <tr key={h.file_id} style={{
                                        borderBottom: '1px solid #e5e7eb',
                                        transition: 'background 0.2s'
                                    }} onMouseEnter={e => e.currentTarget.style.background = '#f9fafb'} onMouseLeave={e => e.currentTarget.style.background = 'white'}>
                                        <td style={{ padding: '10px 8px', fontSize: '13px' }}>
                                            <strong>{h.archivo}</strong>
                                        </td>
                                        <td style={{ padding: '10px 8px', fontSize: '13px' }}>
                                            {h.departamentos || '—'}
                                        </td>
                                        <td style={{ padding: '10px 8px', fontSize: '13px' }}>
                                            {h.municipios || '—'}
                                        </td>
                                        <td style={{
                                            padding: '10px 8px',
                                            fontSize: '13px',
                                            fontWeight: 600,
                                            color
                                        }}>
                                            {obtenerTextoEstado(h.estado)}
                                        </td>
                                        <td style={{ padding: '10px 8px' }}>
                                            <div style={{
                                                marginBottom: '3px'
                                            }}>
                                                <div style={{
                                                    background: '#e5e7eb',
                                                    borderRadius: '4px',
                                                    height: '18px',
                                                    overflow: 'hidden',
                                                    position: 'relative'
                                                }}>
                                                    <div style={{
                                                        background: color,
                                                        width: `${h.estado === 'completed' ? 100 : progreso}%`,
                                                        height: '100%',
                                                        transition: 'width 0.3s ease',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        color: 'white',
                                                        fontSize: '10px',
                                                        fontWeight: 'bold'
                                                    }}>
                                                        {h.estado === 'completed' ? '100%' : (progreso > 15 && `${progreso}%`)}
                                                    </div>
                                                </div>
                                            </div>
                                            <small style={{
                                                color: '#6b7280',
                                                fontSize: '11px'
                                            }}>
                                                {h.procesados || 0}/{h.total || 0}
                                            </small>
                                        </td>
                                        <td style={{
                                            padding: '10px 8px',
                                            fontSize: '11px',
                                            color: '#6b7280',
                                            whiteSpace: 'nowrap'
                                        }}>
                                            {new Date(h.fecha).toLocaleString('es-CO', {
                                                year: 'numeric',
                                                month: '2-digit',
                                                day: '2-digit',
                                                hour: '2-digit',
                                                minute: '2-digit'
                                            })}
                                        </td>
                                        <td style={{
                                            padding: '10px 8px',
                                            textAlign: 'center'
                                        }}>
                                            <button
                                                onClick={() => verDetalles(h)}
                                                style={{
                                                    background: '#e5e7eb',
                                                    color: '#374151',
                                                    border: 'none',
                                                    padding: '5px 10px',
                                                    borderRadius: '4px',
                                                    cursor: 'pointer',
                                                    fontSize: '12px',
                                                    fontWeight: '500',
                                                    transition: 'background 0.2s',
                                                    whiteSpace: 'nowrap'
                                                }}
                                                onMouseEnter={e => e.target.style.background = '#d1d5db'}
                                                onMouseLeave={e => e.target.style.background = '#e5e7eb'}
                                                title="Ver detalles"
                                            >
                                                ℹ️
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            <div style={{
                marginTop: '1rem',
                padding: '12px',
                background: '#dbeafe',
                borderRadius: '6px',
                fontSize: '13px',
                color: '#1e40af'
            }}>
                💡 Total de procesamientos: <strong>{historiales.length}</strong> | Mostrados: <strong>{historialesFiltrados.length}</strong>
            </div>
        </section>
    );
}
