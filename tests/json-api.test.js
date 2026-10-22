import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createJsonApi, filterListings, sortListings } from '../lib/json-api.js';

const l = (o) => ({
  city: 'praha', district: 'Praha 1', disposition: '2+kk', size_m2: 50, amenities: [],
  title: 'Prodej bytuPujmanové', photos: [], first_seen_at: '2026-09-01', price_per_m2: 100_000, ...o,
});

const data = {
  listings: [
    l({ url: 'a', price: 5_000_000, latitude: 50.08, longitude: 14.42, amenities: ['balkon', 'sklep'] }),
    l({ url: 'b', price: 7_000_000, disposition: '3+kk', first_seen_at: '2026-09-10', price_per_m2: null }),
    l({ url: 'c', price: 6_000_000, photos: ['https://x/video-play.webp', '//x/a.jpg', '/_next/image?url=https%3A%2F%2Fapi.x%2Fb.jpg&w=3840'] }),
    l({ url: 'd', price: 100_000 }),
    l({ url: 'e', price: 4_000_000, city: 'brno', district: 'Brno' }),
  ],
};

async function call(path) {
  const app = express().use('/api', createJsonApi(data));
  const server = app.listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`);
    return { status: res.status, body: await res.json() };
  } finally {
    server.close();
  }
}

test('filterListings applies city, price, disposition and amenity filters', () => {
  const ids = (q) => filterListings(data.listings, q).map((x) => x.url);
  assert.deepEqual(ids({ city: 'praha', maxPrice: '6000000' }), ['a', 'c', 'd']);
  assert.deepEqual(ids({ city: 'praha', dispositions: '3+kk' }), ['b']);
  assert.deepEqual(ids({ city: 'praha', amenities: 'balkon,sklep' }), ['a']);
  assert.deepEqual(ids({ city: 'brno' }), ['e']);
});

test('sortListings puts missing values last', () => {
  const sorted = sortListings(data.listings.slice(0, 3), 'price_m2_asc').map((x) => x.url);
  assert.equal(sorted.at(-1), 'b');
});

test('/listings drops implausible prices, cleans titles and photos, adds rating', async () => {
  const { body } = await call('/listings?city=praha&sortBy=price_asc');
  assert.equal(body.total, 3);
  assert.equal(body.listings[0].title, 'Prodej bytu Pujmanové');
  const c = body.listings.find((x) => x.url === 'c');
  assert.deepEqual(c.photos, ['https://x/a.jpg', 'https://api.x/b.jpg']);
  assert.ok(c.rating.label);
  assert.equal(c.yieldPct, null);
});

test('/listings/:id uses a stable id derived from the url', async () => {
  const { body } = await call('/listings?city=praha&limit=1&sortBy=price_asc');
  const id = body.listings[0].id;
  const detail = await call(`/listings/${id}`);
  assert.equal(detail.body.url, 'a');
  assert.equal((await call('/listings/nope')).status, 404);
});

test('/facets reports counts per listing type for the whole city', async () => {
  const { body } = await call('/facets?city=praha&listingType=byt');
  assert.deepEqual(body.listingTypeCounts, { byt: 3, novostavba: 0 });
});

test('/map returns only geolocated listings', async () => {
  const { body } = await call('/map/praha');
  assert.equal(body.length, 1);
  assert.equal(body[0].latitude, 50.08);
});
