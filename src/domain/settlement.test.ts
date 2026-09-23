// The model must agree with the venue about contracts that have already
// settled. This is the one correctness check that cannot be gamed by reading
// goldens out of the system: the expected values were published by Polymarket
// before this code existed.
import { describe, expect, it } from 'vitest';
import universe from '../data/universe/universe.json';
import { AUTHORED } from './claims';
import { BASIS_SUMMARY, DEGENERATE, PAYOFFS, STATE_COUNT, SUPPORTED } from './basis';
import { basketCoverage, relationsAmong } from './relations';

type Raw = { contract_id: string; event_id: string; group_item_title: string | null; closed: boolean; resolution: { resolved_outcome: string | null } };
const byId = new Map((universe.contracts as Raw[]).map((c) => [c.contract_id, c]));

const settled = SUPPORTED.filter((a) => {
  const c = byId.get(a.contract_id);
  return Boolean(c?.closed && c.resolution.resolved_outcome);
});

describe('settled contracts', () => {
  it('there are some to check', () => {
    expect(settled.length).toBeGreaterThan(5);
  });

  it.each(settled.map((a) => [`${byId.get(a.contract_id)!.event_id} ${byId.get(a.contract_id)!.group_item_title}`, a.contract_id] as const))(
    'reproduces the venue resolution of %s',
    (_label, contractId) => {
      const raw = byId.get(contractId)!;
      const column = PAYOFFS.get(contractId)!;
      const distinct = new Set(column);
      // A settled contract must be determinate everywhere in the modelled space.
      expect([...distinct]).toHaveLength(1);
      expect(column[0]).toBe(raw.resolution.resolved_outcome === 'Yes' ? 1 : 0);
    },
  );
});

describe('basis shape', () => {
  it('enumerates the declared state space', () => {
    expect(STATE_COUNT).toBe(3 * 9 * 3 * 9 * 3);
  });
  it('collapses to fewer scenarios than raw worlds', () => {
    expect(BASIS_SUMMARY.basisScenarioCount).toBeLessThan(STATE_COUNT);
  });
  it('every supported contract has a payoff vector of the right length', () => {
    for (const a of SUPPORTED) expect(PAYOFFS.get(a.contract_id)).toHaveLength(STATE_COUNT);
  });
  it('degenerate columns are excluded from the discriminating set', () => {
    expect(BASIS_SUMMARY.discriminatingContracts).toBe(SUPPORTED.length - DEGENERATE.length);
  });
  it('separates settled degenerates from ones outside the declared alphabet', () => {
    // Conflating these would report a scope limit of the model as a certainty.
    expect(BASIS_SUMMARY.degenerateSettled).toBeGreaterThan(0);
    expect(BASIS_SUMMARY.degenerateSettled + BASIS_SUMMARY.degenerateOutOfAlphabet).toBe(DEGENERATE.length);
    for (const d of DEGENERATE) expect(d.reason.length).toBeGreaterThan(20);
  });
  it('authors every contract or refuses it explicitly', () => {
    for (const a of AUTHORED) {
      if (a.claim === null) expect(a.status).toBe('UNSUPPORTED');
      expect(a.rationale.length).toBeGreaterThan(20);
    }
  });
});

// A selection made on the full-universe canvas can include contracts this model
// never interpreted. The basket check has to survive that and report which
// contracts it could not count, because an answer computed over a subset of the
// selection is not an answer about the selection.
describe('baskets over uninterpretable contracts', () => {
  const refused = AUTHORED.filter((a) => a.claim === null).map((a) => a.contract_id);
  const supported = SUPPORTED.map((a) => a.contract_id);

  it('there are refused contracts to select', () => {
    expect(refused.length).toBeGreaterThan(0);
  });

  it('excludes a refused contract instead of throwing', () => {
    const basket = basketCoverage([supported[0], refused[0]], []);
    expect(basket.ids).toEqual([supported[0]]);
    expect(basket.excludedIds).toEqual([refused[0]]);
    expect(basket.klass).not.toBe('UNCOMPUTED');
  });

  it('computes nothing at all when no member carries a claim', () => {
    const basket = basketCoverage(refused.slice(0, 3), []);
    expect(basket.klass).toBe('UNCOMPUTED');
    expect(basket.ids).toHaveLength(0);
    expect(basket.excludedIds).toHaveLength(3);
    // No world counts, so no bars: an empty distribution, not a zeroed one.
    expect(basket.worldsPaying).toEqual([]);
  });

  it('derives no relation for a refused contract', () => {
    expect(relationsAmong([supported[0], refused[0]])).toEqual([]);
  });
});
