import { useState } from 'react';
import './App.css';
import Sidebar from './components/shared/Sidebar';
import ScrapingMode from './components/modes/ScrapingMode';
import RUESMode from './components/modes/RUESMode';
import ARGOSMode from './components/modes/ARGOSMode';
import SincronizarMode from './components/modes/SincronizarMode';
import MapMode from './components/modes/MapMode';
import ResultadosMode from './components/modes/ResultadosMode';
import ChatPanoptes from './components/shared/ChatPanoptes';

const PAGE_META = {
    scraping:    { title: 'Apify Scraping',        subtitle: 'Extrae negocios desde Google Maps por departamento y municipio' },
    rues:        { title: 'Procesar RUES',          subtitle: 'Geocodifica y enriquece con IA los registros del RUES' },
    argos:       { title: 'Procesar ARGOS',         subtitle: 'Carga y procesa información de registros ARGOS' },
    sincronizar: { title: 'Sincronizar',            subtitle: 'Sincroniza y exporta los datos procesados' },
    datos:       { title: 'Resultados',             subtitle: 'Historial de trabajos y datos recopilados' },
    mapa:        { title: 'Mapa',                   subtitle: 'Visualiza negocios geolocalizados en el mapa' },
    agente:      { title: 'Agente IA — Panoptes',   subtitle: 'Consulta y analiza datos con inteligencia artificial' },
};

function PlaceholderPage({ icon, title, desc }) {
    return (
        <div className="placeholder-page">
            <div className="placeholder-icon">{icon}</div>
            <h2>{title}</h2>
            <p>{desc}</p>
        </div>
    );
}

export default function App() {
    const [modoActivo, setModoActivo] = useState('scraping');
    const meta = PAGE_META[modoActivo];

    return (
        <div className="app-layout">
            <Sidebar modoActivo={modoActivo} onModoChange={setModoActivo} />
            <div className="main-content">
                <div className="page-header">
                    <h1 className="page-title">{meta.title}</h1>
                    <p className="page-subtitle">{meta.subtitle}</p>
                </div>
                <div className={`page-body ${modoActivo === 'mapa' || modoActivo === 'datos' ? 'page-body--mapa' : ''}`}>
                    {modoActivo === 'scraping'    && <ScrapingMode />}
                    {modoActivo === 'rues'        && <RUESMode />}
                    {modoActivo === 'argos'       && <ARGOSMode />}
                    {modoActivo === 'sincronizar' && <SincronizarMode />}
                    {modoActivo === 'datos'       && <ResultadosMode />}
                    {modoActivo === 'mapa'        && <MapMode />}
                    {modoActivo === 'agente'      && <PlaceholderPage icon="🤖" title="Agente IA" desc="Usa el chat Panoptes (👁️ abajo derecha) para consultar y analizar datos con IA" />}
                </div>
            </div>
            <ChatPanoptes />
        </div>
    );
}
