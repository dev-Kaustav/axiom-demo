import { describe, expect, it } from 'vitest';
import { data, presets, portfolio, payoffs, facts, modeledStates, relationships, relationshipHolds, structuralChecks, markPnl, sum, positionResult, byId } from './engine';

describe('frozen portfolio arithmetic', () => {
  it('matches independently calculated payout and P&L for all presets', () => {
    const expected = [[280000, 3850], [375000, 98850], [430000, 153850], [90000, -186150], [250000, -26150], [280000, 3850]];
    presets.forEach((preset, idx) => {
      const result = portfolio(preset.state);
      expect(result.cost).toBe(276150);
      expect([result.payout, result.pnl]).toEqual(expected[idx]);
      preset.expected_truths.forEach(id => expect(result.truth[id]).toBe(1));
    });
  });
  it('values held NO shares at the complementary snapshot mark', () => {
    expect(sum(data.portfolio.positions.map(markPnl))).toBe(31550);
    expect(markPnl(data.portfolio.positions[2])).toBe(-3600);
  });
  it('retains duplicate positions rather than discarding their quantity', () => {
    const p = data.portfolio.positions[0];
    const duplicated = portfolio(presets[0].state, [p, p]);
    expect(duplicated.payout).toBe(360000);
    expect(duplicated.cost).toBe(176400);
  });
  it('keeps terminal payout separate from cost and P&L for NO', () => {
    const p = data.portfolio.positions[2];
    expect(positionResult(p, payoffs(presets[3].state))).toEqual({ cost: 16200, payout: 90000, pnl: 73800, payoutPerUnit: 1 });
  });
});

describe('settlement semantics', () => {
  it('preserves emergency-action differences', () => {
    const before = payoffs(presets[3].state), after = payoffs(presets[4].state);
    expect(before.ins_path_hpp).toBe(1);
    expect(after.ins_path_hpp).toBe(1);
    expect(before.ins_another_hike).toBe(0);
    expect(after.ins_another_hike).toBe(1);
  });
  it('does not apply late hikes to contracts whose window already closed', () => {
    const s = { ...presets[3].state, post_dec_meeting_hike_units_through_dec31: 1 };
    const p = payoffs(s);
    expect(p.ins_another_hike).toBe(0);
    expect(p.ins_hike_count_1).toBe(0);
    expect(p.ins_hike_count_2).toBe(1);
    expect(p.ins_eoy_400).toBe(1);
    expect(p.ins_hit_425).toBe(1);
  });
  it('distinguishes terminal rate from a path threshold', () => {
    const p = payoffs(presets[5].state);
    expect(p.ins_eoy_400).toBe(1);
    expect(p.ins_eoy_425).toBe(0);
    expect(p.ins_hit_425).toBe(1);
    expect(p.ins_hit_450).toBe(0);
  });
  it('counts hike units rather than meetings and does not net cuts', () => {
    const s = { ...presets[0].state, october_change_bucket: 'HIKE_50_PLUS' as const, december_change_bucket: 'CUT_25' as const };
    expect(facts(s).annual).toBe(3);
    expect(facts(s).terminal).toBe(425);
  });
  it('refuses values outside the supported scenario domain', () => {
    expect(() => facts({ ...presets[0].state, post_dec_meeting_hike_units_through_dec31: 7 })).toThrow();
    expect(() => facts({ ...presets[0].state, post_dec_meeting_hike_units_through_dec31: 1.5 })).toThrow();
  });
});

describe('constraints and snapshot calculations', () => {
  it('verifies all supplied constraints and the count partition in every demo trajectory', () => {
    expect(modeledStates).toHaveLength(350);
    for (const state of modeledStates) {
      const p = payoffs(state);
      expect(Object.keys(p)).toHaveLength(27);
      expect(Object.values(p).every(v => v === 0 || v === 1)).toBe(true);
      for (const r of relationships) expect(relationshipHolds(r, p), r.id).toBe(true);
    }
  });
  it('derives snapshot residuals rather than copying fixture totals', () => {
    expect(structuralChecks().map(c => c.delta)).toEqual([0, 2.7, 3, 3.5, 52]);
    const old = byId.ins_path_hhh.snapshot_mark;
    byId.ins_path_hhh.snapshot_mark = old + .01;
    try { expect(structuralChecks()[0].delta).toBe(-1); expect(structuralChecks()[2].delta).toBe(4); }
    finally { byId.ins_path_hhh.snapshot_mark = old; }
  });
  it('does not treat the selected terminal-rate contracts as an exhaustive partition', () => {
    const p = payoffs({ ...presets[3].state, october_change_bucket: 'CUT_50_PLUS', december_change_bucket: 'CUT_25' });
    expect(sum(Object.entries(p).filter(([id]) => id.startsWith('ins_eoy')).map(([, v]) => v))).toBe(0);
  });
});
