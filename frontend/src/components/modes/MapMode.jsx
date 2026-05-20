import { useState, useEffect, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Tooltip, Popup, useMap } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './MapMode.css';

const API           = import.meta.env.VITE_SYNC_API_URL || 'http://127.0.0.1:8001';
const COLOMBIA      = [4.5709, -74.2973];
const ZOOM_INICIAL  = 6;

function calcularTamanoIcono(zoom) {
    const tamaños = {
        4: 16,
        5: 16,
        6: 16,   // zoom inicial
        7: 18,
        8: 20,
        9: 22,
        10: 24,
        11: 26,
        12: 28,
        13: 32,
        14: 36,
        15: 40,
        16: 45,
    };
    return tamaños[Math.floor(zoom)] || 16;
}

const CAT = {
    CLIENTE_ARGOS: { color: '#39FF14', label: 'Cliente Argos' },
    CLIENTE_MIXTO: { color: '#2196F3', label: 'Cliente Mixto' },
    COMPETENCIA:   { color: '#F44336', label: 'Competencia'   },
    SIN_MARCA:     { color: '#FF9800', label: 'Sin marca'     },
    PROSPECTO:     { color: '#FFE135', label: 'Prospecto'     },
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

// ─── helpers ──────────────────────────────────────────────────────────────────

function pinIcon(color, size) {
    const half = Math.round(size / 2);
    const border = Math.max(2, Math.round(size * 0.125));
    return L.divIcon({
        className: '',
        html: `<div style="
            width:${size}px;height:${size}px;border-radius:50%;
            background:${color};border:${border}px solid white;
            box-shadow:0 2px 6px rgba(0,0,0,0.6);cursor:pointer
        "></div>`,
        iconSize:   [size, size],
        iconAnchor: [half, half],
        popupAnchor:[0, Math.round(-size * 0.5)],
    });
}

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

// ─── sub-componentes internos al mapa ─────────────────────────────────────────

function FitBounds({ negocios, trigger }) {
    const map = useMap();
    useEffect(() => {
        if (!trigger || negocios.length === 0) return;
        const latlngs = negocios.filter(n => n.lat && n.lng).map(n => [n.lat, n.lng]);
        if (latlngs.length > 0) map.fitBounds(latlngs, { padding: [50, 50], maxZoom: 13 });
    }, [trigger]);
    return null;
}

function MarcadoresConZoom({ negocios, CAT, onDetalle, setDetalleId }) {
    const map = useMap();
    const [zoom, setZoom] = useState(ZOOM_INICIAL);

    useEffect(() => {
        const handleZoom = () => setZoom(map.getZoom());
        map.on('zoom', handleZoom);
        return () => map.off('zoom', handleZoom);
    }, [map]);

    const tamaño = calcularTamanoIcono(zoom);

    return (
        <>
            {/* Sin clustering - mostrar todos los puntos como mapa de calor */}
            {negocios.map(n => {
                const catColor = CAT[n.categoria_mapa]?.color || n.color_mapa || '#9E9E9E';
                const catLabel = CAT[n.categoria_mapa]?.label || n.categoria_mapa || '';
                return (
                    <Marker
                        key={n.id}
                        position={[n.lat, n.lng]}
                        icon={pinIcon(catColor, tamaño)}
                        eventHandlers={{ popupclose: () => setDetalleId(null) }}
                    >
                        <Tooltip
                            direction="top"
                            offset={[0, -8]}
                            opacity={1}
                            className="mapa-tooltip-simple"
                        >
                            <div className="mapa-tooltip-preview">
                                <span className="mapa-tooltip-dot" style={{ background: catColor }} />
                                <div>
                                    <div className="mapa-tooltip-nombre">{n.nombre}</div>
                                    <div className="mapa-tooltip-cat">{catLabel}</div>
                                </div>
                            </div>
                        </Tooltip>

                        <Popup
                            className="mapa-popup-card"
                            maxWidth={270}
                            minWidth={265}
                            closeButton={true}
                            autoPan={true}
                        >
                            <TarjetaNegocio negocio={n} onDetalle={onDetalle} />
                        </Popup>
                    </Marker>
                );
            })}
        </>
    );
}

// ─── ResumenCards ─────────────────────────────────────────────────────────────

function ResumenCards({ resumen, activas, onToggle }) {
    if (!resumen) return null;
    return (
        <div className="mapa-cards">
            {resumen.categorias.map(cat => {
                const meta   = CAT[cat.id] || {};
                const activa = activas.includes(cat.id);
                return (
                    <button
                        key={cat.id}
                        className={`mapa-card ${activa ? 'mapa-card--activa' : ''}`}
                        style={{ '--cat-color': meta.color || cat.color }}
                        onClick={() => onToggle(cat.id)}
                        title={cat.descripcion}
                    >
                        <span className="mapa-card-dot" />
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                            <span className="mapa-card-num">{cat.conteo.toLocaleString()}</span>
                            <span className="mapa-card-label">{meta.label || cat.id}</span>
                        </div>
                    </button>
                );
            })}
            <div className="mapa-card mapa-card--total">
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                    <span className="mapa-card-num">{resumen.total.toLocaleString()}</span>
                    <span className="mapa-card-label">Total</span>
                </div>
            </div>
        </div>
    );
}

// ─── FiltrosPanel ─────────────────────────────────────────────────────────────

function normalizarNombre(nombre) {
    return nombre
        .toLowerCase()
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

function ordenarOpciones(items, extractor = item => item) {
    return [...items].sort((a, b) =>
        extractor(a).localeCompare(extractor(b), 'es', { numeric: true })
    );
}

function FiltrosPanel({ filtros, onChange, opts, onAplicar, onLimpiar }) {
    const munis = filtros.departamento
        ? (opts.municipios || []).filter(m => m.departamento === filtros.departamento)
        : (opts.municipios || []);

    const departamentosOrdenados = ordenarOpciones(opts.departamentos || []);
    const munisOrdenados = ordenarOpciones(munis, m => m.municipio);

    const toggle = campo => onChange({ ...filtros, [campo]: filtros[campo] ? null : true });

    return (
        <div className="mapa-filtros">
            <h3 className="mapa-filtros-titulo">Filtros</h3>

            <div className="mapa-filtro-grupo">
                <label>Departamento</label>
                <select
                    value={filtros.departamento || ''}
                    onChange={e => onChange({ ...filtros, departamento: e.target.value || null, municipio: null })}
                    className="select-input"
                >
                    <option value="">Todos</option>
                    {departamentosOrdenados.map(d => (
                        <option key={d} value={d}>{normalizarNombre(d)}</option>
                    ))}
                </select>
            </div>

            <div className="mapa-filtro-grupo">
                <label>Municipio</label>
                <select
                    value={filtros.municipio || ''}
                    onChange={e => onChange({ ...filtros, municipio: e.target.value || null })}
                    className="select-input"
                    disabled={munisOrdenados.length === 0}
                >
                    <option value="">Todos</option>
                    {munisOrdenados.map(m => (
                        <option key={m.municipio} value={m.municipio}>{normalizarNombre(m.municipio)}</option>
                    ))}
                </select>
            </div>

            <div className="mapa-filtro-grupo">
                <label>Productos</label>
                {[
                    ['vende_cemento',   'Cemento'],
                    ['vende_tubos',     'Tubos'],
                    ['vende_varillas',  'Varillas'],
                    ['vende_ladrillos', 'Ladrillos'],
                    ['vende_agregados', 'Agregados'],
                ].map(([campo, etiqueta]) => (
                    <label key={campo} className="mapa-checkbox">
                        <input type="checkbox" checked={!!filtros[campo]} onChange={() => toggle(campo)} />
                        {etiqueta}
                    </label>
                ))}
            </div>

            <button onClick={onAplicar} className="btn-primary-sm" style={{ width: '100%', marginBottom: 8 }}>
                Aplicar
            </button>
            <button onClick={onLimpiar} className="btn-secondary" style={{ width: '100%' }}>
                Limpiar
            </button>
        </div>
    );
}

// ─── Leyenda ──────────────────────────────────────────────────────────────────

function Leyenda() {
    return (
        <div className="mapa-leyenda">
            {Object.entries(CAT).map(([id, { color, label }]) => (
                <div key={id} className="mapa-leyenda-item">
                    <span className="mapa-leyenda-dot" style={{ background: color }} />
                    <span>{label}</span>
                </div>
            ))}
        </div>
    );
}

// ─── TarjetaNegocio (popup al hacer click en el pin) ─────────────────────────

function TarjetaNegocio({ negocio, onDetalle }) {
    const cat    = CAT[negocio.categoria_mapa] || {};
    const waNum  = negocio.whatsapp?.toString().trim() || '';
    const waLink = waNum ? `https://wa.me/57${waNum}` : null;
    const score  = negocio.score ?? 0;
    const scoreColor = score >= 70 ? '#4CAF50' : score >= 40 ? '#FF9800' : '#F44336';

    const productos = [
        [negocio.vende_cemento,   'Cemento'],
        [negocio.vende_tubos,     'Tubos'],
        [negocio.vende_varillas,  'Varillas'],
        [negocio.vende_ladrillos, 'Ladrillos'],
        [negocio.vende_agregados, 'Agregados'],
    ].filter(([v]) => v).map(([, l]) => l);

    return (
        <div className="tarjeta-negocio">
            <div className="tarjeta-stripe" style={{ background: cat.color || '#9E9E9E' }} />

            <div className="tarjeta-body">
                <div className="tarjeta-nombre">{negocio.nombre}</div>
                <div className="tarjeta-ubic">📍 {negocio.municipio}, {negocio.departamento}</div>

                <div className="tarjeta-cat"
                     style={{ background: `${cat.color}18`, borderColor: `${cat.color}60`, color: cat.color }}>
                    <span className="tarjeta-cat-dot" style={{ background: cat.color }} />
                    {cat.label || negocio.categoria_mapa}
                </div>

                {negocio.marcas_cemento?.length > 0 && (
                    <div className="tarjeta-row-chips">
                        <span className="tarjeta-row-label">Marcas:</span>
                        {negocio.marcas_cemento.map(m => (
                            <span key={m} className="tarjeta-marca">{m}</span>
                        ))}
                    </div>
                )}

                {productos.length > 0 && (
                    <div className="tarjeta-row-chips">
                        <span className="tarjeta-row-label">Vende:</span>
                        {productos.map(p => (
                            <span key={p} className="tarjeta-producto">{p}</span>
                        ))}
                    </div>
                )}

                <div className="tarjeta-divider" />

                <div className="tarjeta-score-row">
                    <span className="tarjeta-score-txt" style={{ color: scoreColor }}>Score {score}</span>
                    <div className="tarjeta-score-bar">
                        <div style={{ width: `${score}%`, background: scoreColor }} />
                    </div>
                    <span className="tarjeta-score-nivel">({negocio.nivel_confianza || '—'})</span>
                </div>

                <div className="tarjeta-contacto">
                    {negocio.telefono && (
                        <a href={`tel:${negocio.telefono}`} className="tarjeta-contacto-item">
                            📞 {negocio.telefono}
                        </a>
                    )}
                    {waLink && (
                        <a href={waLink} target="_blank" rel="noreferrer" className="tarjeta-contacto-item tarjeta-wa">
                            💬 {waNum}
                        </a>
                    )}
                    {negocio.url_google && (
                        <a href={negocio.url_google} target="_blank" rel="noreferrer" className="tarjeta-contacto-item tarjeta-gmaps">
                            🗺️ Ver en Google Maps
                        </a>
                    )}
                </div>

                <button className="tarjeta-cta" onClick={() => onDetalle(negocio.id)}>
                    Ver detalle completo →
                </button>
            </div>
        </div>
    );
}

// ─── DetalleDrawer ────────────────────────────────────────────────────────────

function DetalleDrawer({ id, onCerrar }) {
    const [datos, setDatos]     = useState(null);
    const [cargando, setCargando] = useState(true);

    useEffect(() => {
        if (!id) return;
        setCargando(true);
        setDatos(null);
        fetch(`${API}/mapa/negocios/${id}`)
            .then(r => r.json())
            .then(setDatos)
            .catch(console.error)
            .finally(() => setCargando(false));
    }, [id]);

    const cat    = datos ? (CAT[datos.categoria_mapa] || {}) : {};
    const score  = datos?.score ?? 0;
    const waNum  = datos?.whatsapp?.toString().trim() || '';
    const waLink = waNum ? `https://wa.me/57${waNum}` : null;
    const scoreColor = score >= 70 ? '#4CAF50' : score >= 40 ? '#FF9800' : '#F44336';

    return (
        <div className="mapa-drawer">
            <div className="mapa-drawer-header">
                <h3>Detalle del negocio</h3>
                <button onClick={onCerrar} className="mapa-drawer-cerrar" title="Cerrar">✕</button>
            </div>

            {cargando && <div className="empty-state" style={{ padding: '2rem' }}>Cargando...</div>}

            {!cargando && datos && (
                <div className="mapa-drawer-body">
                    <div className="mapa-drawer-nombre">{datos.nombre}</div>
                    <div className="mapa-drawer-ubic">{datos.municipio}, {datos.departamento}</div>

                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                        <div className="mapa-popup-cat" style={{ background: `${cat.color}20`, borderColor: cat.color }}>
                            <span className="mapa-popup-cat-dot" style={{ background: cat.color }} />
                            {cat.label || datos.categoria_mapa}
                        </div>
                        <span className={`mapa-fuente mapa-fuente--${(datos.fuente || '').toLowerCase()}`}>
                            {datos.fuente || '—'}
                        </span>
                    </div>

                    {/* Score */}
                    <div className="mapa-drawer-seccion">
                        <div className="mapa-drawer-label">Confianza IA</div>
                        <div className="mapa-score-row">
                            <div className="mapa-score-bar">
                                <div className="mapa-score-fill" style={{ width: `${score}%`, background: scoreColor }} />
                            </div>
                            <span style={{ color: scoreColor, fontWeight: 700, fontSize: 14 }}>{score}</span>
                            <span className="mapa-score-nivel">({datos.nivel_confianza || '—'})</span>
                        </div>
                    </div>

                    {/* Contacto */}
                    <div className="mapa-drawer-seccion">
                        <div className="mapa-drawer-label">Contacto</div>
                        {datos.direccion_comercial && <div className="mapa-drawer-row">📍 {datos.direccion_comercial}</div>}
                        {datos.telefono           && <div className="mapa-drawer-row">📞 <a href={`tel:${datos.telefono}`}>{datos.telefono}</a></div>}
                        {waLink                   && <div className="mapa-drawer-row">💬 <a href={waLink} target="_blank" rel="noreferrer">WhatsApp: {waNum}</a></div>}
                        {datos.correo_comercial   && <div className="mapa-drawer-row">✉️ {datos.correo_comercial}</div>}
                    </div>

                    {/* Redes */}
                    {(datos.sitio_web || datos.facebook || datos.instagram) && (
                        <div className="mapa-drawer-seccion">
                            <div className="mapa-drawer-label">En línea</div>
                            {datos.sitio_web  && <div className="mapa-drawer-row">🌐 <a href={datos.sitio_web}  target="_blank" rel="noreferrer">{datos.sitio_web}</a></div>}
                            {datos.facebook   && <div className="mapa-drawer-row">📘 <a href={datos.facebook}   target="_blank" rel="noreferrer">Facebook</a></div>}
                            {datos.instagram  && <div className="mapa-drawer-row">📷 <a href={datos.instagram}  target="_blank" rel="noreferrer">Instagram</a></div>}
                        </div>
                    )}

                    {/* Google Maps */}
                    {datos.url_google && (
                        <div className="mapa-drawer-seccion">
                            <a
                                href={datos.url_google}
                                target="_blank"
                                rel="noreferrer"
                                className="btn-primary-sm"
                                style={{ display: 'inline-block', textDecoration: 'none', fontSize: 12 }}
                            >
                                🗺️ Ver en Google Maps
                            </a>
                        </div>
                    )}

                    {/* Marcas de cemento */}
                    {datos.marcas_cemento?.length > 0 && (
                        <div className="mapa-drawer-seccion">
                            <div className="mapa-drawer-label">Marcas de cemento</div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                {datos.marcas_cemento.map(m => (
                                    <span key={m} className="mapa-popup-marca">{m}</span>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Productos */}
                    <div className="mapa-drawer-seccion">
                        <div className="mapa-drawer-label">Productos</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {[
                                ['vende_cemento',   'Cemento'],
                                ['vende_tubos',     'Tubos'],
                                ['vende_varillas',  'Varillas'],
                                ['vende_ladrillos', 'Ladrillos'],
                                ['vende_agregados', 'Agregados'],
                            ].filter(([campo]) => datos[campo]).map(([campo, label]) => (
                                <span key={campo} className="chip chip-active" style={{ fontSize: 12, padding: '4px 10px' }}>
                                    {label}
                                </span>
                            ))}
                        </div>
                    </div>

                    {/* Contactos del negocio */}
                    {datos.contactos && datos.contactos.length > 0 && (
                        <div className="mapa-drawer-seccion">
                            <div className="mapa-drawer-label">Contactos ({datos.contactos.length})</div>
                            <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                                <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse' }}>
                                    <thead>
                                        <tr style={{ background: '#f0f0f0', borderBottom: '1px solid #ddd' }}>
                                            <th style={{ padding: '4px 6px', textAlign: 'left', fontWeight: 600 }}>Nombre</th>
                                            <th style={{ padding: '4px 6px', textAlign: 'left', fontWeight: 600 }}>Móvil</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {datos.contactos.map((c, idx) => (
                                            <tr key={idx} style={{ borderBottom: '1px solid #eee' }}>
                                                <td style={{ padding: '4px 6px' }}>
                                                    <strong>{c.nombre_completo}</strong>
                                                    {c.cargo && <div style={{ fontSize: '11px', color: '#666' }}>{c.cargo}</div>}
                                                </td>
                                                <td style={{ padding: '4px 6px' }}>
                                                    {c.movil ? (
                                                        <a href={`https://wa.me/${c.movil.replace(/\D/g, '')}`} target="_blank" rel="noreferrer" style={{ color: '#25D366', textDecoration: 'none', fontWeight: 600 }}>
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
                        </div>
                    )}

                    {/* Materiales observados */}
                    {datos.materiales_observados && (
                        <div className="mapa-drawer-seccion">
                            <div className="mapa-drawer-label">Materiales observados (IA)</div>
                            <div className="mapa-materiales">{datos.materiales_observados}</div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ─── MapMode (componente principal) ───────────────────────────────────────────

export default function MapMode() {
    const [opts,      setOpts]      = useState({ departamentos: [], municipios: [] });
    const [resumen,   setResumen]   = useState(null);
    const [negocios,  setNegocios]  = useState([]);
    const [total,     setTotal]     = useState(0);
    const [filtros,   setFiltros]   = useState(FILTROS_INIT);
    const [pendiente, setPendiente] = useState(FILTROS_INIT);
    const [cargando,  setCargando]  = useState(false);
    const [fitTrigger, setFit]      = useState(0);
    const [detalleId, setDetalleId] = useState(null);

    const calcularResumenLocal = useCallback((negs) => {
        const conteos = {};
        let total = negs.length;

        Object.keys(CAT).forEach(catId => {
            conteos[catId] = negs.filter(n => n.categoria_mapa === catId).length;
        });

        return {
            categorias: Object.entries(conteos).map(([id, conteo]) => ({
                id,
                conteo,
                color: CAT[id]?.color,
                descripcion: CAT[id]?.label
            })),
            total
        };
    }, []);

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
                // Múltiples categorías: N fetches en paralelo
                const all = await Promise.all(f.categorias.map(cat => {
                    const p = buildParams(f, { categoria_mapa: cat, limite: 2000 });
                    return fetch(`${API}/mapa/negocios?${p}`).then(r => r.json());
                }));
                const merged = [...new Map(all.flatMap(r => r.negocios || []).map(n => [n.id, n])).values()];
                setNegocios(merged);
                setTotal(all.reduce((acc, r) => acc + (r.total || 0), 0));
                setResumen(calcularResumenLocal(merged));
            } else {
                const extras = { limite: 2000 };
                if (f.categorias.length === 1) extras.categoria_mapa = f.categorias[0];
                const p   = buildParams(f, extras);
                const res = await fetch(`${API}/mapa/negocios?${p}`);
                const data = await res.json();
                setNegocios(data.negocios || []);
                setTotal(data.total || 0);
                setResumen(calcularResumenLocal(data.negocios || []));
            }
            setFit(t => t + 1);
        } catch (e) { console.error(e); }
        finally { setCargando(false); }
    }, [calcularResumenLocal]);

    // Carga inicial
    useEffect(() => {
        fetch(`${API}/mapa/filtros`)
            .then(r => r.json())
            .then(d => setOpts({ departamentos: d.departamentos || [], municipios: d.municipios || [] }))
            .catch(console.error);
        fetchNegocios(FILTROS_INIT);
    }, [fetchNegocios]);

    const aplicar = () => {
        setFiltros(pendiente);
        fetchNegocios(pendiente);
    };

    const limpiar = () => {
        setPendiente(FILTROS_INIT);
        setFiltros(FILTROS_INIT);
        fetchNegocios(FILTROS_INIT);
    };

    const toggleCategoria = (catId) => {
        const nuevas = filtros.categorias.includes(catId)
            ? filtros.categorias.filter(c => c !== catId)
            : [...filtros.categorias, catId];
        const f = { ...filtros, categorias: nuevas };
        setFiltros(f);
        setPendiente(f);
        fetchResumen(f);
        fetchNegocios(f);
    };

    // Filtrado visual en cliente (cuando hay categorías activas)
    const negociosMapa = filtros.categorias.length > 0
        ? negocios.filter(n => filtros.categorias.includes(n.categoria_mapa))
        : negocios;

    return (
        <div className="mapa-layout">

            <ResumenCards resumen={resumen} activas={filtros.categorias} onToggle={toggleCategoria} />

            {total > 2000 && (
                <div className="info-box" style={{ margin: 0, padding: '8px 14px' }}>
                    <div className="info-box-text">
                        ⚠️ Mostrando 2000 de <strong>{total.toLocaleString()}</strong> negocios. Aplica filtros para ver todos.
                    </div>
                </div>
            )}

            <div className="mapa-cuerpo">
                <FiltrosPanel
                    filtros={pendiente}
                    onChange={setPendiente}
                    opts={opts}
                    onAplicar={aplicar}
                    onLimpiar={limpiar}
                />

                <div className="mapa-contenedor">
                    {cargando && (
                        <div className="mapa-overlay-carga">⏳ Cargando negocios...</div>
                    )}

                    <MapContainer center={COLOMBIA} zoom={ZOOM_INICIAL} className="mapa-leaflet">
                        <TileLayer
                            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                        />
                        <FitBounds negocios={negociosMapa} trigger={fitTrigger} />
                        <MarcadoresConZoom negocios={negociosMapa} CAT={CAT} onDetalle={setDetalleId} setDetalleId={setDetalleId} />
                    </MapContainer>

                    <Leyenda />
                </div>

                {detalleId && (
                    <DetalleDrawer id={detalleId} onCerrar={() => setDetalleId(null)} />
                )}
            </div>
        </div>
    );
}
