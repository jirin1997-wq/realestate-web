import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { computeMarketStats } from './lib/market-stats.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const DATA_PATH = path.join(__dirname, 'data', 'listings.json');

const stats = computeMarketStats(JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8')));

app.use(cors());

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'reality-calc.html'));
});

app.get('/api/stats', (req, res) => {
  res.set('Cache-Control', 'public, max-age=3600');
  res.json(stats);
});

app.get('/data/listings.json', (req, res) => {
  res.sendFile(DATA_PATH);
});

app.listen(PORT, () => {
  console.log(`✓ Realitní server na http://localhost:${PORT}`);
});
