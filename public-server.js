import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { computeMarketStats } from './lib/market-stats.js';
import { createJsonApi } from './lib/json-api.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const DATA_PATH = path.join(__dirname, 'data', 'listings.json');
const SNAPSHOTS_PATH = path.join(__dirname, 'data', 'market-snapshots.json');
const FRONTEND_DIST = path.join(__dirname, 'frontend', 'dist');

const readJson = (file, fallback) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf-8')) : fallback);
const data = readJson(DATA_PATH);
const stats = computeMarketStats(data);

app.use(cors());

app.get('/kalkulator', (req, res) => {
  res.sendFile(path.join(__dirname, 'reality-calc.html'));
});

app.get('/api/stats', (req, res) => {
  res.set('Cache-Control', 'public, max-age=3600');
  res.json(stats);
});

app.use('/api', createJsonApi(data, readJson(SNAPSHOTS_PATH, { snapshots: [] })));

app.get('/data/listings.json', (req, res) => {
  res.sendFile(DATA_PATH);
});

app.use(express.static(FRONTEND_DIST));
app.get('*', (req, res) => {
  res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`✓ Realitní server na http://localhost:${PORT}`);
});
