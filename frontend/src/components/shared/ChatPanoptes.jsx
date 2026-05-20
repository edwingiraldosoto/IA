import { useState } from 'react';

const CHAT_API_URL = import.meta.env.VITE_CHAT_API_URL || 'http://localhost:8000/api';

export default function ChatPanoptes() {
    const [chatAbierto, setChatAbierto] = useState(false);
    const [mensajes, setMensajes] = useState([
        { role: 'assistant', content: '👁️ Soy **Panoptes**, tu asistente de Cementos Argos. ¿En qué puedo ayudarte?' }
    ]);
    const [inputChat, setInputChat] = useState('');
    const [cargandoChat, setCargandoChat] = useState(false);

    const enviarMensaje = async () => {
        if (!inputChat.trim() || cargandoChat) return;
        
        const nuevoMensaje = { role: 'user', content: inputChat };
        setMensajes(prev => [...prev, nuevoMensaje]);
        setInputChat('');
        setCargandoChat(true);
        
        try {
            const historialFormateado = mensajes.map(msg => ({
                role: msg.role,
                content: msg.content
            }));
            
            const res = await fetch(`${CHAT_API_URL}/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    historial: historialFormateado,
                    mensaje: inputChat 
                })
            });
            const data = await res.json();
            setMensajes(prev => [...prev, { role: 'assistant', content: data.respuesta }]);
        } catch (err) {
            setMensajes(prev => [...prev, { 
                role: 'assistant', 
                content: '❌ Error al conectar con el servidor. Intenta de nuevo.'
            }]);
        } finally {
            setCargandoChat(false);
        }
    };

    return (
        <div className={`chat-container ${chatAbierto ? 'chat-abierto' : ''}`}>
            <button 
                className="chat-toggle" 
                onClick={() => setChatAbierto(!chatAbierto)}
                title="Hablar con Panoptes"
            >
                {chatAbierto ? '✕' : '👁️'}
            </button>
            
            {chatAbierto && (
                <div className="chat-panel">
                    <div className="chat-header">
                        <div className="chat-title">
                            <span className="chat-icon">👁️</span>
                            <div>
                                <h3>Panoptes</h3>
                                <p>Asistente Argos IA</p>
                            </div>
                        </div>
                    </div>
                    
                    <div className="chat-mensajes">
                        {mensajes.map((msg, idx) => (
                            <div key={idx} className={`mensaje mensaje-${msg.role}`}>
                                <div className="mensaje-contenido">
                                    {msg.content.split('**').map((part, i) => 
                                        i % 2 === 0 ? part : <strong key={i}>{part}</strong>
                                    )}
                                </div>
                            </div>
                        ))}
                        {cargandoChat && (
                            <div className="mensaje mensaje-assistant">
                                <div className="mensaje-contenido typing">
                                    <span></span><span></span><span></span>
                                </div>
                            </div>
                        )}
                    </div>
                    
                    <div className="chat-input-container">
                        <input
                            type="text"
                            value={inputChat}
                            onChange={e => setInputChat(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && enviarMensaje()}
                            placeholder="Pregunta sobre ferreterías, productos..."
                            className="chat-input"
                            disabled={cargandoChat}
                        />
                        <button 
                            onClick={enviarMensaje} 
                            disabled={cargandoChat || !inputChat.trim()}
                            className="chat-send"
                        >
                            ➤
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
