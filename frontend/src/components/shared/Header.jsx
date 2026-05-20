export default function Header() {
    return (
        <header className="app-header">
            <div className="app-header-content">
                <div className="logo-container">
                    <div className="logo-icon">
                        <svg width="60" height="60" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <circle cx="40" cy="40" r="38" fill="url(#gradient1)" stroke="#C4D600" strokeWidth="2"/>
                            <ellipse cx="40" cy="40" rx="20" ry="24" fill="white"/>
                            <ellipse cx="40" cy="40" rx="16" ry="20" fill="url(#gradient2)"/>
                            <circle cx="40" cy="40" r="10" fill="#001F5B"/>
                            <circle cx="40" cy="40" r="5" fill="black"/>
                            <circle cx="42" cy="38" r="2" fill="white" opacity="0.9"/>
                            <ellipse cx="40" cy="15" rx="5" ry="6" fill="white"/>
                            <ellipse cx="40" cy="15" rx="4" ry="5" fill="#003087"/>
                            <circle cx="40" cy="15" r="2" fill="#001F5B"/>
                            <ellipse cx="40" cy="65" rx="5" ry="6" fill="white"/>
                            <ellipse cx="40" cy="65" rx="4" ry="5" fill="#003087"/>
                            <circle cx="40" cy="65" r="2" fill="#001F5B"/>
                            <ellipse cx="15" cy="40" rx="5" ry="6" fill="white"/>
                            <ellipse cx="15" cy="40" rx="4" ry="5" fill="#003087"/>
                            <circle cx="15" cy="40" r="2" fill="#001F5B"/>
                            <ellipse cx="65" cy="40" rx="5" ry="6" fill="white"/>
                            <ellipse cx="65" cy="40" rx="4" ry="5" fill="#003087"/>
                            <circle cx="65" cy="40" r="2" fill="#001F5B"/>
                            <ellipse cx="22" cy="22" rx="4" ry="5" fill="white"/>
                            <ellipse cx="22" cy="22" rx="3" ry="4" fill="#003087"/>
                            <circle cx="22" cy="22" r="1.5" fill="#001F5B"/>
                            <ellipse cx="58" cy="22" rx="4" ry="5" fill="white"/>
                            <ellipse cx="58" cy="22" rx="3" ry="4" fill="#003087"/>
                            <circle cx="58" cy="22" r="1.5" fill="#001F5B"/>
                            <ellipse cx="22" cy="58" rx="4" ry="5" fill="white"/>
                            <ellipse cx="22" cy="58" rx="3" ry="4" fill="#003087"/>
                            <circle cx="22" cy="58" r="1.5" fill="#001F5B"/>
                            <ellipse cx="58" cy="58" rx="4" ry="5" fill="white"/>
                            <ellipse cx="58" cy="58" rx="3" ry="4" fill="#003087"/>
                            <circle cx="58" cy="58" r="1.5" fill="#001F5B"/>
                            <circle cx="40" cy="26" r="2" fill="white"/>
                            <circle cx="40" cy="26" r="1.5" fill="#003087"/>
                            <circle cx="40" cy="54" r="2" fill="white"/>
                            <circle cx="40" cy="54" r="1.5" fill="#003087"/>
                            <circle cx="26" cy="40" r="2" fill="white"/>
                            <circle cx="26" cy="40" r="1.5" fill="#003087"/>
                            <circle cx="54" cy="40" r="2" fill="white"/>
                            <circle cx="54" cy="40" r="1.5" fill="#003087"/>
                            <defs>
                                <linearGradient id="gradient1" x1="0%" y1="0%" x2="100%" y2="100%">
                                    <stop offset="0%" style={{stopColor:'#001F5B', stopOpacity:1}} />
                                    <stop offset="50%" style={{stopColor:'#003087', stopOpacity:1}} />
                                    <stop offset="100%" style={{stopColor:'#003087', stopOpacity:1}} />
                                </linearGradient>
                                <radialGradient id="gradient2" cx="50%" cy="50%" r="50%">
                                    <stop offset="0%" style={{stopColor:'#7dd3fc', stopOpacity:1}} />
                                    <stop offset="100%" style={{stopColor:'#003087', stopOpacity:1}} />
                                </radialGradient>
                            </defs>
                        </svg>
                    </div>
                    <div style={{ textAlign: 'left' }}>
                        <h1>ARGOS <span className="highlight">PROSPECTOR</span></h1>
                    </div>
                </div>
                <p className="subtitle">Prospección inteligente con IA • El guardián de 100 ojos</p>
            </div>
        </header>
    );
}
