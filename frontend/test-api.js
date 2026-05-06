// Test script to verify API endpoints are working correctly
const API = 'http://127.0.0.1:8001';

async function testResumen() {
    try {
        const res = await fetch(`${API}/mapa/resumen`);
        const data = await res.json();
        console.log('✅ /mapa/resumen response:', JSON.stringify(data, null, 2));
    } catch (e) {
        console.error('❌ Error fetching /mapa/resumen:', e.message);
    }
}

async function testFiltros() {
    try {
        const res = await fetch(`${API}/mapa/filtros`);
        const data = await res.json();
        console.log('✅ /mapa/filtros response:', JSON.stringify(data, null, 2));
    } catch (e) {
        console.error('❌ Error fetching /mapa/filtros:', e.message);
    }
}

async function testNegocios() {
    try {
        const res = await fetch(`${API}/mapa/negocios?limite=5`);
        const data = await res.json();
        console.log('✅ /mapa/negocios response (first 5):', JSON.stringify(data, null, 2));
    } catch (e) {
        console.error('❌ Error fetching /mapa/negocios:', e.message);
    }
}

async function runTests() {
    console.log('Testing API endpoints...\n');
    await testFiltros();
    console.log('\n');
    await testResumen();
    console.log('\n');
    await testNegocios();
}

runTests();
