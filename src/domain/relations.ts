// Structural relationships between contracts, and where a hedge fails.
//
// Contract-level relations port semantics/relations.py and add the two kinds
// the backend does not emit but the PRD needs: OVERLAP and COMPLEMENT.
//
// Everything here is derived from payoff vectors in a shared basis. Nothing is
// tagged by hand, and nothing uses price. The backend's warning applies
// verbatim: a claim hash is encoding identity, which is neither necessary nor
// sufficient for economic equivalence. Equivalence means equal payoff vectors
// in a common basis, which is what IDENTITY tests.

import universe from '../data/universe/universe.json';
import { BASIS_SCENARIOS, DISCRIMINATING, STATE_COUNT, hasPayoff, payoffOf, type Scenario } from './basis';
import { costCents, payoutCents, type Position } from './exposure';

export type RelationKind =
  | 'IDENTITY'
  | 'IMPLICATION'
  | 'EXCLUSIVITY'
  | 'COMPLEMENT'
  | 'OVERLAP'
  | 'INDEPENDENT';

export type Relation = {
  kind: RelationKind;
  a: string;
  b: string;
  /** The payout consequence, stated as an inequality over prices. */
  implies: string[];
  proof: string;
};

/** Indices of one representative world per economically distinct scenario. */
const SCENARIO_INDICES = BASIS_SCENARIOS.map((s) => s.memberIndices[0]);

const columnOver = (contractId: string): Uint8Array => {
  const full = payoffOf(contractId);
  const projected = new Uint8Array(SCENARIO_INDICES.length);
  for (let i = 0; i < SCENARIO_INDICES.length; i += 1) projected[i] = full[SCENARIO_INDICES[i]];
  return projected;
};

const SCENARIO_COLUMNS = new Map(DISCRIMINATING.map((id) => [id, columnOver(id)] as const));

function classifyPair(a: string, b: string): Relation {
  const x = SCENARIO_COLUMNS.get(a)!;
  const y = SCENARIO_COLUMNS.get(b)!;
  const n = x.length;

  let same = true;
  let aImpliesB = true;
  let bImpliesA = true;
  let disjoint = true;
  let covers = true; // a OR b true everywhere

  for (let i = 0; i < n; i += 1) {
    if (x[i] !== y[i]) same = false;
    if (x[i] === 1 && y[i] === 0) aImpliesB = false;
    if (y[i] === 1 && x[i] === 0) bImpliesA = false;
    if (x[i] === 1 && y[i] === 1) disjoint = false;
    if (x[i] === 0 && y[i] === 0) covers = false;
  }

  if (same) {
    return {
      kind: 'IDENTITY',
      a,
      b,
      implies: [`P(${a}) = P(${b})`],
      proof: 'The two contracts pay identically in every state of the shared basis.',
    };
  }
  if (disjoint && covers) {
    return {
      kind: 'COMPLEMENT',
      a,
      b,
      implies: [`P(${a}) + P(${b}) = 1`],
      proof: 'Exactly one of the two pays in every state of the shared basis.',
    };
  }
  if (aImpliesB) {
    return {
      kind: 'IMPLICATION',
      a,
      b,
      implies: [`P(${a}) <= P(${b})`],
      proof: 'Every state in which the first pays is a state in which the second pays. The reverse does not hold.',
    };
  }
  if (bImpliesA) {
    return {
      kind: 'IMPLICATION',
      a: b,
      b: a,
      implies: [`P(${b}) <= P(${a})`],
      proof: 'Every state in which the first pays is a state in which the second pays. The reverse does not hold.',
    };
  }
  if (disjoint) {
    return {
      kind: 'EXCLUSIVITY',
      a,
      b,
      implies: [`P(${a}) + P(${b}) <= 1`],
      proof: 'No state of the shared basis pays both.',
    };
  }
  return {
    kind: 'OVERLAP',
    a,
    b,
    implies: [`P(${a}) + P(${b}) <= 1 + P(both)`],
    proof: 'Some states pay both and some pay only one. Neither contract implies the other.',
  };
}

/** Relations among a chosen set of contracts. Degenerate columns are excluded
 *  upstream: a constant-0 column implies everything and would flood this list. */
export function relationsAmong(contractIds: string[]): Relation[] {
  const ids = contractIds.filter((id) => SCENARIO_COLUMNS.has(id));
  const out: Relation[] = [];
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      out.push(classifyPair(ids[i], ids[j]));
    }
  }
  return out;
}

// ---------------------------------------------------------------- hedges

export type OffsetClass = 'EXACT' | 'PARTIAL' | 'CONDITIONAL' | 'NONE';

export type HedgeFailure = {
  scenario: Scenario;
  /** How far combined payout in this state sits from its usual level, in cents. */
  shortfallCents: number;
  combinedCents: number;
};

export type OffsetAssessment = {
  a: Position;
  b: Position;
  klass: OffsetClass;
  /** Scenarios where combined payout sits at its modal level. */
  coveredScenarios: number;
  totalScenarios: number;
  coverageFraction: number;
  /** Spread of combined payout across the basis, in cents. Zero means exact. */
  residualRangeCents: number;
  /** How much of the larger leg's own swing the pair removes. */
  reductionFraction: number;
  failures: HedgeFailure[];
  /** True when the pair looks related but does not offset. */
  misleading: boolean;
  rank: number;
};

const swingCents = (p: Position): number => {
  let min = Infinity;
  let max = -Infinity;
  for (const index of SCENARIO_INDICES) {
    const value = payoutCents(p, index);
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return max - min;
};

/**
 * Classify how two positions offset, and name the states where they do not.
 *
 * Coverage is a count of economically distinct states, not a probability.
 * Nothing here weights a state by how likely it is, because this model does not
 * know and does not claim to.
 */
export function assessOffset(a: Position, b: Position): OffsetAssessment {
  const combined = SCENARIO_INDICES.map((index) => payoutCents(a, index) + payoutCents(b, index));

  // The modal combined payout is the level the hedge holds at.
  const counts = new Map<number, number>();
  for (const value of combined) counts.set(value, (counts.get(value) ?? 0) + 1);
  let modal = combined[0];
  let modalCount = 0;
  for (const [value, count] of counts) {
    if (count > modalCount || (count === modalCount && value < modal)) {
      modal = value;
      modalCount = count;
    }
  }

  const range = Math.max(...combined) - Math.min(...combined);
  const largestLeg = Math.max(swingCents(a), swingCents(b));
  const coverageFraction = modalCount / combined.length;
  const reductionFraction = largestLeg === 0 ? 0 : Math.max(0, 1 - range / largestLeg);

  let klass: OffsetClass;
  if (range === 0) klass = 'EXACT';
  else if (coverageFraction >= 0.6) klass = 'CONDITIONAL';
  else if (range < largestLeg) klass = 'PARTIAL';
  else klass = 'NONE';

  const failures: HedgeFailure[] = [];
  for (let i = 0; i < combined.length; i += 1) {
    if (combined[i] !== modal) {
      failures.push({
        scenario: BASIS_SCENARIOS[i],
        shortfallCents: combined[i] - modal,
        combinedCents: combined[i],
      });
    }
  }
  // Worst first, and among equally bad ones the plainest to say out loud.
  failures.sort(
    (x, y) =>
      Math.abs(y.shortfallCents) - Math.abs(x.shortfallCents) ||
      x.scenario.complexity - y.scenario.complexity,
  );

  // A pair is misleading only if a trader would actually read it as a hedge and
  // it is not one. Two YES legs of the same partition are visibly mutually
  // exclusive, not a hedge, and flagging them buries the pairs that matter.
  const looksLikeAHedge =
    a.side !== b.side ||
    (sharesLevel(a.contract_id, b.contract_id) && contractEvent(a.contract_id) !== contractEvent(b.contract_id));
  const misleading = klass !== 'EXACT' && klass !== 'PARTIAL' && looksLikeAHedge;

  const notionalAtRisk = Math.min(swingCents(a), swingCents(b));
  const rank = notionalAtRisk * (1 - reductionFraction) * (misleading ? 1 : looksLikeAHedge ? 0.6 : 0.15);

  return {
    a,
    b,
    klass,
    coveredScenarios: modalCount,
    totalScenarios: combined.length,
    coverageFraction,
    residualRangeCents: range,
    reductionFraction,
    failures,
    misleading,
    rank,
  };
}

type Meta = { contract_id: string; event_id: string; group_item_title: string | null };
const META = new Map((universe.contracts as Meta[]).map((c) => [c.contract_id, c]));

const contractEvent = (id: string) => META.get(id)?.event_id ?? '';

/** The numeric level a contract's venue label quotes, if it quotes one. Two
 *  contracts naming the same level are the ones a trader reads as a pair. */
const levelOf = (id: string): string | null => {
  const match = (META.get(id)?.group_item_title ?? '').match(/(\d+(?:\.\d+)?)\s*%/);
  return match ? String(Number(match[1])) : null;
};

const sharesLevel = (a: string, b: string) => {
  const x = levelOf(a);
  const y = levelOf(b);
  return x !== null && y !== null && x === y;
};

/** Every held pair, ranked so the pairs a trader would misread come first. */
export function rankedOffsets(positions: Position[]): OffsetAssessment[] {
  const out: OffsetAssessment[] = [];
  for (let i = 0; i < positions.length; i += 1) {
    for (let j = i + 1; j < positions.length; j += 1) {
      if (positions[i].contract_id === positions[j].contract_id && positions[i].side === positions[j].side) {
        continue; // duplicate holding, not a hedge
      }
      out.push(assessOffset(positions[i], positions[j]));
    }
  }
  return out.sort((x, y) => y.rank - x.rank);
}

// ---------------------------------------------------------------- groups

export type GroupOffset = {
  positions: Position[];
  /** Combined payout, identical in every state. */
  constantPayoutCents: number;
  eventId: string;
  proof: string;
};

/**
 * Sets of held positions whose combined payout is the same in every state.
 *
 * A pairwise scan cannot see this. The five October brackets partition the
 * October decision, so holding all five at one size pays exactly that size no
 * matter what the Fed does -- an exact hedge spread across five contracts that
 * looks like five separate directional bets in a positions table.
 */
export function exactGroupOffsets(positions: Position[]): GroupOffset[] {
  const byEvent = new Map<string, Position[]>();
  for (const p of positions) {
    const event = contractEvent(p.contract_id);
    if (!event) continue;
    byEvent.set(event, [...(byEvent.get(event) ?? []), p]);
  }

  const out: GroupOffset[] = [];
  for (const [eventId, group] of byEvent) {
    if (group.length < 3) continue;

    const totals = SCENARIO_INDICES.map((index) =>
      group.reduce((sum, p) => sum + payoutCents(p, index), 0),
    );
    const first = totals[0];
    if (!totals.every((t) => t === first)) continue;

    out.push({
      positions: group,
      constantPayoutCents: first,
      eventId,
      proof: `These ${group.length} contracts are mutually exclusive and cover every outcome of the event, so exactly one pays in every state. Held together at this size the combined payout is ${first / 100} dollars regardless of the decision.`,
    });
  }
  return out;
}

// ---------------------------------------------------------------- baskets

export type BasketClass = 'PARTITION' | 'EXCLUSIVE' | 'EXHAUSTIVE' | 'OVERLAPPING' | 'UNCOMPUTED';

export type Basket = {
  /** The selected contracts this could be computed over. */
  ids: string[];
  /**
   * Selected contracts carrying no claim, so no column exists for them.
   *
   * They are reported rather than dropped: a basket answer computed over four
   * of five selected contracts is not an answer about the five, and saying so
   * is the difference between a gap and a silent error.
   */
  excludedIds: string[];
  /** worldsPaying[k] = worlds in which exactly k of the selected contracts settle Yes. */
  worldsPaying: number[];
  worldCount: number;
  klass: BasketClass;
  headline: string;
  /** The selected contracts this book actually holds. */
  held: Position[];
  /** Combined payout of those held positions over every world, and what they cost. */
  payout: { minCents: number; maxCents: number; costCents: number } | null;
};

/**
 * What a set of contracts does to the outcome space, taken together.
 *
 * A pairwise relation answers "does A imply B". It cannot answer the question a
 * trader asks of a basket: do these divide the outcomes between them, leave a
 * gap, or double up? The five October brackets partition the October decision,
 * so exactly one pays in every world and the combined payout is a constant --
 * which is why holding all five is a fixed payout dressed up as five bets. This
 * generalises that check to any selection, and counts worlds rather than
 * asserting probabilities.
 */
export function basketCoverage(contractIds: string[], positions: Position[]): Basket {
  const requested = [...new Set(contractIds)];
  const ids = requested.filter(hasPayoff);
  const excludedIds = requested.filter((id) => !hasPayoff(id));

  if (ids.length === 0) {
    return {
      ids,
      excludedIds,
      worldsPaying: [],
      worldCount: STATE_COUNT,
      klass: 'UNCOMPUTED',
      headline: `None of these ${excludedIds.length} contracts carries a machine-readable predicate, so this model cannot say what they do to the outcome space.`,
      held: positions.filter((p) => excludedIds.includes(p.contract_id)),
      payout: null,
    };
  }

  const columns = ids.map(payoffOf);
  const worldsPaying = new Array<number>(ids.length + 1).fill(0);
  for (let i = 0; i < STATE_COUNT; i += 1) {
    let paying = 0;
    for (const column of columns) paying += column[i];
    worldsPaying[paying] += 1;
  }

  const none = worldsPaying[0];
  const multiple = worldsPaying.slice(2).reduce((sum, n) => sum + n, 0);
  const klass: BasketClass =
    multiple === 0 && none === 0 ? 'PARTITION'
    : multiple === 0 ? 'EXCLUSIVE'
    : none === 0 ? 'EXHAUSTIVE'
    : 'OVERLAPPING';

  const worlds = (n: number) => `${n.toLocaleString('en-US')} of ${STATE_COUNT.toLocaleString('en-US')} worlds`;
  const headline =
    klass === 'PARTITION' ? `Exactly one of these ${ids.length} contracts pays in every modelled world. They divide the outcome space between them.`
    : klass === 'EXCLUSIVE' ? `At most one of these can pay. In ${worlds(none)} none of them does, so this set leaves a gap.`
    : klass === 'EXHAUSTIVE' ? `At least one always pays, but they are not exclusive: ${worlds(multiple)} pay more than one.`
    : `These do not divide the outcome space. ${worlds(none)} pay none of them, and ${worlds(multiple)} pay more than one.`;

  const held = positions.filter((p) => ids.includes(p.contract_id));
  let payout: Basket['payout'] = null;
  if (held.length > 0) {
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < STATE_COUNT; i += 1) {
      const total = held.reduce((sum, p) => sum + payoutCents(p, i), 0);
      if (total < min) min = total;
      if (total > max) max = total;
    }
    payout = { minCents: min, maxCents: max, costCents: held.reduce((sum, p) => sum + costCents(p), 0) };
  }

  return { ids, excludedIds, worldsPaying, worldCount: STATE_COUNT, klass, headline, held, payout };
}
