const NAV_ITEMS = [
    { id: 'scraping', icon: '🌎', label: 'Apify', sublabel: 'Scraping Maps' },
    { id: 'rues', icon: '📊', label: 'RUES', sublabel: 'Procesar Excel' },
    { id: 'argos', icon: '🏢', label: 'ARGOS', sublabel: 'Cargar Datos' },
    { id: 'sincronizar', icon: '🔄', label: 'Sincronizar', sublabel: 'Datos' },
    { id: 'datos', icon: '📋', label: 'Resultados', sublabel: 'Ver trabajos' },
    { id: 'mapa', icon: '🗺️', label: 'Mapa', sublabel: 'Ubicar negocios' },
    { id: 'agente', icon: '🤖', label: 'Agente IA', sublabel: 'Chat Panoptes' },
];

export default function Sidebar({ modoActivo, onModoChange }) {
    return (
        <aside className="sidebar">
            <div className="sidebar-brand">
                <div className="sidebar-logo">👁️</div>
                <div>
                    <div className="sidebar-title">Panoptes</div>
                    <div className="sidebar-subtitle">Cementos Argos</div>
                </div>
            </div>
            <nav className="sidebar-nav">
                {NAV_ITEMS.map(item => (
                    <button
                        key={item.id}
                        className={`sidebar-item ${modoActivo === item.id ? 'active' : ''}`}
                        onClick={() => onModoChange(item.id)}
                    >
                        <span className="sidebar-icon">{item.icon}</span>
                        <div className="sidebar-item-text">
                            <span className="sidebar-label">{item.label}</span>
                            <span className="sidebar-sublabel">{item.sublabel}</span>
                        </div>
                    </button>
                ))}
            </nav>
        </aside>
    );
}
