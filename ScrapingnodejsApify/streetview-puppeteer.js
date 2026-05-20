/**
 * FALLBACK: Captura Street View de alta resolución usando Puppeteer
 * Se usa cuando Street View API devuelve baja resolución/insuficiente información
 */

const fs = require('fs');
const path = require('path');

let puppeteer;
try {
    puppeteer = require('puppeteer');
} catch (e) {
    console.warn('⚠️  Puppeteer no instalado. Instalar con: npm install puppeteer');
    puppeteer = null;
}

async function capturarStreetViewPuppeteer(nombreNegocio, direccion) {
    if (!puppeteer) {
        console.error('❌ Puppeteer no disponible. Instalar con: npm install puppeteer');
        return null;
    }

    console.log(`\n🎬 PUPPETEER FALLBACK: Capturando Street View de alta resolución...`);
    console.log(`   📍 ${nombreNegocio}`);
    console.log(`   📮 ${direccion}`);

    let browser;
    try {
        browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });

        // Navegar a Google Maps
        const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(direccion)}`;
        console.log(`   🌐 Abriendo: ${searchUrl}`);

        await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        await page.waitForTimeout(2000);

        // Buscar botón de Street View y hacer clic
        console.log(`   🔍 Buscando Street View...`);

        // Intentar hacer clic en icono de Street View
        const streetViewSelector = '[data-tooltip="Street View"]';
        const found = await page.$(streetViewSelector);

        if (!found) {
            console.log(`   ⚠️  No encontrado selector directo, intentando alternativa...`);
            // Alternativa: buscar dentro de la tarjeta de información
            await page.click('[role="button"][aria-label*="Street View"]').catch(() => null);
        } else {
            await page.click(streetViewSelector);
        }

        await page.waitForTimeout(3000);

        // Hacer zoom para ver más detalle
        console.log(`   🔎 Haciendo zoom...`);
        for (let i = 0; i < 3; i++) {
            await page.keyboard.press('Add');
            await page.waitForTimeout(500);
        }

        // Capturar screenshot
        const screenshot = await page.screenshot({ encoding: 'base64' });

        console.log(`   ✅ Captura exitosa`);
        return screenshot;

    } catch (error) {
        console.error(`   ❌ Error Puppeteer: ${error.message}`);
        return null;
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

module.exports = {
    capturarStreetViewPuppeteer,
    puppeteerDisponible: puppeteer !== null
};
