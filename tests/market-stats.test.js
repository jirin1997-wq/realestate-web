import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeMarketStats, quantile } from '../lib/market-stats.js';

const listing = (o) => ({ city: 'praha', district: 'Praha 1', disposition: '2+kk', size_m2: 50, ...o });

test('quantile interpolates between neighbours', () => {
  assert.equal(quantile([1, 2, 3, 4], 0.5), 3);
  assert.equal(quantile([10, 20], 0.5), 15);
  assert.equal(quantile([], 0.5), null);
});

test('computeMarketStats groups by city and district, drops implausible prices', () => {
  const stats = computeMarketStats({
    updated_at: '2026-09-19',
    listings: [
      listing({ price: 4_000_000, price_per_m2: 80_000 }),
      listing({ price: 6_000_000, price_per_m2: 120_000 }),
      listing({ price: 8_000_000, price_per_m2: 160_000, district: 'Praha 2', disposition: '3+kk' }),
      listing({ price: 100_000, price_per_m2: 2_000 }),
      listing({ price: 5_000_000, price_per_m2: 100_000, city: 'brno', district: 'Brno' }),
    ],
  });

  const praha = stats.cities.praha;
  assert.equal(praha.count, 3);
  assert.equal(praha.median_price, 6_000_000);
  assert.equal(praha.median_ppm2, 120_000);
  assert.equal(stats.cities.brno.count, 1);

  const p1 = praha.districts.find((d) => d.name === 'Praha 1');
  assert.equal(p1.count, 2);
  assert.equal(p1.n_2kk, 2);
  assert.deepEqual(p1.prices_k, [4000, 6000]);
  assert.equal(p1.generic, false);
  assert.equal(stats.cities.brno.districts[0].generic, true);
  assert.equal(praha.dispositions.find((d) => d.name === '3+kk').median_price, 8_000_000);
});
