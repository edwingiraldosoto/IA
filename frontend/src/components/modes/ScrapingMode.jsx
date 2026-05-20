import { useState, useEffect } from 'react';
import JobsList from '../shared/JobsList';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';
const COLOMBIA_API = import.meta.env.VITE_COLOMBIA_API_URL || 'https://api-colombia.com/api/v1';

export default function ScrapingMode() {
    const [departamentos, setDepartamentos] = useState([]);
    const [depSeleccionado, setDepSeleccionado] = useState('');
    const [municipiosDisponibles, setMunicipiosDisponibles] = useState([]);
    const [municipiosSeleccionados, setMunicipiosSeleccionados] = useState([]);
    const [busquedaMunicipio, setBusquedaMunicipio] = useState('');
    const [queries, setQueries] = useState(['ferreterías', 'depósitos de materiales']);
    const [queryInput, setQueryInput] = useState('');
    const [maxPlaces, setMaxPlaces] = useState(50);
    const [loading, setLoading] = useState(false);
    const [jobs, setJobs] = useState([]);

    useEffect(() => {
        fetch(`${COLOMBIA_API}/Department`)
            .then(r => r.json())
            .then(data => {
                const ordenados = [...data].sort((a, b) => a.name.localeCompare(b.name));
                setDepartamentos(ordenados);
            })
            .catch(err => console.error('Error cargando departamentos:', err));
    }, []);

    useEffect(() => {
        if (!depSeleccionado) {
            setMunicipiosDisponibles([]);
            return;
        }
        fetch(`${COLOMBIA_API}/Department/${depSeleccionado}/cities`)
            .then(r => r.json())
            .then(data => {
                const ordenados = [...data].sort((a, b) => a.name.localeCompare(b.name));
                setMunicipiosDisponibles(ordenados);
                setMunicipiosSeleccionados([]);
                setBusquedaMunicipio('');
            })
            .catch(err => console.error('Error cargando municipios:', err));
    }, [depSeleccionado]);

    useEffect(() => {
        const fetchJobs = () => {
            fetch(`${API_URL}/jobs`)
                .then(r => r.json())
                .then(data => {
                    // Agregar mode y timestamp si no existen
                    const jobsConMetadata = data.map(job => ({
                        ...job,
                        mode: job.mode || 'scraping',
                        timestamp: job.timestamp || new Date().toISOString()
                    }));
                    setJobs(jobsConMetadata);
                })
                .catch(err => console.error(err));
        };
        fetchJobs();
        const interval = setInterval(fetchJobs, 3000);
        return () => clearInterval(interval);
    }, []);

    const toggleMunicipio = (nombre) => {
        setMunicipiosSeleccionados(prev => 
            prev.includes(nombre) ? prev.filter(m => m !== nombre) : [...prev, nombre]
        );
    };

    const seleccionarTodos = () => {
        const filtrados = municipiosFiltrados.map(m => m.name);
        setMunicipiosSeleccionados(filtrados);
    };

    const deseleccionarTodos = () => setMunicipiosSeleccionados([]);

    const agregarQuery = () => {
        if (queryInput.trim() && !queries.includes(queryInput.trim())) {
            setQueries([...queries, queryInput.trim()]);
            setQueryInput('');
        }
    };

    const eliminarQuery = (q) => setQueries(queries.filter(x => x !== q));

    const municipiosFiltrados = municipiosDisponibles.filter(m =>
        m.name.toLowerCase().includes(busquedaMunicipio.toLowerCase())
    );

    const lanzarScraping = async () => {
        const depObj = departamentos.find(d => d.id === parseInt(depSeleccionado));
        if (!depObj || municipiosSeleccionados.length === 0 || queries.length === 0) {
            alert('Selecciona departamento, municipios y al menos una búsqueda');
            return;
        }
        
        setLoading(true);
        try {
            const res = await fetch(`${API_URL}/jobs`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    departamento: depObj.name,
                    municipios: municipiosSeleccionados,
                    searchQueries: queries,
                    maxPlaces,
                    maxImages: 10,
                    mode: 'scraping', // Agregar metadata de modo
                    timestamp: new Date().toISOString() // Agregar timestamp
                })
            });
            const data = await res.json();
            alert(data.mensaje);
        } catch (err) {
            alert(`Error: ${err.message}`);
        } finally {
            setLoading(false);
        }
    };

    return (
        <>
            <section className="card">
                <div className="card-header">
                    <span className="card-number">1</span>
                    <h2>Ubicación</h2>
                </div>
                
                <div className="form-group">
                    <label>Departamento</label>
                    <select 
                        value={depSeleccionado} 
                        onChange={e => setDepSeleccionado(e.target.value)}
                        className="select-input"
                    >
                        <option value="">-- Selecciona un departamento --</option>
                        {departamentos.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                </div>

                {municipiosDisponibles.length > 0 && (
                    <div className="form-group">
                        <div className="municipios-header">
                            <label>
                                Municipios 
                                <span className="badge">{municipiosSeleccionados.length} / {municipiosDisponibles.length}</span>
                            </label>
                            <div className="action-buttons">
                                <button onClick={seleccionarTodos} className="btn-link">Todos</button>
                                <button onClick={deseleccionarTodos} className="btn-link">Ninguno</button>
                            </div>
                        </div>

                        <input
                            type="text"
                            placeholder="🔍 Buscar municipio..."
                            value={busquedaMunicipio}
                            onChange={e => setBusquedaMunicipio(e.target.value)}
                            className="search-input"
                        />

                        <div className="municipios-grid">
                            {municipiosFiltrados.map(m => {
                                const seleccionado = municipiosSeleccionados.includes(m.name);
                                return (
                                    <button
                                        key={m.id}
                                        onClick={() => toggleMunicipio(m.name)}
                                        className={`chip ${seleccionado ? 'chip-active' : ''}`}
                                    >
                                        {seleccionado && '✓ '}{m.name}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}
            </section>

            <section className="card">
                <div className="card-header">
                    <span className="card-number">2</span>
                    <h2>Búsquedas</h2>
                </div>
                
                <div className="form-group">
                    <div className="input-group">
                        <input
                            value={queryInput}
                            onChange={e => setQueryInput(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && agregarQuery()}
                            placeholder="Ej: ferreterías, cementeras, depósitos..."
                            className="text-input"
                        />
                        <button onClick={agregarQuery} className="btn-primary-sm">
                            + Agregar
                        </button>
                    </div>

                    <div className="tags-container">
                        {queries.map(q => (
                            <span key={q} className="tag">
                                {q}
                                <button onClick={() => eliminarQuery(q)} className="tag-remove">✕</button>
                            </span>
                        ))}
                    </div>
                </div>
            </section>

            <section className="card">
                <div className="card-header">
                    <span className="card-number">3</span>
                    <h2>Configuración</h2>
                </div>
                
                <div className="form-group">
                    <label>Máximo de resultados por búsqueda</label>
                    <input 
                        type="number" 
                        value={maxPlaces} 
                        onChange={e => setMaxPlaces(parseInt(e.target.value))} 
                        min="1" 
                        max="500"
                        className="text-input"
                        style={{ maxWidth: 200 }}
                    />
                </div>
            </section>

            <button 
                onClick={lanzarScraping} 
                disabled={loading || municipiosSeleccionados.length === 0}
                className="btn-launch"
            >
                {loading ? '⏳ Lanzando...' : `🚀 Iniciar Scraping (${municipiosSeleccionados.length} municipios)`}
            </button>

            <JobsList jobs={jobs} modo="scraping" />
        </>
    );
}
