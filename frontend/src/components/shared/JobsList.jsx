export default function JobsList({ jobs, modo }) {
    // Filtrar jobs por modo
    const jobsFiltrados = jobs.filter(job => job.mode === modo);

    const getStatusBadge = (status) => {
        const styles = {
            pending: { bg: '#fef3c7', color: '#92400e', icon: '⏳' },
            running: { bg: '#dbeafe', color: '#1e40af', icon: '🔄' },
            completed: { bg: '#d1fae5', color: '#065f46', icon: '✅' },
            failed: { bg: '#fee2e2', color: '#991b1b', icon: '❌' }
        };
        const s = styles[status] || styles.pending;
        return (
            <span style={{
                background: s.bg, color: s.color, padding: '4px 12px',
                borderRadius: 12, fontSize: 12, fontWeight: 600,
                display: 'inline-block'
            }}>
                {s.icon} {status.toUpperCase()}
            </span>
        );
    };

    const formatTimestamp = (timestamp) => {
        if (!timestamp) return '';
        const date = new Date(timestamp);
        return date.toLocaleString('es-CO', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });
    };

    return (
        <section className="card">
            <div className="card-header">
                <h2>📋 Jobs de {modo === 'scraping' ? 'Scraping' : 'RUES'}</h2>
                <span className="badge">{jobsFiltrados.length}</span>
            </div>
            
            {jobsFiltrados.length === 0 && (
                <p className="empty-state">
                    No hay jobs de {modo} todavía. Lanza tu primer proceso arriba ⬆️
                </p>
            )}
            
            <div className="jobs-list">
                {jobsFiltrados.map(job => (
                    <div key={job.id} className={`job-card job-${job.status}`}>
                        <div className="job-header">
                            <div>
                                <strong>{job.config.municipio + '-' +  job.config.departamento || job.config.fileName || 'Procesamiento'}</strong>
                                <code className="job-id">{job.id.substring(0, 8)}</code>
                                {job.timestamp && (
                                    <div className="job-timestamp">
                                        🕐 {formatTimestamp(job.finishedAt)}
                                    </div>
                                )}
                            </div>
                            {getStatusBadge(job.status)}
                        </div>
                        
                        {job.progress?.total > 0 && (
                            <div className="progress-section">
                                <div className="progress-info">
                                    <span>{job.progress.current} / {job.progress.total}</span>
                                    {job.progress.currentItem && (
                                        <span className="current-item">🏪 {job.progress.currentItem}</span>
                                    )}
                                </div>
                                <div className="progress-bar">
                                    <div 
                                        className="progress-fill" 
                                        style={{ width: `${(job.progress.current / job.progress.total) * 100}%` }}
                                    />
                                </div>
                            </div>
                        )}
                        
                        {job.result && (
                            <div className="job-result">
                                <span className="stat stat-success">✅ {job.result.exitosos} exitosos</span>
                                <span className="stat stat-error">❌ {job.result.fallidos} fallidos</span>
                            </div>
                        )}
                        
                        {job.error && <div className="job-error">⚠️ {job.error}</div>}
                    </div>
                ))}
            </div>
        </section>
    );
}
