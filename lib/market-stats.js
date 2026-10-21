const MIN_PRICE = 500_000;
const MIN_PPM2 = 30_000;
const GENERIC_DISTRICTS = new Set(['Praha', 'Hlavní město Praha', 'Brno', 'Jihomoravský kraj']);

export function quantile(sorted, p) {
  if (!sorted.length) return null;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo));
}

const sortNum = (arr) => arr.slice().sort((a, b) => a - b);

function summarize(items) {
  const prices = sortNum(items.map((l) => l.price));
  const ppm2 = sortNum(items.map((l) => l.price_per_m2).filter((v) => v >= MIN_PPM2));
  const sizes = sortNum(items.map((l) => l.size_m2).filter(Boolean));
  return {
    count: items.length,
    median_price: quantile(prices, 0.5),
    p25_price: quantile(prices, 0.25),
    p75_price: quantile(prices, 0.75),
    median_ppm2: quantile(ppm2, 0.5),
    median_size: quantile(sizes, 0.5),
    prices,
  };
}

function groupBy(items, key) {
  const groups = new Map();
  for (const item of items) {
    const k = item[key];
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(item);
  }
  return groups;
}

export function computeMarketStats(data) {
  const valid = data.listings.filter((l) => l.city && l.price >= MIN_PRICE);
  const cities = {};

  for (const [city, items] of groupBy(valid, 'city')) {
    const { prices, ...overall } = summarize(items);

    const districts = [...groupBy(items, 'district')].map(([name, group]) => {
      const { prices: dPrices, ...s } = summarize(group);
      const twoKk = sortNum(group.filter((l) => l.disposition === '2+kk').map((l) => l.price));
      return {
        name,
        generic: GENERIC_DISTRICTS.has(name),
        ...s,
        n_2kk: twoKk.length,
        p25_2kk: quantile(twoKk, 0.25),
        p75_2kk: quantile(twoKk, 0.75),
        prices_k: dPrices.map((p) => Math.round(p / 1000)),
      };
    });

    const dispositions = [...groupBy(items, 'disposition')]
      .filter(([name]) => name !== 'null')
      .map(([name, group]) => {
        const { prices, ...s } = summarize(group);
        return { name, ...s, prices_k: prices.map((p) => Math.round(p / 1000)) };
      });

    cities[city] = { ...overall, districts, dispositions };
  }

  return { updated_at: data.updated_at, cities };
}
