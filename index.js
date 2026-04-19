require('dotenv').config();
const dns = require('dns');
// Forceer Node.js om IPv4 te verkiezen boven IPv6 om verbindingsfouten op Render te voorkomen
dns.setDefaultResultOrder('ipv4first');
const express = require('express');
const { Pool } = require('pg');
const { createCanvas } = require('canvas');
const SphericalMercator = require('@mapbox/sphericalmercator');

const app = express();
const merc = new SphericalMercator({ size: 256 });

// Database verbinding
// Gebruik de Pooler URL (eu-west-1 voor Ierland) om de IPv6-beperkingen van Render te omzeilen
const DATABASE_URL = process.env.DATABASE_URL || "postgresql://postgres:Beukenlaan2005!@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?pgbouncer=true";

if (!process.env.DATABASE_URL) {
    console.warn("Geen DATABASE_URL gevonden in Render settings, we gebruiken de handmatige eu-west-1 Pooler fallback.");
}

const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 10, // Voorkom dat we te veel verbindingen openen op de Pooler
});

pool.on('error', (err) => console.error('Onverwachte databasefout:', err));

// Health check / Welkomstpagina
app.get('/', (req, res) => {
    res.json({
        status: 'online',
        message: 'MapTrack Tile Server is Live!',
        endpoint: '/v1/heatmap/{z}/{x}/{y}.png'
    });
});

app.get('/v1/heatmap/:z/:x/:y.png', async (req, res) => {
    const z = parseInt(req.params.z);
    const x = parseInt(req.params.x);
    const y = parseInt(req.params.y);
    const filter = req.query.filter || 'all';

    // 1. Bereken de geografische Bounding Box van de tegel [w, s, e, n]
    const bbox = merc.bbox(x, y, z);

    try {
        // 2. Query PostGIS voor lijnen die de tegel snijden
        // We transformeren de geometrie naar GeoJSON coördinaten
        const query = `
            SELECT ST_AsGeoJSON(geom) as geojson, activity_type
            FROM ritten_heatmap 
            WHERE ST_Intersects(geom, ST_MakeEnvelope($1, $2, $3, $4, 4326))
            ${filter !== 'all' ? 'AND activity_type = $5' : ''}
        `;
        const values = filter !== 'all' ? [...bbox, filter] : bbox;
        const result = await pool.query(query, values);

        // 3. Initialiseer Canvas (256x256 is de standaard tegelgrootte)
        const canvas = createCanvas(256, 256);
        const ctx = canvas.getContext('2d');

        // Instellingen voor de 'glow' van de heatmap
        ctx.strokeStyle = '#9333EA'; // De MapTrack paarse kleur
        ctx.lineWidth = Math.max(0.5, z / 6); // Lijnen worden dikker naarmate je inzoomt
        ctx.globalAlpha = 0.4;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.shadowColor = '#9333EA';
        ctx.shadowBlur = 5;

        result.rows.forEach(row => {
            const geometry = JSON.parse(row.geojson);
            const coords = geometry.coordinates;

            ctx.beginPath();
            coords.forEach((p, i) => {
                // Map longitude/latitude naar 0-256 pixels binnen de tegel
                const px = ((p[0] - bbox[0]) / (bbox[2] - bbox[0])) * 256;
                const py = 256 - ((p[1] - bbox[1]) / (bbox[3] - bbox[1])) * 256;
                
                if (i === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            });
            ctx.stroke();
        });

        // 4. Verstuur als PNG
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache voor 1 uur
        canvas.createPNGStream().pipe(res);

    } catch (err) {
        console.error(`Render Fout [${z}/${x}/${y}]:`, err.message);
        res.status(500).send('Tile Rendering Error');
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Tile Server draait op http://localhost:${PORT}`);
});