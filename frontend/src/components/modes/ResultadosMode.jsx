import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import * as XLSX from 'xlsx';

const API = import.meta.env.VITE_SYNC_API_URL || 'http://127.0.0.1:8001';

function MiniTablaContactos({ contactos }) {
    if (!contactos || contactos.length === 0) {
        return <span>—</span>;
    }

    const abrirWhatsApp = (numero) => {
        if (!numero) return;
        const numeroLimpio = numero.replace(/\D/g, '');
        const url = `https://wa.me/${numeroLimpio}`;
        window.open(url, '_blank');
    };

    return (
        <div style={{
            maxWidth: '280px',
            maxHeight: '180px',
            overflow: 'auto',
            border: '1px solid #e5e7eb',
            borderRadius: '6px',
            backgroundColor: '#f9fafb'
        }}>
            <table style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: '9px'
            }}>
                <thead>
                    <tr style={{
                        background: '#C4D600',
                        borderBottom: '1px solid #d1d5db'
                    }}>
                        <th style={{
                            padding: '4px 6px',
                            textAlign: 'left',
                            fontWeight: 600,
                            fontSize: '9px',
                            color: '#374151'
                        }}>Nombre</th>
                        <th style={{
                            padding: '4px 6px',
                            textAlign: 'left',
                            fontWeight: 600,
                            fontSize: '9px',
                            color: '#374151'
                        }}>WhatsApp</th>
                    </tr>
                </thead>
                <tbody>
                    {contactos.map((c, idx) => (
                        <tr key={idx} style={{
                            borderBottom: idx < contactos.length - 1 ? '1px solid #e5e7eb' : 'none'
                        }}>
                            <td style={{
                                padding: '4px 6px',
                                fontSize: '9px',
                                color: '#374151',
                                maxWidth: '120px',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap'
                            }}>
                                {c.nombre_completo}
                            </td>
                            <td style={{
                                padding: '4px 6px',
                                fontSize: '9px',
                                fontFamily: 'monospace'
                            }}>
                                {c.movil ? (
                                    <a
                                        href={`https://wa.me/${c.movil.replace(/\D/g, '')}`}
                                        target="_blank"
                                        rel="noreferrer"
                                        style={{
                                            color: '#25D366',
                                            textDecoration: 'none',
                                            fontWeight: 600,
                                            cursor: 'pointer'
                                        }}
                                        onClick={(e) => {
                                            e.preventDefault();
                                            abrirWhatsApp(c.movil);
                                        }}
                                        title="Abrir en WhatsApp"
                                    >
                                        📱 {c.movil}
                                    </a>
                                ) : (
                                    <span>—</span>
                                )}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function CeldaTruncada({ valor, esLargo }) {
    const [mostrarTooltip, setMostrarTooltip] = useState(false);
    const [posTooltip, setPosTooltip] = useState({ top: 0, left: 0 });
    const refElemento = useRef(null);
    const refTooltip = useRef(null);

    const manejarEnter = () => {
        if (refElemento.current) {
            const rect = refElemento.current.getBoundingClientRect();
            setPosTooltip({
                top: rect.top - 12,
                left: rect.left
            });
        }
        setMostrarTooltip(true);
    };

    if (!esLargo) {
        return <span>{valor ?? '—'}</span>;
    }

    return (
        <span
            ref={refElemento}
            className="resultados-celda-truncada"
            onMouseEnter={manejarEnter}
            onMouseLeave={() => setMostrarTooltip(false)}
        >
            <span className="resultados-celda-truncada-texto">{valor}</span>
            {mostrarTooltip && (
                <div
                    ref={refTooltip}
                    className="resultados-tooltip"
                    style={{
                        opacity: 1,
                        top: `${posTooltip.top}px`,
                        left: `${posTooltip.left}px`
                    }}
                >
                    {valor}
                </div>
            )}
        </span>
    );
}

const CAT = {
    CLIENTE_ARGOS: { color: '#4CAF50', label: 'Cliente Argos' },
    CLIENTE_MIXTO: { color: '#2196F3', label: 'Cliente Mixto' },
    COMPETENCIA:   { color: '#F44336', label: 'Competencia'   },
    SIN_MARCA:     { color: '#FF9800', label: 'Sin marca'     },
    PROSPECTO:     { color: '#9E9E9E', label: 'Prospecto'     },
    SIN_ANALISIS:  { color: '#607D8B', label: 'Sin análisis'  },
};

const FILTROS_INIT = {
    departamento:    null,
    municipio:       null,
    categorias:      [],
    vende_cemento:   null,
    vende_tubos:     null,
    vende_varillas:  null,
    vende_ladrillos: null,
    vende_agregados: null,
};

function buildParams(f, extras = {}) {
    const p = new URLSearchParams();
    if (f.departamento)    p.set('departamento', f.departamento);
    if (f.municipio)       p.set('municipio',    f.municipio);
    if (f.vende_cemento)   p.set('vende_cemento',   'true');
    if (f.vende_tubos)     p.set('vende_tubos',     'true');
    if (f.vende_varillas)  p.set('vende_varillas',  'true');
    if (f.vende_ladrillos) p.set('vende_ladrillos', 'true');
    if (f.vende_agregados) p.set('vende_agregados', 'true');
    Object.entries(extras).forEach(([k, v]) => p.set(k, v));
    return p;
}

export default function ResultadosMode() {
    const [opts,      setOpts]      = useState({ departamentos: [], municipios: [] });
    const [resumen,   setResumen]   = useState(null);
    const [negocios,  setNegocios]  = useState([]);
    const [total,     setTotal]     = useState(0);
    const [filtros,   setFiltros]   = useState(FILTROS_INIT);
    const [pendiente, setPendiente] = useState(FILTROS_INIT);
    const [cargando,  setCargando]  = useState(false);

    // Sorting
    const [ordenPor, setOrdenPor] = useState('ID');
    const [ordenDir, setOrdenDir] = useState('asc');
    const [filtroTexto, setFiltroTexto] = useState('');

    const fetchResumen = useCallback(async (f) => {
        const p = buildParams(f);
        try {
            const res  = await fetch(`${API}/mapa/resumen?${p}`);
            setResumen(await res.json());
        } catch (e) { console.error(e); }
    }, []);

    const fetchNegocios = useCallback(async (f) => {
        setCargando(true);
        try {
            if (f.categorias.length > 1) {
                const all = await Promise.all(f.categorias.map(cat => {
                    const p = buildParams(f, { categoria_mapa: cat, limite: 2000 });
                    console.log('📊 Fetch negocios (múltiples categorías):', `${API}/mapa/negocios?${p}`);
                    return fetch(`${API}/mapa/negocios?${p}`).then(r => r.json());
                }));
                const merged = [...new Map(all.flatMap(r => r.negocios || []).map(n => [n.ID, n])).values()];
                setNegocios(merged);
                setTotal(all.reduce((acc, r) => acc + (r.total || 0), 0));
            } else {
                const extras = { limite: 2000 };
                if (f.categorias.length === 1) extras.categoria_mapa = f.categorias[0];
                const p   = buildParams(f, extras);
                console.log('📊 Fetch negocios:', `${API}/mapa/negocios?${p}`);
                const res = await fetch(`${API}/mapa/negocios?${p}`);
                const data = await res.json();
                console.log('📊 Respuesta negocios:', data);
                setNegocios(data.negocios || []);
                setTotal(data.total || 0);
            }
        } catch (e) { console.error('❌ Error en fetchNegocios:', e); }
        finally { setCargando(false); }
    }, []);

    // Carga inicial
    useEffect(() => {
        fetch(`${API}/mapa/filtros`)
            .then(r => r.json())
            .then(d => setOpts({
                departamentos: d.departamentos || [],
                municipios: d.municipios || [],
                categorias: d.categorias || []
            }))
            .catch(console.error);
        fetchResumen(FILTROS_INIT);
        fetchNegocios(FILTROS_INIT);
    }, []);

    const aplicar = () => {
        setFiltros(pendiente);
        fetchResumen(pendiente);
        fetchNegocios(pendiente);
    };

    const limpiar = () => {
        setPendiente(FILTROS_INIT);
        setFiltros(FILTROS_INIT);
        setFiltroTexto('');
        fetchResumen(FILTROS_INIT);
        fetchNegocios(FILTROS_INIT);
    };

    // Obtener columnas dinámicamente (sin id, color_mapa, LAT, LNG para presentación)
    const columnasPresent = useMemo(() => {
        if (negocios.length === 0) return [];
        const keys = Object.keys(negocios[0]).filter(k => !['id', 'ID', 'color_mapa', 'LAT', 'LNG'].includes(k));
        return keys.map(key => ({
            key,
            label: key.replace(/_/g, ' ').replace(/([A-Z])/g, ' $1').trim().toUpperCase(),
            sortable: typeof negocios[0][key] === 'string' || typeof negocios[0][key] === 'number'
        }));
    }, [negocios]);

    // Todas las columnas para exportación (incluye LAT y LNG)
    const columnasExport = useMemo(() => {
        if (negocios.length === 0) return [];
        const keys = Object.keys(negocios[0]).filter(k => k !== 'color_mapa');
        return keys.map(key => ({
            key,
            label: key.replace(/_/g, ' ').replace(/([A-Z])/g, ' $1').trim(),
            sortable: typeof negocios[0][key] === 'string' || typeof negocios[0][key] === 'number'
        }));
    }, [negocios]);

    // Filtro de texto + sorting
    const datosFiltrados = useMemo(() => {
        let result = [...negocios];

        if (filtroTexto) {
            const q = filtroTexto.toLowerCase();
            result = result.filter(n =>
                Object.values(n).some(v =>
                    v && v.toString().toLowerCase().includes(q)
                )
            );
        }

        result.sort((a, b) => {
            const valA = a[ordenPor] ?? '';
            const valB = b[ordenPor] ?? '';
            const cmp = typeof valA === 'string'
                ? valA.localeCompare(valB, 'es')
                : Number(valA) - Number(valB);
            return ordenDir === 'asc' ? cmp : -cmp;
        });

        return result;
    }, [negocios, filtroTexto, ordenPor, ordenDir]);

    // Exportar a Excel XLSX — incluye LAT, LNG pero no color_mapa
    const exportarExcel = () => {
        if (datosFiltrados.length === 0) {
            alert('No hay datos para exportar');
            return;
        }

        const datos = datosFiltrados.map(n =>
            columnasExport.reduce((obj, col) => {
                const val = n[col.key];
                if (typeof val === 'boolean') {
                    obj[col.label] = val ? 'Sí' : 'No';
                } else if (Array.isArray(val)) {
                    if (val.length === 0) {
                        obj[col.label] = '';
                    } else if (typeof val[0] === 'object') {
                        // Para contactos: mostrar "Nombre Cel:celular, Nombre Cel:celular..."
                        if (col.key === 'contactos') {
                            obj[col.label] = val
                                .map(v => `${v.nombre_completo || v.name || 'Sin nombre'} Cel:${v.movil || 'Sin celular'}`)
                                .join(', ');
                        } else {
                            obj[col.label] = val.map(v => v.nombre_completo || v.name || JSON.stringify(v)).join('; ');
                        }
                    } else {
                        obj[col.label] = val.join('; ');
                    }
                } else if (val === null || val === undefined) {
                    obj[col.label] = '';
                } else {
                    obj[col.label] = String(val);
                }
                return obj;
            }, {})
        );

        const ws = XLSX.utils.json_to_sheet(datos);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Resultados');

        ws['!cols'] = columnasExport.map(() => ({ width: 20 }));

        XLSX.writeFile(wb, `resultados_${new Date().toISOString().slice(0, 10)}.xlsx`);
    };

    const handleOrdenar = (columna) => {
        if (ordenPor === columna) {
            setOrdenDir(ordenDir === 'asc' ? 'desc' : 'asc');
        } else {
            setOrdenPor(columna);
            setOrdenDir('asc');
        }
    };

    return (
        <section className="card resultados-container">
            <div className="card-header">
                <span className="card-number">📊</span>
                <h2>Resultados</h2>
                <span style={{ fontSize: 12, color: '#6b7280', marginLeft: 'auto' }}>
                    {datosFiltrados.length.toLocaleString()} de {negocios.length.toLocaleString()} registros
                </span>
            </div>

            {/* Toolbar */}
            <div className="resultados-toolbar">
                <div className="resultados-busqueda">
                    <input
                        type="text"
                        placeholder="🔍 Buscar en cualquier campo..."
                        value={filtroTexto}
                        onChange={(e) => setFiltroTexto(e.target.value)}
                        className="resultados-input"
                    />
                </div>

                <div className="resultados-filtros">
                    <select
                        value={pendiente.departamento || ''}
                        onChange={(e) => setPendiente({ ...pendiente, departamento: e.target.value || null, municipio: null })}
                        className="resultados-select"
                    >
                        <option value="">Todos los departamentos</option>
                        {opts.departamentos.map(d => (
                            <option key={d} value={d}>{d}</option>
                        ))}
                    </select>

                    <select
                        value={pendiente.municipio || ''}
                        onChange={(e) => setPendiente({ ...pendiente, municipio: e.target.value || null })}
                        disabled={!pendiente.departamento}
                        className="resultados-select"
                    >
                        <option value="">Todos los municipios</option>
                        {opts.municipios
                            .filter(m => !pendiente.departamento || m.departamento === pendiente.departamento)
                            .map(m => (
                                <option key={`${m.departamento}-${m.municipio}`} value={m.municipio}>
                                    {m.municipio}
                                </option>
                            ))
                        }
                    </select>

                    <select
                        value={pendiente.categorias[0] || ''}
                        onChange={(e) => setPendiente({ ...pendiente, categorias: e.target.value ? [e.target.value] : [] })}
                        className="resultados-select"
                    >
                        <option value="">Todas las categorías</option>
                        {resumen?.categorias?.map(c => (
                            <option key={c.id} value={c.id}>
                                {CAT[c.id]?.label || c.id} ({c.conteo})
                            </option>
                        ))}
                    </select>

                    <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '16px', alignItems: 'center', paddingTop: '8px', flexWrap: 'wrap' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '14px' }}>
                            <input type="checkbox" checked={pendiente.vende_cemento} onChange={(e) => setPendiente({ ...pendiente, vende_cemento: e.target.checked })} />
                            🏗️ Cemento
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '14px' }}>
                            <input type="checkbox" checked={pendiente.vende_tubos} onChange={(e) => setPendiente({ ...pendiente, vende_tubos: e.target.checked })} />
                            🔧 Tubos
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '14px' }}>
                            <input type="checkbox" checked={pendiente.vende_varillas} onChange={(e) => setPendiente({ ...pendiente, vende_varillas: e.target.checked })} />
                            📍 Varillas
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '14px' }}>
                            <input type="checkbox" checked={pendiente.vende_ladrillos} onChange={(e) => setPendiente({ ...pendiente, vende_ladrillos: e.target.checked })} />
                            🧱 Ladrillos
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '14px' }}>
                            <input type="checkbox" checked={pendiente.vende_agregados} onChange={(e) => setPendiente({ ...pendiente, vende_agregados: e.target.checked })} />
                            ⛱️ Agregados
                        </label>
                    </div>

                    <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '12px', marginTop: '12px' }}>
                        <button
                            onClick={aplicar}
                            style={{
                                background: '#C4D600',
                                color: '#1f2937',
                                border: 'none',
                                padding: '8px 16px',
                                borderRadius: '6px',
                                fontWeight: 600,
                                cursor: 'pointer',
                                whiteSpace: 'nowrap',
                                fontSize: '14px',
                                transition: 'all 0.2s',
                                boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
                            }}
                            onMouseEnter={(e) => {
                                e.target.style.background = '#B8C700';
                                e.target.style.boxShadow = '0 2px 6px rgba(0,0,0,0.15)';
                            }}
                            onMouseLeave={(e) => {
                                e.target.style.background = '#C4D600';
                                e.target.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
                            }}
                        >
                            ✓ Aplicar
                        </button>

                        <button onClick={limpiar} className="btn-secondary" style={{ whiteSpace: 'nowrap' }}>
                            🔄 Limpiar
                        </button>

                        <button onClick={exportarExcel} className="btn-primary" style={{ whiteSpace: 'nowrap' }}>
                            📊 Exportar Excel
                        </button>
                    </div>
                </div>
            </div>

            {/* Tabla */}
            <div className="resultados-tabla-wrapper">
                {cargando && negocios.length === 0 ? (
                    <div style={{ padding: '2rem', textAlign: 'center', color: '#9ca3af' }}>⏳ Cargando datos...</div>
                ) : negocios.length === 0 ? (
                    <div style={{ padding: '2rem', textAlign: 'center', color: '#9ca3af' }}>No hay datos</div>
                ) : (
                    <table className="resultados-tabla">
                        <thead>
                            <tr>
                                {columnasPresent.map(col => (
                                    <th
                                        key={col.key}
                                        onClick={() => col.sortable && handleOrdenar(col.key)}
                                        title={col.label}
                                        style={{
                                            cursor: col.sortable ? 'pointer' : 'default',
                                            userSelect: 'none'
                                        }}
                                    >
                                        <span style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'space-between' }}>
                                            <span style={{ flex: 1 }}>{col.label}</span>
                                            {col.sortable && ordenPor === col.key && (
                                                <span style={{ fontSize: '11px', marginLeft: '4px' }}>{ordenDir === 'asc' ? '↑' : '↓'}</span>
                                            )}
                                        </span>
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {datosFiltrados.map((negocio, idx) => (
                                <tr key={negocio.ID || idx} className={idx % 2 === 0 ? 'resultados-row-par' : ''}>
                                    {columnasPresent.map(col => {
                                        const valor = negocio[col.key];
                                        const esLargo = typeof valor === 'string' && valor.length > 50;

                                        return (
                                            <td
                                                key={col.key}
                                                className={esLargo ? 'resultados-celda--largo' : ''}
                                            >
                                                {col.key === 'categoria_mapa' ? (
                                                    <span
                                                        style={{
                                                            display: 'inline-block',
                                                            padding: '4px 8px',
                                                            borderRadius: 4,
                                                            background: `${CAT[valor]?.color || '#999'}15`,
                                                            color: CAT[valor]?.color || '#999',
                                                            fontSize: 12,
                                                            fontWeight: 600,
                                                        }}
                                                    >
                                                        {CAT[valor]?.label || valor}
                                                    </span>
                                                ) : col.key === 'URL_GOOGLE' && valor ? (
                                                    <a
                                                        href={valor}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        style={{
                                                            color: '#0046B2',
                                                            textDecoration: 'none',
                                                            fontWeight: 500,
                                                            fontSize: 12
                                                        }}
                                                        onMouseEnter={(e) => e.target.style.textDecoration = 'underline'}
                                                        onMouseLeave={(e) => e.target.style.textDecoration = 'none'}
                                                    >
                                                        🔗 Ver en Google Maps
                                                    </a>
                                                ) : Array.isArray(valor) ? (
                                                    col.key === 'contactos' ? (
                                                        <MiniTablaContactos contactos={valor} />
                                                    ) : (
                                                        <CeldaTruncada
                                                            valor={
                                                                valor.length === 0
                                                                    ? '—'
                                                                    : typeof valor[0] === 'object'
                                                                        ? valor.map(v => v.nombre_completo || v.name || JSON.stringify(v)).join('; ')
                                                                        : valor.join('; ')
                                                            }
                                                            esLargo={valor.length > 0 && (typeof valor[0] === 'object'
                                                                ? valor.map(v => v.nombre_completo || v.name || '').join('; ').length > 50
                                                                : valor.join('; ').length > 50)}
                                                        />
                                                    )
                                                ) : typeof valor === 'boolean' ? (
                                                    <span style={{ color: valor ? '#4CAF50' : '#d1d5db', fontWeight: 600 }}>
                                                        {valor ? '✓' : '✕'}
                                                    </span>
                                                ) : (
                                                    <CeldaTruncada valor={valor} esLargo={esLargo} />
                                                )}
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}

                {datosFiltrados.length === 0 && negocios.length > 0 && !cargando && (
                    <div style={{ padding: '2rem', textAlign: 'center', color: '#9ca3af' }}>
                        No hay registros que coincidan con los filtros
                    </div>
                )}
            </div>
        </section>
    );
}
