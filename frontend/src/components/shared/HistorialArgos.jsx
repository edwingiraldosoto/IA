import { useEffect, useState, useRef } from 'react';

const ARGOS_API_URL = import.meta.env.VITE_ARGOS_API_URL || 'http://localhost:8001';

export default function HistorialArgos({ onReprocesar }) {
    const [historiales, setHistoriales] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [filtroEstado, setFiltroEstado] = useState('todos'); // todos, completed, processing, failed
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
        const historialesEnProceso = historiales.filter(h => h.status === 'processing');

        historialesEnProceso.forEach((h) => {
            const id = setInterval(async () => {
                try {
                    const response = await fetch(`${ARGOS_API_URL}/estado-argos/${h.file_id}`);
                    if (response.ok) {
                        const estado = await response.json();
                        setHistoriales(prev => prev.map(item =>
                            item.file_id === h.file_id
                                ? {
                                    ...item,
                                    status: estado.estado,
                                    REGISTROS_PROCESADOS: estado.registros.procesados || 0,
                                    TOTAL_REGISTROS: estado.registros.total || item.TOTAL_REGISTROS,
                                    MENSAJE: estado.mensaje || item.MENSAJE,
                                    FECHA_ACTUALIZACION: new Date().toISOString()
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
            const response = await fetch(`${ARGOS_API_URL}/historial-argos`);

            if (!response.ok) {
                throw new Error(`Error ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            const historialesList = Array.isArray(data) ? data : data.historiales || [];

            // Mapear nombres de propiedades del backend al frontend
            const historialesMapeados = historialesList.map(h => ({
                file_id: h.file_id,
                archivo: h.filename,
                status: h.status,
                FECHA_ACTUALIZACION: h.FECHA_ACTUALIZACION,
                TOTAL_REGISTROS: h.TOTAL_REGISTROS || 0,
                REGISTROS_PROCESADOS: h.REGISTROS_PROCESADOS || 0,
                DEPARTAMENTOS: h.DEPARTAMENTOS,
                MUNICIPIOS: h.MUNICIPIOS,
                MENSAJE: h.MENSAJE
            }));

            const ordenados = [...historialesMapeados].sort(
                (a, b) => new Date(b.FECHA_ACTUALIZACION) - new Date(a.FECHA_ACTUALIZACION)
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
                return '#10b981'; // verde
            case 'processing':
                return '#3b82f6'; // azul
            case 'failed':
                return '#ef4444'; // rojo
            case 'no_data':
                return '#f59e0b'; // naranja
            default:
                return '#6b7280'; // gris
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
                return '📭 Procesado sin datos';
            default:
                return '⏳ Desconocido';
        }
    };

    const verDetalles = (historial) => {
        const detalles = `
📋 DETALLES DEL PROCESAMIENTO

Archivo: ${historial.filename}
ID: ${historial.file_id}

FILTROS APLICADOS:
  • Departamentos: ${historial.DEPARTAMENTOS?.join(', ') || 'Todos'}
  • Municipios: ${historial.MUNICIPIOS?.join(', ') || 'Todos'}

ESTADO: ${obtenerTextoEstado(historial.status)}
Registros procesados: ${historial.REGISTROS_PROCESADOS}/${historial.TOTAL_REGISTROS}
Progreso: ${calcularProgreso(historial.REGISTROS_PROCESADOS, historial.TOTAL_REGISTROS)}%

MENSAJE: ${historial.MENSAJE}

FECHAS:
  • Inicio: ${new Date(historial.fecha_upload).toLocaleString('es-CO')}
  • Última actualización: ${new Date(historial.FECHA_ACTUALIZACION).toLocaleString('es-CO')}
        `;
        alert(detalles);
    };

    const handleReprocesar = (historial) => {
        if (onReprocesar) {
            onReprocesar({
                filename: historial.filename,
                departamentos: historial.DEPARTAMENTOS || [],
                municipios: historial.MUNICIPIOS || []
            });
        }
    };

    const historialesFiltrados = historiales.filter(h => {
        if (filtroEstado === 'todos') return true;
        return h.status === filtroEstado;
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
                    📋 Historial de Procesamientos ARGOS
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
                    overflowX: 'auto',
                    background: 'white',
                    borderRadius: '8px',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
                }}>
                    <table style={{
                        width: '100%',
                        borderCollapse: 'collapse'
                    }}>
                        <thead>
                            <tr style={{
                                background: '#f3f4f6',
                                borderBottom: '2px solid #e5e7eb'
                            }}>
                                <th style={{
                                    padding: '12px',
                                    textAlign: 'left',
                                    fontWeight: 600,
                                    fontSize: '14px',
                                    color: '#374151'
                                }}>Archivo</th>
                                <th style={{
                                    padding: '12px',
                                    textAlign: 'left',
                                    fontWeight: 600,
                                    fontSize: '14px',
                                    color: '#374151'
                                }}>Departamento(s)</th>
                                <th style={{
                                    padding: '12px',
                                    textAlign: 'left',
                                    fontWeight: 600,
                                    fontSize: '14px',
                                    color: '#374151'
                                }}>Municipio(s)</th>
                                <th style={{
                                    padding: '12px',
                                    textAlign: 'left',
                                    fontWeight: 600,
                                    fontSize: '14px',
                                    color: '#374151'
                                }}>Estado</th>
                                <th style={{
                                    padding: '12px',
                                    textAlign: 'left',
                                    fontWeight: 600,
                                    fontSize: '14px',
                                    color: '#374151'
                                }}>Progreso</th>
                                <th style={{
                                    padding: '12px',
                                    textAlign: 'left',
                                    fontWeight: 600,
                                    fontSize: '14px',
                                    color: '#374151',
                                    minWidth: '140px'
                                }}>Fecha</th>
                                <th style={{
                                    padding: '12px',
                                    textAlign: 'center',
                                    fontWeight: 600,
                                    fontSize: '14px',
                                    color: '#374151',
                                    minWidth: '200px'
                                }}>Información</th>
                            </tr>
                        </thead>
                        <tbody>
                            {historialesFiltrados.map((h) => {
                                const progreso = calcularProgreso(h.REGISTROS_PROCESADOS, h.TOTAL_REGISTROS);
                                const color = obtenerColorEstado(h.status);

                                return (
                                    <tr key={h.file_id} style={{
                                        borderBottom: '1px solid #e5e7eb',
                                        transition: 'background 0.2s'
                                    }} onMouseEnter={e => e.currentTarget.style.background = '#f9fafb'} onMouseLeave={e => e.currentTarget.style.background = 'white'}>
                                        <td style={{ padding: '12px', fontSize: '14px' }}>
                                            <strong>{h.filename}</strong>
                                        </td>
                                        <td style={{ padding: '12px', fontSize: '14px' }}>
                                            {h.DEPARTAMENTOS?.join(', ') || '—'}
                                        </td>
                                        <td style={{ padding: '12px', fontSize: '14px' }}>
                                            {h.MUNICIPIOS?.join(', ') || '—'}
                                        </td>
                                        <td style={{
                                            padding: '12px',
                                            fontSize: '14px',
                                            fontWeight: 600,
                                            color
                                        }}>
                                            {obtenerTextoEstado(h.status)}
                                        </td>
                                        <td style={{ padding: '12px' }}>
                                            <div style={{
                                                marginBottom: '4px'
                                            }}>
                                                <div style={{
                                                    background: '#e5e7eb',
                                                    borderRadius: '4px',
                                                    height: '20px',
                                                    overflow: 'hidden',
                                                    position: 'relative'
                                                }}>
                                                    <div style={{
                                                        background: color,
                                                        width: `${h.status === 'completed' ? 100 : progreso}%`,
                                                        height: '100%',
                                                        transition: 'width 0.3s ease',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        color: 'white',
                                                        fontSize: '11px',
                                                        fontWeight: 'bold'
                                                    }}>
                                                        {h.status === 'completed' ? '100%' : (progreso > 15 && `${progreso}%`)}
                                                    </div>
                                                </div>
                                            </div>
                                            <small style={{
                                                color: '#6b7280',
                                                fontSize: '12px'
                                            }}>
                                                {h.REGISTROS_PROCESADOS}/{h.TOTAL_REGISTROS}
                                            </small>
                                        </td>
                                        <td style={{
                                            padding: '12px',
                                            fontSize: '12px',
                                            color: '#6b7280',
                                            whiteSpace: 'nowrap'
                                        }}>
                                            {new Date(h.FECHA_ACTUALIZACION).toLocaleString('es-CO', {
                                                year: 'numeric',
                                                month: '2-digit',
                                                day: '2-digit',
                                                hour: '2-digit',
                                                minute: '2-digit'
                                            })}
                                        </td>
                                        <td style={{
                                            padding: '12px',
                                            textAlign: 'center'
                                        }}>
                                            <button
                                                onClick={() => verDetalles(h)}
                                                style={{
                                                    background: '#e5e7eb',
                                                    color: '#374151',
                                                    border: 'none',
                                                    padding: '6px 12px',
                                                    borderRadius: '4px',
                                                    cursor: 'pointer',
                                                    fontSize: '13px',
                                                    fontWeight: '500',
                                                    transition: 'background 0.2s',
                                                    whiteSpace: 'nowrap'
                                                }}
                                                onMouseEnter={e => e.target.style.background = '#d1d5db'}
                                                onMouseLeave={e => e.target.style.background = '#e5e7eb'}
                                                title="Ver detalles completos"
                                            >
                                                ℹ️ Detalle
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
