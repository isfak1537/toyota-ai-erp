// Small deterministic PRNG (mulberry32 seeded from an FNV-1a hash of string
// keys). A plain function, no dependency. Every generator stream is derived
// from the master seed plus a descriptive key, so adding a product or a
// warehouse never reshuffles the numbers drawn for the others (SEED-006).

const hashString = (text) => {
  let hash = 0x811c9dc5;

  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }

  // final avalanche so that similar keys give unrelated streams
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;

  return hash >>> 0;
};

const mulberry32 = (seed) => {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

class Rng {
  constructor(...keys) {
    this.nextFloat = mulberry32(hashString(keys.join("|")));
  }

  next() {
    return this.nextFloat();
  }

  // integer in [min, max], both inclusive
  int(min, max) {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  chance(probability) {
    return this.next() < probability;
  }

  pick(items) {
    return items[this.int(0, items.length - 1)];
  }

  gauss() {
    const u = Math.max(this.next(), 1e-12);
    const v = this.next();

    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  // Knuth for small means, rounded normal approximation for large ones
  poisson(lambda) {
    if (!(lambda > 0)) {
      return 0;
    }

    if (lambda >= 30) {
      return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * this.gauss()));
    }

    const limit = Math.exp(-lambda);
    let k = 0;
    let product = 1;

    do {
      k += 1;
      product *= this.next();
    } while (product > limit);

    return k - 1;
  }

  shuffle(items) {
    const copy = [...items];

    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = this.int(0, i);
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }

    return copy;
  }
}

module.exports = { Rng, hashString };
