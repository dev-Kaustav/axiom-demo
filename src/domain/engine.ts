import data from '../data/fed-demo.json';
import semantics from '../data/semantic-constraints.json';

export { data, semantics };
export type Instrument = typeof data.instruments[number];
export type Position = typeof data.portfolio.positions[number];
export const buckets = ['CUT_50_PLUS', 'CUT_25', 'HOLD', 'HIKE_25', 'HIKE_50_PLUS'] as const;
export type Bucket = typeof buckets[number];
export type Scenario = {
  october_change_bucket: Bucket;
  december_change_bucket: Bucket;
  emergency_hike_sep17_through_dec_meeting: boolean;
  post_dec_meeting_hike_units_through_dec31: number;
};
export const bucketLabels: Record<Bucket, string> = { CUT_50_PLUS: '−50 bp representative', CUT_25: '−25 bp', HOLD: 'Hold', HIKE_25: '+25 bp', HIKE_50_PLUS: '+50 bp representative' };
export const presets = data.scenario_presets.map(s => ({ ...s, state: s.state as Scenario }));
export const byId = Object.fromEntries(data.instruments.map(i => [i.instrument_id, i]));
export const familyName = (id: string) => id.includes('path') ? 'FOMC path' : id.includes('count') ? 'Hike count' : 'Rate level';
export const instrumentName = (id: string) => ({ ins_oct_hike_25: 'October · +25 bp hike', ins_path_hph: 'September–December · Hike / Pause / Hike', ins_another_hike: 'Another Fed rate hike in 2026', ins_eoy_425: 'Year-end upper bound · 4.25%', ins_hit_425: 'Rate reaches 4.25% or higher' }[id] ?? byId[id]?.short_name ?? id);
export const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
export const money = (n: number, signed = false) => `${n < 0 ? '−' : signed && n > 0 ? '+' : ''}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
export const compact = (n: number) => `${n < 0 ? '−' : n > 0 ? '+' : ''}${(Math.abs(n) / 1000).toFixed(1)}k`;
export const price = (n: number) => `${Number((n * 100).toFixed(1))}¢`;
export const percent = (n: number) => `${Number((n * 100).toFixed(1))}%`;

// This bridge creates explicit representative trajectories, not whole bucket payoffs.
// Emergency action is +25 bp before October; post-meeting hikes occur on Dec 10.
// Tail buckets use exactly ±50 bp, and all other unmodeled rate moves are absent.
export function facts(s: Scenario) {
  if (!buckets.includes(s.october_change_bucket) || !buckets.includes(s.december_change_bucket) ||
      !Number.isInteger(s.post_dec_meeting_hike_units_through_dec31) || s.post_dec_meeting_hike_units_through_dec31 < 0 || s.post_dec_meeting_hike_units_through_dec31 > 6) throw new Error('Scenario outside the supported demo domain');
  const change: Record<Bucket, number> = { CUT_50_PLUS: -50, CUT_25: -25, HOLD: 0, HIKE_25: 25, HIKE_50_PLUS: 50 };
  const oct = change[s.october_change_bucket], dec = change[s.december_change_bucket];
  const emergency = s.emergency_hike_sep17_through_dec_meeting ? 25 : 0;
  const start = data.resolved_facts.upper_bound_after_sep_2026_bps;
  const path = [start, start + emergency, start + emergency + oct, start + emergency + oct + dec];
  return {
    oct, dec, path,
    terminal: path[3],
    max: Math.max(...path, path[3] + s.post_dec_meeting_hike_units_through_dec31 * 25),
    annual: data.resolved_facts.hike_units_2026_through_sep16 + (Math.max(oct, 0) + Math.max(dec, 0) + emergency) / 25 + s.post_dec_meeting_hike_units_through_dec31,
    another: oct > 0 || dec > 0 || emergency > 0,
    scheduledPath: oct < 0 || dec < 0 ? 'OTHER' : `H${oct > 0 ? 'H' : 'P'}${dec > 0 ? 'H' : 'P'}`,
  };
}

export function payoffs(s: Scenario): Record<string, number> {
  const f = facts(s);
  const metrics: Record<string, string | number | boolean> = {
    october_2026_change_bucket: s.october_change_bucket,
    december_2026_change_bucket: s.december_change_bucket,
    scheduled_sep_oct_dec_path: f.scheduledPath,
    upper_bound_increase_occurs: f.another,
    annual_hike_units_25bp_equivalent: f.annual,
    upper_bound_after_december_2026_fomc_bps: f.terminal,
    max_upper_bound_before_deadline_bps: f.max,
  };
  return Object.fromEntries(data.instruments.map(i => {
    const p = i.claim.predicate;
    if (!(p.metric in metrics)) throw new Error(`Unsupported metric: ${p.metric}`);
    const actual = metrics[p.metric];
    const truth = p.comparator === 'EQ' ? actual === p.value : p.comparator === 'GTE' && typeof actual === 'number' && typeof p.value === 'number' ? actual >= p.value : undefined;
    if (truth === undefined) throw new Error(`Unsupported comparator: ${p.comparator}`);
    return [i.instrument_id, Number(truth)];
  }));
}

export function positionResult(p: Position, truth: Record<string, number>) {
  const payoutPerUnit = p.side === 'YES' ? truth[p.instrument_id] : 1 - truth[p.instrument_id];
  const cost = Math.round(p.quantity * p.entry_price * 100) / 100;
  const payout = p.quantity * payoutPerUnit;
  return { cost, payout, pnl: Math.round((payout - cost) * 100) / 100, payoutPerUnit };
}
export function portfolio(s: Scenario, positions = data.portfolio.positions) {
  const truth = payoffs(s);
  const rows = positions.map(p => ({ ...p, ...positionResult(p, truth) }));
  return { rows, truth, cost: sum(rows.map(r => r.cost)), payout: sum(rows.map(r => r.payout)), pnl: sum(rows.map(r => r.pnl)) };
}
export const sideMark = (p: Position) => p.side === 'YES' ? byId[p.instrument_id].snapshot_mark : 1 - byId[p.instrument_id].snapshot_mark;
export const markPnl = (p: Position) => Math.round(p.quantity * (sideMark(p) - p.entry_price) * 100) / 100;

export type Relationship = {
  id: string; label: string; expression: string; ids: string[]; domain: string; basis: string;
  description: string; consequence?: string; counterexample?: string;
};
const explanations: Record<string, string> = {
  con_another_hike_from_paths: 'Each of these three mutually exclusive scheduled paths contains a hike. Their combined payout can never exceed Another Hike. An emergency hike or a hike followed by a cut can make the inequality strict.',
  con_oct_partition: 'The five October action buckets are mutually exclusive and exhaustive. Exactly one pays $1 in every local state.',
  con_dec_partition: 'Exactly one December action bucket pays $1 in every local state.',
  con_path_partition: 'The four hike/pause paths plus Other cover every scheduled outcome. Any cut maps to Other; emergency moves do not change the scheduled path.',
};
export const relationships: Relationship[] = semantics.constraints.map(c => ({
  id: c.constraint_id, label: c.relation_label, expression: c.expression, ids: c.instrument_ids,
  domain: c.evaluation_domain, basis: c.proof?.state_space_id ?? (c.constraint_id.includes('hit') && !c.constraint_id.includes('another') ? 'sts_rate_level_2026' : 'demo_cross_window_bridge_v1'),
  description: c.explanation ?? explanations[c.constraint_id] ?? 'A scheduled hike is sufficient for Another Hike to resolve YES. The reverse does not hold: another qualifying meeting or an emergency action may trigger the broader contract.',
  consequence: c.expectation_consequence,
  counterexample: c.counterexample?.description,
}));
relationships.push({ id: 'con_count_partition', label: 'PARTITION', expression: 'COUNT_1 + COUNT_2 + COUNT_3 + COUNT_4 + COUNT_5_PLUS = 1', ids: data.instruments.filter(i => i.instrument_id.startsWith('ins_hike_count')).map(i => i.instrument_id), domain: 'PAYOFF_STATE', basis: 'sts_hike_count_2026', description: 'One hike unit is fixed in the baseline. The remaining buckets partition all possible annual totals, with five or more collected in the final bucket.' });
export const relationById = Object.fromEntries(relationships.map(r => [r.id, r]));
export const related = (id: string) => relationships.filter(r => r.ids.includes(id));
export function relationshipHolds(r: Relationship, values: Record<string, number>) {
  const v = r.ids.map(id => values[id]);
  if (r.label === 'PARTITION') return sum(v) === 1;
  if (r.label === 'EXPECTATION_BOUND') return v[0] >= sum(v.slice(1));
  return v[0] <= (r.id === 'con_another_hike_implies_not_count1' ? 1 - v[1] : v[1]);
}
export const modeledStates: Scenario[] = buckets.flatMap(oct => buckets.flatMap(dec => [false, true].flatMap(emergency => Array.from({ length: 7 }, (_, post) => ({ october_change_bucket: oct, december_change_bucket: dec, emergency_hike_sep17_through_dec_meeting: emergency, post_dec_meeting_hike_units_through_dec31: post })))));
export const modelProofs = Object.fromEntries(relationships.map(r => [r.id, modeledStates.every(s => relationshipHolds(r, payoffs(s)))]));
export function structuralChecks() {
  const m = (id: string) => byId[id].snapshot_mark;
  const group = (prefix: string) => sum(data.instruments.filter(i => i.instrument_id.startsWith(prefix)).map(i => i.snapshot_mark));
  return [
    { id: 'con_another_hike_from_paths', title: 'Scheduled path → Another hike', kind: 'BOUND SLACK', lhs: m('ins_another_hike'), rhs: sum(['hhh', 'hph', 'hhp'].map(k => m(`ins_path_${k}`))) },
    { id: 'con_eoy_high_implies_another_hike', title: 'Terminal rate → Another hike', kind: 'BOUND SLACK', lhs: m('ins_another_hike'), rhs: m('ins_eoy_425') + m('ins_eoy_ge450') },
    { id: 'con_path_partition', title: 'Sep–Dec path partition', kind: 'STRUCTURAL RESIDUAL', lhs: group('ins_path_'), rhs: 1 },
    { id: 'con_count_partition', title: 'Annual hike-count partition', kind: 'STRUCTURAL RESIDUAL', lhs: group('ins_hike_count_'), rhs: 1 },
    { id: 'con_hit450_implies_hit425', title: 'Hit ≥4.50% → Hit ≥4.25%', kind: 'BOUND SLACK', lhs: m('ins_hit_425'), rhs: m('ins_hit_450') },
  ].map(c => ({ ...c, delta: Math.round((c.lhs - c.rhs) * 1000) / 10 }));
}
export function windowLabel(i: Instrument) {
  if (i.instrument_id.startsWith('ins_oct')) return '28 Oct 2026';
  if (i.instrument_id.startsWith('ins_hike_count')) return '31 Dec · 23:59 ET';
  if (i.instrument_id.startsWith('ins_hit')) return '31 Dec · 12:59 ET';
  return '09 Dec · after meeting';
}
export const emergencyLabel = (i: Instrument) => i.instrument_id.startsWith('ins_path') || i.instrument_id.startsWith('ins_oct') || i.instrument_id.startsWith('ins_dec') ? 'Scheduled meetings only' : i.instrument_id.startsWith('ins_eoy') ? 'Reflected in terminal level' : 'Included within window';
export const expressionFor = (id: string) => semantics.state_spaces.map(s => (s.payoffs as Partial<Record<string, string>>)[id]).find(Boolean) ?? '';
