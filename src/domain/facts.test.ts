import { describe, expect, test } from 'vitest';
import {
  ALL_STATES, CONTRACT_VIEWS, POSITIONS, STATE_COUNT, basketCoverage, contractView,
  costCents, exactGroupOffsets, exposureSummary, payoffOf, payoutCents, portfolioAt,
  rankedOffsets, relationsAmong,
} from './engine';

const heldIds = [...new Set(POSITIONS.map((p) => p.contract_id))];
const graphIds = CONTRACT_VIEWS
  .filter((v) => v.authored.claim && !v.degenerate && heldIds.includes(v.contract.contract_id))
  .map((v) => v.contract.contract_id);
const byName = (n: string) =>
  CONTRACT_VIEWS.find((v) => v.authored.shortName === n)!.contract.contract_id;

describe('portfolio shape', () => {
  test('18 positions over 17 contracts, as the header claims', () => {
    expect(POSITIONS.length).toBe(18);
    expect(heldIds.length).toBe(17);
  });
});

describe('every relation the graph draws is true in every world', () => {
  const relations = relationsAmong(graphIds);
  test('implication: a never pays where b does not', () => {
    for (const r of relations.filter((x) => x.kind === 'IMPLICATION')) {
      const [a, b] = [payoffOf(r.a), payoffOf(r.b)];
      for (let i = 0; i < STATE_COUNT; i += 1) expect(a[i] <= b[i]).toBe(true);
    }
  });
  test('exclusivity: never both', () => {
    for (const r of relations.filter((x) => x.kind === 'EXCLUSIVITY')) {
      const [a, b] = [payoffOf(r.a), payoffOf(r.b)];
      for (let i = 0; i < STATE_COUNT; i += 1) expect(a[i] * b[i]).toBe(0);
    }
  });
  test('overlap: they really do share a world, and really do differ', () => {
    for (const r of relations.filter((x) => x.kind === 'OVERLAP')) {
      const [a, b] = [payoffOf(r.a), payoffOf(r.b)];
      let both = 0, only = 0;
      for (let i = 0; i < STATE_COUNT; i += 1) {
        if (a[i] && b[i]) both += 1;
        if (a[i] !== b[i]) only += 1;
      }
      expect(both).toBeGreaterThan(0);
      expect(only).toBeGreaterThan(0);
    }
  });
  test('the counts shown in the rail', () => {
    const count = (k: string) => relations.filter((r) => r.kind === k).length;
    expect({
      IDENTITY: count('IDENTITY'), COMPLEMENT: count('COMPLEMENT'),
      IMPLICATION: count('IMPLICATION'), EXCLUSIVITY: count('EXCLUSIVITY'), OVERLAP: count('OVERLAP'),
    }).toEqual({ IDENTITY: 0, COMPLEMENT: 0, IMPLICATION: 15, EXCLUSIVITY: 25, OVERLAP: 96 });
  });
});

describe('the five October brackets', () => {
  const ids = ['Oct -50+', 'Oct -25', 'Oct hold', 'Oct +25', 'Oct +50+'].map(byName);
  test('exactly one pays in every one of the 2,187 worlds', () => {
    for (let i = 0; i < STATE_COUNT; i += 1) {
      expect(ids.reduce((n, id) => n + payoffOf(id)[i], 0)).toBe(1);
    }
  });
  test('the basket panel calls it a partition', () => {
    const basket = basketCoverage(ids, POSITIONS);
    expect(basket.klass).toBe('PARTITION');
    expect(basket.worldsPaying[1]).toBe(STATE_COUNT);
  });
  test('held together they pay $100,000 flat, having cost $100,900', () => {
    const legs = POSITIONS.filter((p) => ids.includes(p.contract_id));
    expect(legs.length).toBe(5);
    const totals = new Set(
      Array.from({ length: STATE_COUNT }, (_, i) => legs.reduce((s, p) => s + payoutCents(p, i), 0)),
    );
    expect([...totals]).toEqual([10_000_000]);
    expect(legs.reduce((s, p) => s + costCents(p), 0)).toBe(10_090_000);
  });
  test('the strip agrees', () => {
    const group = exactGroupOffsets(POSITIONS).find((g) => g.positions.length === 5)!;
    expect(group.constantPayoutCents).toBe(10_000_000);
  });
});

describe('headline risk is the true extreme over every world', () => {
  test('worst and best match a brute-force sweep', () => {
    let worst = Infinity, best = -Infinity;
    for (let i = 0; i < STATE_COUNT; i += 1) {
      const pnl = portfolioAt(POSITIONS, i).pnlCents;
      worst = Math.min(worst, pnl);
      best = Math.max(best, pnl);
    }
    const summary = exposureSummary(POSITIONS);
    expect(summary.worst.pnlCents).toBe(worst);
    expect(summary.best.pnlCents).toBe(best);
    expect(worst).toBe(-72_518_000);
    expect(best).toBe(52_482_000);
  });
});

describe('offset classification', () => {
  const offsets = rankedOffsets(POSITIONS);
  test('an EXACT offset really is flat, a NONE really does not reduce the swing', () => {
    for (const o of offsets) {
      const combined = Array.from({ length: STATE_COUNT }, (_, i) => payoutCents(o.a, i) + payoutCents(o.b, i));
      const range = Math.max(...combined) - Math.min(...combined);
      const swing = (p: typeof o.a) => {
        const v = Array.from({ length: STATE_COUNT }, (_, i) => payoutCents(p, i));
        return Math.max(...v) - Math.min(...v);
      };
      const larger = Math.max(swing(o.a), swing(o.b));
      if (o.klass === 'EXACT') expect(range).toBe(0);
      if (o.klass === 'NONE') expect(range).toBeGreaterThanOrEqual(larger);
    }
  });
  test('a pair flagged misleading is one that reads as a hedge and is not', () => {
    for (const o of offsets.filter((x) => x.misleading)) {
      expect(o.klass === 'CONDITIONAL' || o.klass === 'NONE' || o.klass === 'PARTIAL').toBe(true);
      expect(o.failures.length).toBeGreaterThan(0);
    }
  });
});

describe('world enumeration', () => {
  test('2,187 worlds, and every one distinct', () => {
    expect(STATE_COUNT).toBe(2187);
    expect(ALL_STATES.length).toBe(2187);
    expect(new Set(ALL_STATES.map((s) => JSON.stringify(s))).size).toBe(2187);
  });
  test('every held contract is interpreted', () => {
    for (const id of heldIds) expect(contractView(id).authored.claim).not.toBeNull();
  });
});
