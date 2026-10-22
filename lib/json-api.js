import crypto from 'node:crypto';
import express from 'express';
import { AMENITIES } from '../backend/lib/filters.js';
import { enrichListing, MIN_COMPARABLE_SAMPLE } from '../backend/lib/pricing.js';

const MIN_PRICE = 500_000;
const MAP_LIMIT = 3000;
const CITY_LABELS = { praha: 'Praha', brno: 'Brno' };

const SORTS = {
  newest: ['first_seen_at', -1],
  oldest: ['first_seen_at', 1],
  price_asc: ['price', 1],
  price_desc: ['price', -1],
  price_m2_asc: ['price_per_m2', 1],
  price_m2_desc: ['price_per_m2', -1],
  size_asc: ['size_m2', 1],
  size_desc: ['size_m2', -1],
};

const stableId = (url) => crypto.createHash('sha1').update(url).digest('hex').slice(0, 12);

function photoUrl(p) {
  if (p.startsWith('//')) return `https:${p}`;
  if (p.startsWith('/_next/image')) return new URL(p, 'https://www.bezrealitky.cz').searchParams.get('url');
  return p.startsWith('http') ? p : null;
}

function cleanPhotos(photos = []) {
  return photos.filter((p) => p && !p.includes('video-play')).map(photoUrl).filter(Boolean);
}

const cleanTitle = (t = '') => t.replace(/\s+/g, ' ').replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2').trim();

function toListing(raw) {
  const { price_history, gps_source, enriched_at, last_scraped, ...rest } = raw;
  return {
    ...rest,
    id: stableId(raw.url),
    listing_type: raw.listing_type || 'byt',
    title: cleanTitle(raw.title),
    disposition: raw.disposition && raw.disposition !== 'null' ? raw.disposition : null,
    photos: cleanPhotos(raw.photos),
    amenities: raw.amenities || [],
    approx_location: gps_source === 'street_inference',
    priceHistory: (price_history || []).map((h) => ({ date: h.date, price: h.price, price_per_m2: h.price_per_m2 })),
  };
}

function median(sorted) {
  if (!sorted.length) return null;
  const mid = (sorted.length - 1) / 2;
  return (sorted[Math.floor(mid)] + sorted[Math.ceil(mid)]) / 2;
}

function groupMedians(items, keyFn) {
  const groups = new Map();
  for (const l of items) {
    const key = keyFn(l);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(l.price_per_m2);
  }
  const out = new Map();
  for (const [key, values] of groups) {
    values.sort((a, b) => a - b);
    out.set(key, { median_price_per_m2: median(values), sample_size: values.length });
  }
  return out;
}

function comparableMedians(items) {
  const priced = items.filter((l) => l.price_per_m2);
  return {
    districtDisposition: groupMedians(priced, (l) => `${l.district}|${l.disposition}`),
    district: groupMedians(priced, (l) => l.district),
    disposition: groupMedians(priced, (l) => l.disposition),
    cityWide: groupMedians(priced, () => 'all').get('all'),
  };
}

function pickComparable(medians, listing) {
  const cityLabel = CITY_LABELS[listing.city] || listing.city;
  const candidates = [
    { row: medians.districtDisposition.get(`${listing.district}|${listing.disposition}`), basis: `${listing.disposition} v lokalitě ${listing.district}` },
    { row: medians.district.get(listing.district), basis: `nemovitosti v lokalitě ${listing.district}` },
    { row: medians.disposition.get(listing.disposition), basis: `${listing.disposition} — ${cityLabel}` },
    { row: medians.cityWide, basis: `celý trh — ${cityLabel}` },
  ];
  for (const c of candidates) {
    if (c.row && c.row.sample_size >= MIN_COMPARABLE_SAMPLE) return { ...c.row, basis: c.basis };
  }
  return {};
}

// The top 1 % is clipped so a single 400M listing doesn't squash the slider.
// Untouched sliders send no filter, so clipped listings still show up.
function histogram(values, buckets = 40) {
  const sorted = values.map(Number).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (!sorted.length) return { min: 0, max: 0, bins: [] };
  const min = sorted[0];
  const max = sorted[Math.floor((sorted.length - 1) * 0.99)];
  const nums = sorted.filter((n) => n <= max);
  if (min === max) return { min, max, bins: [nums.length] };
  const width = (max - min) / buckets;
  const bins = new Array(buckets).fill(0);
  for (const n of nums) bins[Math.min(buckets - 1, Math.floor((n - min) / width))] += 1;
  return { min, max, bins };
}

const asList = (v) => {
  if (v == null || v === '') return null;
  const list = (Array.isArray(v) ? v : String(v).split(',')).map((s) => String(s).trim()).filter(Boolean);
  return list.length ? list : null;
};
const asBool = (v) => v === true || v === 'true' || v === '1';
const num = (v) => (v === undefined || v === '' ? null : Number(v));

export function filterListings(listings, q = {}) {
  const city = q.city || 'praha';
  const range = (field, lo, hi) => (l) =>
    (lo == null || (l[field] != null && l[field] >= lo)) && (hi == null || (l[field] != null && l[field] <= hi));
  const inList = (field, list) => (l) => !list || list.includes(String(l[field]));

  const tests = [
    (l) => l.city === city,
    (l) => !q.listingType || l.listing_type === q.listingType,
    range('price', num(q.minPrice), num(q.maxPrice)),
    range('price_per_m2', num(q.minPricePerM2), num(q.maxPricePerM2)),
    range('size_m2', num(q.minSize), num(q.maxSize)),
    inList('disposition', asList(q.dispositions)),
    inList('building_type', asList(q.buildingTypes)),
    inList('condition', asList(q.conditions)),
    inList('completion_year', asList(q.completionYears)),
    inList('district', asList(q.districts)),
    inList('source_name', asList(q.sources)),
  ];
  const amenities = (asList(q.amenities) || []).filter((a) => AMENITIES.includes(a));
  if (amenities.length) tests.push((l) => amenities.every((a) => l.amenities.includes(a)));
  if (asBool(q.tenementOnly)) tests.push((l) => l.is_tenement);
  if (asBool(q.discountedOnly)) tests.push((l) => l.is_discounted);

  return listings.filter((l) => tests.every((t) => t(l)));
}

export function sortListings(listings, sortBy) {
  const [field, dir] = SORTS[sortBy] || SORTS.newest;
  return listings.slice().sort((a, b) => {
    const x = a[field];
    const y = b[field];
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return (x < y ? -1 : x > y ? 1 : 0) * dir;
  });
}

function countBy(items, field) {
  const counts = new Map();
  for (const l of items) {
    const v = l[field];
    if (v == null || v === '') continue;
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  return [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);
}

function monthlyPayment(principal, annualRatePct, years) {
  const r = annualRatePct / 100 / 12;
  const n = years * 12;
  if (r === 0) return principal / n;
  return (principal * (r * Math.pow(1 + r, n))) / (Math.pow(1 + r, n) - 1);
}

export function createJsonApi(data, snapshotsData = { snapshots: [] }) {
  const listings = data.listings.filter((l) => l.city && l.url && l.price >= MIN_PRICE).map(toListing);
  const byId = new Map(listings.map((l) => [l.id, l]));
  const mediansByCity = new Map();
  for (const city of new Set(listings.map((l) => l.city))) {
    mediansByCity.set(city, comparableMedians(listings.filter((l) => l.city === city)));
  }

  const strip = ({ priceHistory, description, ...rest }) => rest;
  const enrich = (l) => enrichListing(l, pickComparable(mediansByCity.get(l.city), l), null);

  const router = express.Router();
  router.use(express.json());

  router.get('/health', (req, res) => res.json({ status: 'ok', listings: listings.length }));

  router.get('/listings', (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 48, 200);
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const matches = sortListings(filterListings(listings, req.query), req.query.sortBy);
    res.json({
      total: matches.length,
      limit,
      offset,
      listings: matches.slice(offset, offset + limit).map((l) => enrich(strip(l))),
    });
  });

  router.get('/facets', (req, res) => {
    const city = req.query.city || 'praha';
    const inCity = listings.filter((l) => l.city === city);
    const base = inCity.filter((l) => !req.query.listingType || l.listing_type === req.query.listingType);
    const amenities = {};
    for (const a of AMENITIES) amenities[a] = base.filter((l) => l.amenities.includes(a)).length;
    res.json({
      dispositions: countBy(base, 'disposition'),
      buildingTypes: countBy(base, 'building_type'),
      conditions: countBy(base, 'condition'),
      districts: countBy(base, 'district'),
      sources: countBy(base, 'source_name'),
      completionYears: countBy(base, 'completion_year').sort((a, b) => a.value - b.value),
      amenities,
      priceHistogram: histogram(base.map((l) => l.price)),
      sizeHistogram: histogram(base.map((l) => l.size_m2)),
      pricePerM2Histogram: histogram(base.map((l) => l.price_per_m2)),
      tenementCount: base.filter((l) => l.is_tenement).length,
      discountedCount: base.filter((l) => l.is_discounted).length,
      total: base.length,
      listingTypeCounts: {
        byt: inCity.filter((l) => l.listing_type === 'byt').length,
        novostavba: inCity.filter((l) => l.listing_type === 'novostavba').length,
      },
    });
  });

  router.get('/stats/:city/medians', (req, res) => {
    const items = listings.filter((l) => l.city === req.params.city && l.price_per_m2
      && (!req.query.listingType || l.listing_type === req.query.listingType));
    if (!items.length) return res.json({});
    const prices = items.map((l) => l.price).sort((a, b) => a - b);
    const ppm2 = items.map((l) => l.price_per_m2).sort((a, b) => a - b);
    const sizes = items.map((l) => l.size_m2).filter(Boolean);
    res.json({
      median_price: median(prices),
      median_price_per_m2: median(ppm2),
      min_price: prices[0],
      min_price_per_m2: ppm2[0],
      avg_size_m2: sizes.reduce((s, v) => s + v, 0) / sizes.length,
      total_listings: items.length,
    });
  });

  router.get('/stats/:city/trend', (req, res) => {
    const { city } = req.params;
    const { district, listingType = 'byt' } = req.query;
    const series = snapshotsData.snapshots
      .filter((s) => s.city === city && s.listing_type === listingType && (district ? s.district === district : !s.district))
      .sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date))
      .map((s) => ({ date: s.snapshot_date, median_price_per_m2: s.median_price_per_m2, median_price: s.median_price, sample_size: s.sample_size }));
    let changePct = null;
    if (series.length > 1 && series[0].median_price_per_m2 > 0) {
      const first = series[0].median_price_per_m2;
      changePct = Number((((series.at(-1).median_price_per_m2 - first) / first) * 100).toFixed(1));
    }
    res.json({ city, district: district || null, current: series.at(-1)?.median_price_per_m2 ?? null, changePct, series });
  });

  router.get('/map/:city', (req, res) => {
    const matches = sortListings(
      filterListings(listings, { ...req.query, city: req.params.city }).filter((l) => l.latitude && l.longitude),
      'newest',
    ).slice(0, MAP_LIMIT);
    res.json(matches.map((l) => {
      const { rating } = enrich(l);
      return {
        id: l.id, price: l.price, price_per_m2: l.price_per_m2, size_m2: l.size_m2,
        disposition: l.disposition, latitude: l.latitude, longitude: l.longitude, address: l.address,
        rating: { label: rating.label, color: rating.color },
      };
    }));
  });

  router.get('/listings/:id', (req, res) => {
    const listing = byId.get(req.params.id);
    if (!listing) return res.status(404).json({ error: 'Inzerát už není v nabídce' });
    res.json(enrich(listing));
  });

  router.get('/listings/:id/price-trend', (req, res) => {
    const listing = byId.get(req.params.id);
    if (!listing) return res.status(404).json({ error: 'Inzerát už není v nabídce' });
    res.json(listing.priceHistory);
  });

  router.post('/calculator/mortgage', (req, res) => {
    const { propertyPrice, downPayment = 0, interestRate = 4.9, loanTerm = 30 } = req.body || {};
    if (!propertyPrice || propertyPrice <= 0) return res.status(400).json({ error: 'propertyPrice je povinná a musí být kladná' });
    if (downPayment < 0 || downPayment >= propertyPrice) return res.status(400).json({ error: 'downPayment musí být mezi 0 a cenou nemovitosti' });
    const principal = propertyPrice - downPayment;
    const payment = monthlyPayment(principal, interestRate, loanTerm);
    const totalPaid = payment * loanTerm * 12;
    res.json({
      principal: Math.round(principal),
      monthlyPayment: Math.round(payment),
      totalPayment: Math.round(totalPaid),
      totalInterest: Math.round(totalPaid - principal),
      downPaymentPercent: Number(((downPayment / propertyPrice) * 100).toFixed(1)),
      ltv: Number(((principal / propertyPrice) * 100).toFixed(1)),
      ltvWarning: principal / propertyPrice > 0.8,
    });
  });

  router.post('/calculator/affordability', (req, res) => {
    const { monthlyIncome, propertyPrice, downPayment = 0, interestRate = 4.9, loanTerm = 30, monthlyDebts = 0 } = req.body || {};
    if (!monthlyIncome || monthlyIncome <= 0) return res.status(400).json({ error: 'monthlyIncome je povinný a musí být kladný' });
    if (!propertyPrice || propertyPrice <= 0) return res.status(400).json({ error: 'propertyPrice je povinná a musí být kladná' });
    const payment = monthlyPayment(Math.max(0, propertyPrice - downPayment), interestRate, loanTerm);
    const dsti = ((payment + monthlyDebts) / monthlyIncome) * 100;
    const affordable = dsti <= 45;
    res.json({
      monthlyPayment: Math.round(payment),
      dsti: Number(dsti.toFixed(1)),
      affordable,
      yearsOfIncome: Number((propertyPrice / (monthlyIncome * 12)).toFixed(1)),
      recommendation: affordable
        ? 'Splátka se vejde do běžného limitu bank (DSTI do 45 %).'
        : 'Splátka překračuje běžný limit bank (DSTI nad 45 %). Zvyš vlastní zdroje nebo hledej levnější nemovitost.',
    });
  });

  return router;
}
