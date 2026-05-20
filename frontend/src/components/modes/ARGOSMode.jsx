import { useState, useEffect, useRef } from 'react';
import HistorialArgos from '../shared/HistorialArgos';

const ARGOS_API_URL = import.meta.env.VITE_ARGOS_API_URL || 'http://localhost:8001';
const COLOMBIA_API = import.meta.env.VITE_COLOMBIA_API_URL || 'https://api-colombia.com/api/v1';
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export default function ARGOSMode() {
    const [archivoARGOS, setArchivoARGOS] = useState(null);
    const [departamentos, setDepartamentos] = useState([]);
    const [filtrosARGOS, setFiltrosARGOS] = useState([{
        id: 1,
        departamento: '',
        departamentoId: '',
        municipio: '',
        municipiosDisponibles: []
    }]);
    const [loadingARGOS, setLoadingARGOS] = useState(false);
    const [fileId, setFileId] = useState(null);
    const [estadoProceso, setEstadoProceso] = useState(null);
    const [mensajeError, setMensajeError] = useState(null);
    const pollingIntervalRef = useRef(null);

    // Cargar departamentos desde Colombia API al montar
    useEffect(() => {
        fetch(`${COLOMBIA_API}/Department`)
            .then(r => r.json())
            .then(data => {
                const ordenados = [...data].sort((a, b) => a.name.localeCompare(b.name));
                setDepartamentos(ordenados);
            })
            .catch(err => console.error('Error cargando departamentos:', err));
    }, []);

    // Cargar estado guardado al montar - solo si está procesando
    useEffect(() => {
        const estadoGuardado = localStorage.getItem('argosState');
        if (estadoGuardado) {
            try {
                const estado = JSON.parse(estadoGuardado);
                // Solo restaurar si el proceso está en progreso
                if (estado.estadoProceso?.estado === 'processing') {
                    setFileId(estado.fileId);
                    setEstadoProceso(estado.estadoProceso);
                } else {
                    // Limpiar si ya está completado o falló
                    localStorage.removeItem('argosState');
                }
            } catch (err) {
                console.error('Error cargando estado guardado:', err);
                localStorage.removeItem('argosState');
            }
        }
    }, []);

    // Guardar estado cuando cambia fileId o estadoProceso
    useEffect(() => {
        if (fileId) {
            localStorage.setItem('argosState', JSON.stringify({
                fileId,
                estadoProceso
            }));
        }
    }, [fileId, estadoProceso]);

    // Cleanup polling
    useEffect(() => {
        return () => {
            if (pollingIntervalRef.current) {
                clearInterval(pollingIntervalRef.current);
            }
        };
    }, []);

    // Polling automático - NUNCA se detiene por error, solo cuando termina
    useEffect(() => {
        if (!fileId) return;

        const consultarEstado = async () => {
            try {
                const response = await fetch(`${ARGOS_API_URL}/estado-argos/${fileId}`);

                if (!response.ok) {
                    console.error(`Error HTTP ${response.status} consultando estado`);
                    // NO detener polling - reintentar en siguiente intervalo
                    return;
                }

                const data = await response.json();
                setEstadoProceso(data);
                setMensajeError(null);

                // SOLO detener polling cuando estado sea terminal (completado o fallido)
                if (data.estado === 'completed' || data.estado === 'failed') {
                    if (pollingIntervalRef.current) {
                        clearInterval(pollingIntervalRef.current);
                        pollingIntervalRef.current = null;
                    }
                }
            } catch (err) {
                console.error('Error en polling (reintentando):', err.message);
                // Silenciosamente reintentar - no mostrar error al usuario
                // El servidor está procesando, solo hay conectividad temporal
            }
        };

        // Consultar inmediatamente
        consultarEstado();

        // Luego consultar cada 2.5 segundos hasta que termine
        pollingIntervalRef.current = setInterval(consultarEstado, 2500);

        return () => {
            if (pollingIntervalRef.current) {
                clearInterval(pollingIntervalRef.current);
                pollingIntervalRef.current = null;
            }
        };
    }, [fileId]);

    const handleFileUpload = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        // Validar tipo
        const esExcel = ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'].includes(file.type);
        if (!esExcel && !file.name.match(/\.(xlsx|xls)$/i)) {
            setMensajeError('Por favor selecciona un archivo Excel (.xlsx o .xls)');
            return;
        }

        // Validar tamaño
        if (file.size > MAX_FILE_SIZE) {
            setMensajeError(`El archivo no debe exceder ${MAX_FILE_SIZE / (1024 * 1024)}MB`);
            return;
        }

        setArchivoARGOS(file);
        setMensajeError(null);
    };

    const removeFile = () => {
        setArchivoARGOS(null);
        setMensajeError(null);
        document.getElementById('fileInputARGOS').value = '';
    };

    const agregarFiltroARGOS = () => {
        const nuevoId = Math.max(...filtrosARGOS.map(f => f.id), 0) + 1;
        setFiltrosARGOS([...filtrosARGOS, {
            id: nuevoId,
            departamento: '',
            departamentoId: '',
            municipio: '',
            municipiosDisponibles: []
        }]);
    };

    const removerFiltroARGOS = (id) => {
        if (filtrosARGOS.length === 1) return;
        setFiltrosARGOS(filtrosARGOS.filter(f => f.id !== id));
    };

    const actualizarDepartamento = (id, depId, depNombre) => {
        setFiltrosARGOS(filtrosARGOS.map(f =>
            f.id === id ? { ...f, departamento: depNombre, departamentoId: depId, municipio: '', municipiosDisponibles: [] } : f
        ));

        if (depId && depId !== 'TODOS') {
            fetch(`${COLOMBIA_API}/Department/${depId}/cities`)
                .then(r => r.json())
                .then(data => {
                    const ordenados = [...data].sort((a, b) => a.name.localeCompare(b.name));
                    setFiltrosARGOS(prev => prev.map(f =>
                        f.id === id ? { ...f, municipiosDisponibles: ordenados } : f
                    ));
                })
                .catch(err => console.error('Error cargando municipios:', err));
        }
    };

    const actualizarMunicipio = (id, municipio) => {
        const filtroActual = filtrosARGOS.find(f => f.id === id);

        // Validar: si ya hay TODOS para este departamento, no permitir municipio específico
        if (municipio && municipio !== 'TODOS') {
            const yaExisteTodos = filtrosARGOS.some(f =>
                f.id !== id &&
                f.departamento === filtroActual.departamento &&
                f.municipio === 'TODOS'
            );

            if (yaExisteTodos) {
                setMensajeError(`Ya existe "TODOS los municipios de ${filtroActual.departamento}". No puedes agregar municipios específicos.`);
                return;
            }
        }

        // Validar: si selecciona TODOS, y ya hay municipios específicos para este depto
        if (municipio === 'TODOS') {
            const yaExisteEspecifico = filtrosARGOS.some(f =>
                f.id !== id &&
                f.departamento === filtroActual.departamento &&
                f.municipio !== 'TODOS' &&
                f.municipio !== ''
            );

            if (yaExisteEspecifico) {
                setMensajeError(`Ya existen municipios específicos de ${filtroActual.departamento}. No puedes seleccionar TODOS para este departamento.`);
                return;
            }
        }

        setMensajeError(null);
        setFiltrosARGOS(filtrosARGOS.map(f =>
            f.id === id ? { ...f, municipio } : f
        ));
    };

    const removerAcentos = (texto) => {
        if (!texto) return texto;
        return texto.normalize('NFD').replace(/[̀-ͯ]/g, '');
    };

    const procesarARGOS = async () => {
        if (!archivoARGOS) {
            setMensajeError('Por favor selecciona un archivo Excel');
            return;
        }

        // Validar: debe haber al menos un departamento seleccionado
        const filtrosValidos = filtrosARGOS.filter(f => f.departamento);
        if (filtrosValidos.length === 0) {
            setMensajeError('Configura al menos un Departamento');
            return;
        }

        // Si selecciona TODOS en departamento, no puede haber municipio específico
        const tieneToDosDepartamento = filtrosValidos.some(f => f.departamento === 'TODOS');
        if (tieneToDosDepartamento && filtrosValidos.some(f => f.municipio && f.municipio !== 'TODOS')) {
            setMensajeError('No puedes seleccionar TODOS los departamentos Y municipios específicos a la vez');
            return;
        }

        setLoadingARGOS(true);
        setMensajeError(null);

        try {
            const formData = new FormData();
            formData.append('archivo', archivoARGOS);

            // Construir parámetros query: agrupa departamentos y municipios únicos
            // Convertir a MAYÚSCULAS y remover acentos para coincidir con los datos del servidor
            const params = new URLSearchParams();
            const deptosUnicos = new Set();
            const municipiosUnicos = new Set();

            filtrosValidos.forEach(f => {
                const deptoSinAcentos = removerAcentos(f.departamento).toUpperCase();
                deptosUnicos.add(deptoSinAcentos);

                // Solo agregar municipios si están definidos y no son vacíos
                if (f.municipio && f.municipio.trim() !== '') {
                    const municipioSinAcentos = removerAcentos(f.municipio).toUpperCase();
                    municipiosUnicos.add(municipioSinAcentos);
                }
            });

            deptosUnicos.forEach(d => params.append('departamentos', d));
            municipiosUnicos.forEach(m => params.append('municipios', m));

            const url = `${ARGOS_API_URL}/procesar-info-argos?${params.toString()}`;
            const response = await fetch(url, {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.detail || `Error ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();

            if (!data.file_id) {
                throw new Error('No se recibió ID de archivo');
            }

            setFileId(data.file_id);
            setEstadoProceso(null);
        } catch (err) {
            setMensajeError(`Error: ${err.message}`);
            setLoadingARGOS(false);
        }
    };

    const detenerProceso = () => {
        if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
        }
        setFileId(null);
        setEstadoProceso(null);
        setMensajeError(null);
        setArchivoARGOS(null);
        setLoadingARGOS(false);
        setFiltrosARGOS([{
            id: 1,
            departamento: '',
            departamentoId: '',
            municipio: '',
            municipiosDisponibles: []
        }]);
        document.getElementById('fileInputARGOS').value = '';
        localStorage.removeItem('argosState');
    };

    const handleReprocesar = (datosHistorial) => {
        // Limpiar estado actual si hay algo
        detenerProceso();

        // Cargar los filtros del historial
        if (datosHistorial.departamentos && datosHistorial.departamentos.length > 0) {
            const nuevosFiltros = datosHistorial.departamentos.map((depto, idx) => {
                const deptoObj = departamentos.find(d => d.name === depto);
                const municipios = datosHistorial.municipios && datosHistorial.municipios[idx] ? [datosHistorial.municipios[idx]] : [];

                return {
                    id: idx + 1,
                    departamento: depto,
                    departamentoId: deptoObj?.id || '',
                    municipio: municipios[0] || '',
                    municipiosDisponibles: []
                };
            });

            setFiltrosARGOS(nuevosFiltros);

            // Cargar municipios disponibles para cada departamento
            nuevosFiltros.forEach((filtro) => {
                if (filtro.departamentoId && filtro.departamentoId !== 'TODOS') {
                    fetch(`${COLOMBIA_API}/Department/${filtro.departamentoId}/cities`)
                        .then(r => r.json())
                        .then(data => {
                            const ordenados = [...data].sort((a, b) => a.name.localeCompare(b.name));
                            setFiltrosARGOS(prev => prev.map(f =>
                                f.id === filtro.id ? { ...f, municipiosDisponibles: ordenados } : f
                            ));
                        })
                        .catch(err => console.error('Error cargando municipios:', err));
                }
            });
        }

        // Usuario ahora puede cargar un nuevo archivo y procesar con los filtros previos
        setMensajeError(null);

        // Scroll suave hacia arriba para ver el form
        setTimeout(() => {
            document.querySelector('.card')?.scrollIntoView({ behavior: 'smooth' });
        }, 100);
    };

    const getEstadoBadge = (estado) => {
        const estilos = {
            processing: { bg: '#dbeafe', color: '#1e40af', icon: '🔄' },
            completed: { bg: '#d1fae5', color: '#065f46', icon: '✅' },
            failed: { bg: '#fee2e2', color: '#991b1b', icon: '❌' },
        };
        const e = estilos[estado] || { bg: '#fef3c7', color: '#92400e', icon: '⏳' };
        return (
            <span style={{
                background: e.bg, color: e.color, padding: '4px 12px',
                borderRadius: 12, fontSize: 12, fontWeight: 600,
                display: 'inline-block'
            }}>
                {e.icon} {estado?.toUpperCase() || 'PENDIENTE'}
            </span>
        );
    };

    const calcularPorcentaje = () => {
        if (!estadoProceso?.registros?.total) return 0;
        return Math.round((estadoProceso.registros.procesados / estadoProceso.registros.total) * 100);
    };

    return (
        <>
            {/* SECCIÓN 1: CARGAR ARCHIVO */}
            {!fileId && (
                <section className="card">
                    <div className="card-header">
                        <span className="card-number">1</span>
                        <h2>Cargar archivo ARGOS</h2>
                    </div>

                    <div
                        className="upload-zone"
                        onClick={() => document.getElementById('fileInputARGOS').click()}
                    >
                        <div className="upload-icon">📄</div>
                        <h4>Arrastra tu archivo Excel o haz clic aquí</h4>
                        <p>Formatos soportados: .xlsx, .xls</p>
                        <p style={{ fontSize: 12, color: '#9ca3af', marginTop: 8 }}>
                            Tamaño máximo: 10MB
                        </p>
                        <input
                            type="file"
                            id="fileInputARGOS"
                            style={{ display: 'none' }}
                            accept=".xlsx,.xls"
                            onChange={handleFileUpload}
                        />
                    </div>

                    {archivoARGOS && (
                        <div className="file-info show">
                            <div className="file-name">
                                <span>📊</span>
                                <span>{archivoARGOS.name}</span>
                            </div>
                            <button className="tag-remove" onClick={removeFile}>✕</button>
                        </div>
                    )}

                    {mensajeError && (
                        <div className="warning-box">
                            <div className="warning-title">
                                <span>❌</span>
                                Error
                            </div>
                            <div className="warning-text">{mensajeError}</div>
                        </div>
                    )}

                    <div className="info-box">
                        <div className="info-box-title">
                            <span>ℹ️</span>
                            Estructura esperada
                        </div>
                        <div className="info-box-text">
                            Tu archivo debe contener: <strong>Departamento (Texto)</strong> y <strong>Población</strong>
                        </div>
                    </div>
                </section>
            )}

            {/* SECCIÓN 2: FILTROS */}
            {archivoARGOS && !fileId && (
                <section className="card">
                    <div className="card-header">
                        <span className="card-number">2</span>
                        <h2>Filtros de procesamiento</h2>
                    </div>

                    <p style={{ color: '#6b7280', fontSize: 14, marginBottom: '1rem' }}>
                        💡 Puedes seleccionar múltiples combinaciones (ej: Antioquia-Amagá + Antioquia-Envigado)
                    </p>

                    <div id="filterGroups">
                        {filtrosARGOS.map((filtro, idx) => (
                            <div key={filtro.id} className="filter-group-row">
                                <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                                    <label style={{ visibility: idx === 0 ? 'visible' : 'hidden' }}>Departamento</label>
                                    <select
                                        className="select-input"
                                        value={filtro.departamentoId}
                                        onChange={e => {
                                            if (e.target.value === 'TODOS') {
                                                actualizarDepartamento(filtro.id, 'TODOS', 'TODOS');
                                            } else {
                                                const selectedDep = departamentos.find(d => d.id === parseInt(e.target.value));
                                                if (selectedDep) {
                                                    actualizarDepartamento(filtro.id, selectedDep.id, selectedDep.name);
                                                }
                                            }
                                        }}
                                    >
                                        <option value="">-- Selecciona --</option>
                                        {filtrosARGOS.length === 1 && <option value="TODOS">⚠️ TODOS (alto costo)</option>}
                                        {departamentos.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                                    </select>
                                    {filtrosARGOS.length > 1 && (
                                        <small style={{ color: '#6b7280', fontSize: 11, marginTop: 4, display: 'block' }}>
                                            ⚠️ TODOS no disponible con múltiples grupos
                                        </small>
                                    )}
                                </div>

                                <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                                    <label style={{ visibility: idx === 0 ? 'visible' : 'hidden' }}>Municipio</label>
                                    <select
                                        className="select-input"
                                        value={filtro.municipio}
                                        onChange={e => actualizarMunicipio(filtro.id, e.target.value)}
                                        disabled={!filtro.departamento || filtro.departamento === 'TODOS'}
                                    >
                                        <option value="">-- Selecciona --</option>
                                        {filtro.departamento && filtro.departamento !== 'TODOS' && (
                                            <option value="TODOS">⚠️ TODOS los municipios de {filtro.departamento}</option>
                                        )}
                                        {filtro.municipiosDisponibles.map(m => (
                                            <option key={m.id} value={m.name}>{m.name}</option>
                                        ))}
                                    </select>
                                    {!filtro.departamento && (
                                        <small style={{ color: '#9ca3af', fontSize: 11, marginTop: 4, display: 'block' }}>
                                            Selecciona primero un departamento
                                        </small>
                                    )}
                                    {filtro.departamento === 'TODOS' && (
                                        <small style={{ color: '#9ca3af', fontSize: 11, marginTop: 4, display: 'block' }}>
                                            No se requiere municipio con TODOS departamentos
                                        </small>
                                    )}
                                </div>

                                <button
                                    className="btn-icon"
                                    onClick={() => removerFiltroARGOS(filtro.id)}
                                    disabled={filtrosARGOS.length === 1}
                                >
                                    🗑️
                                </button>
                            </div>
                        ))}
                    </div>

                    <button
                        className="btn btn-secondary"
                        onClick={agregarFiltroARGOS}
                        disabled={filtrosARGOS.some(f => f.departamento === 'TODOS')}
                        style={{ marginTop: '1rem', width: '100%' }}
                    >
                        ➕ Agregar otro departamento/municipio
                    </button>

                    {filtrosARGOS.some(f => f.departamento === 'TODOS') && (
                        <div className="warning-box" style={{ marginTop: '1rem' }}>
                            <div className="warning-title">
                                <span>⚠️</span>
                                Advertencia: TODOS los departamentos
                            </div>
                            <div className="warning-text">
                                <strong>Seleccionar "TODOS" en departamento</strong> procesará TODOS los registros de Colombia sin filtrar. Esto puede generar <strong>costos muy altos en Google Maps API y en análisis con Gemini</strong>.
                                <br/><br/>
                                <strong>Recomendación:</strong> Selecciona departamentos específicos para optimizar costos.
                            </div>
                        </div>
                    )}

                    <div className="info-box">
                        <div className="info-box-title">
                            <span>⚡</span>
                            Procesamiento inteligente
                        </div>
                        <div className="info-box-text">
                            El sistema procesará solo los registros que coincidan con los filtros seleccionados.
                        </div>
                    </div>
                </section>
            )}

            {/* BOTÓN PROCESAR */}
            {archivoARGOS && !fileId && (
                <button
                    onClick={procesarARGOS}
                    disabled={loadingARGOS || filtrosARGOS.filter(f => f.departamento).length === 0}
                    className="btn-launch"
                >
                    {loadingARGOS ? '⏳ Procesando...' : '🚀 Procesar archivo ARGOS'}
                </button>
            )}

            {/* SECCIÓN 3: ESTADO */}
            {fileId && estadoProceso && (
                <section className="card">
                    <div className="card-header">
                        <span className="card-number">3</span>
                        <h2>Estado del Procesamiento</h2>
                    </div>

                    <div style={{ marginBottom: '1.5rem' }}>
                        <div style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            marginBottom: '1rem'
                        }}>
                            <div>
                                <p style={{ margin: 0, fontWeight: 600, marginBottom: 4 }}>Estado</p>
                                {getEstadoBadge(estadoProceso.estado)}
                            </div>
                            {estadoProceso.estado === 'processing' && (
                                <button
                                    onClick={detenerProceso}
                                    className="btn-secondary"
                                    style={{ padding: '8px 16px', fontSize: 14 }}
                                >
                                    ⏹️ Cancelar
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Barra de progreso */}
                    {estadoProceso.registros?.total > 0 && (
                        <div style={{ marginBottom: '1.5rem' }}>
                            <div style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                marginBottom: '0.5rem',
                                alignItems: 'center'
                            }}>
                                <span style={{ fontSize: 14, color: '#6b7280' }}>
                                    Progreso: <strong>{estadoProceso.registros.procesados} / {estadoProceso.registros.total}</strong>
                                </span>
                                <span style={{ fontSize: 14, fontWeight: 700, color: '#003087' }}>
                                    {calcularPorcentaje()}%
                                </span>
                            </div>
                            <div className="progress-bar">
                                <div
                                    className="progress-fill"
                                    style={{ width: `${calcularPorcentaje()}%` }}
                                />
                            </div>
                        </div>
                    )}

                    {/* Estadísticas */}
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                        gap: '1rem',
                        marginBottom: '1rem'
                    }}>
                        <div style={{
                            padding: '1rem',
                            background: '#f9fafb',
                            borderRadius: '10px',
                            border: '1px solid #e5e7eb'
                        }}>
                            <p style={{ margin: 0, fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Total</p>
                            <p style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#003087' }}>
                                {estadoProceso.registros?.total || 0}
                            </p>
                        </div>

                        <div style={{
                            padding: '1rem',
                            background: '#f9fafb',
                            borderRadius: '10px',
                            border: '1px solid #e5e7eb'
                        }}>
                            <p style={{ margin: 0, fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Procesados</p>
                            <p style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#10b981' }}>
                                {estadoProceso.registros?.procesados || 0}
                            </p>
                        </div>

                        <div style={{
                            padding: '1rem',
                            background: '#f9fafb',
                            borderRadius: '10px',
                            border: '1px solid #e5e7eb'
                        }}>
                            <p style={{ margin: 0, fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Pendientes</p>
                            <p style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#f59e0b' }}>
                                {(estadoProceso.registros?.total || 0) - (estadoProceso.registros?.procesados || 0)}
                            </p>
                        </div>
                    </div>

                    {/* Éxito */}
                    {estadoProceso.estado === 'completed' && (
                        <div style={{
                            padding: '1rem',
                            background: '#d1fae5',
                            borderRadius: '10px',
                            border: '1px solid #10b981'
                        }}>
                            <p style={{ margin: 0, fontSize: 14, color: '#065f46', fontWeight: 600 }}>
                                ✅ Procesamiento completado exitosamente
                            </p>
                        </div>
                    )}

                    {/* Error */}
                    {estadoProceso.estado === 'failed' && (
                        <div style={{
                            padding: '1rem',
                            background: '#fee2e2',
                            borderRadius: '10px',
                            border: '1px solid #ef4444'
                        }}>
                            <p style={{ margin: 0, fontSize: 14, color: '#991b1b', fontWeight: 600 }}>
                                ❌ Error en el procesamiento
                            </p>
                        </div>
                    )}

                    {/* Reiniciar */}
                    {(estadoProceso.estado === 'completed' || estadoProceso.estado === 'failed') && (
                        <button
                            onClick={detenerProceso}
                            className="btn-secondary"
                            style={{ marginTop: '1rem', width: '100%' }}
                        >
                            🔄 Procesar otro archivo
                        </button>
                    )}
                </section>
            )}

            {/* Loading */}
            {fileId && !estadoProceso && (
                <section className="card">
                    <div style={{ textAlign: 'center', padding: '2rem' }}>
                        <div style={{ fontSize: 48, marginBottom: '1rem' }}>⏳</div>
                        <p style={{ fontSize: 16, fontWeight: 600, color: '#1f2937', marginBottom: '0.5rem' }}>
                            Conectando con el servidor...
                        </p>
                        <p style={{ fontSize: 14, color: '#6b7280' }}>
                            Obteniendo información del proceso
                        </p>
                    </div>
                </section>
            )}

            {/* Error de polling */}
            {mensajeError && fileId && (
                <div className="warning-box">
                    <div className="warning-title">
                        <span>⚠️</span>
                        Error de conexión
                    </div>
                    <div className="warning-text">{mensajeError}</div>
                </div>
            )}

            {/* HISTORIAL */}
            <HistorialArgos onReprocesar={handleReprocesar} />
        </>
    );
}
