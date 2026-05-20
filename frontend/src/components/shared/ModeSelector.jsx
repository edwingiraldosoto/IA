export default function ModeSelector({ modoActivo, onModoChange }) {
    return (
        <div className="mode-selector">
            <h2>Selecciona el modo de trabajo</h2>
            <div className="mode-tabs">
                <button 
                    className={`mode-tab ${modoActivo === 'scraping' ? 'active' : ''}`}
                    onClick={() => onModoChange('scraping')}
                >
                    <span className="mode-icon">🌎</span>
                    Scraping
                </button>
                <button 
                    className={`mode-tab ${modoActivo === 'rues' ? 'active' : ''}`}
                    onClick={() => onModoChange('rues')}
                >
                    <span className="mode-icon">📊</span>
                    RUES Excel
                </button>
            </div>
        </div>
    );
}
