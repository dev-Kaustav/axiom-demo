// Basis compilation: worlds -> payoff vectors -> the minimum sufficient set of
// distinguishable scenarios.
//
// Mirrors semantics/basis.py. Two differences, both deliberate:
//
//  1. The backend partitions each observable first (semantics/partition.py) and
//     takes the cartesian product of the coarsest cells. Here the free variables
//     are already a small discrete alphabet, so the product is enumerated
//     directly and minimality is recovered afterwards by collapsing states that
//     no instrument distinguishes. That is a stronger result than the backend's:
//     minimal with respect to the contracts actually held, not with respect to
//     the thresholds they happen to mention.
//
//  2. Collapsing happens twice. Once over every supported contract, which gives
//     the canonical basis used for relation inference, and once over only the
//     contracts a portfolio holds, which gives the scenario table something a
//     human can read.

import universe from '../data/universe/universe.json';
import { AUTHORED, evaluate, metrics, type Authored } from './claims';
import { ALL_STATES, describeState, stateKey, type WorldState } from './world';

/** Refuse rather than silently truncate. semantics/basis.py uses 4096 for an
 *  API payload budget; this runs in a browser with no payload to send, so the
 *  ceiling is set by what stays auditable rather than by transport. */
export const MAX_STATES = 16384;

if (ALL_STATES.length > MAX_STATES) {
  throw new Error(`state space of ${ALL_STATES.length} exceeds the declared ceiling of ${MAX_STATES}`);
}

export const STATE_COUNT = ALL_STATES.length;

// ---------------------------------------------------------------- payoffs

export const SUPPORTED: Authored[] = AUTHORED.filter((a) => a.claim !== null);

/** Metric values for every world, computed once. */
const METRICS = ALL_STATES.map((s) => metrics(s));

/**
 * contract_id -> payoff in each world, as 0 or 1.
 *
 * A Uint8Array rather than number[]: 89 contracts x 2187 worlds is ~195k cells,
 * and the relation pass walks them repeatedly.
 */
export const PAYOFFS: Map<string, Uint8Array> = new Map(
  SUPPORTED.map((a) => {
    const column = new Uint8Array(STATE_COUNT);
    for (let i = 0; i < STATE_COUNT; i += 1) column[i] = evaluate(a.claim!, METRICS[i]);
    return [a.contract_id, column] as const;
  }),
);

export const payoffOf = (contractId: string): Uint8Array => {
  const column = PAYOFFS.get(contractId);
  if (!column) throw new Error(`no payoff vector for ${contractId}`);
  return column;
};

/** Whether anything at all can be computed about this contract. A refused
 *  contract carries no claim, so it has no column and no derived answer. */
export const hasPayoff = (contractId: string): boolean => PAYOFFS.has(contractId);

// ---------------------------------------------------------------- degenerate

export type Degenerate = {
  contract_id: string;
  kind: 'ALWAYS_0' | 'ALWAYS_1';
  /**
   * Why the contract cannot vary. The two causes mean opposite things and must
   * never be shown as one:
   *
   *   SETTLED         the venue has already resolved it, and the model agrees.
   *                   Genuinely determinate. Nothing to review.
   *   OUT_OF_ALPHABET it could only settle the other way under a move larger
   *                   than this model declares. That is a limit of the model,
   *                   not a fact about the world, and it must never be
   *                   presented as a certain loss.
   */
  cause: 'SETTLED' | 'OUT_OF_ALPHABET';
  reason: string;
};

const popcount = (column: Uint8Array) => {
  let total = 0;
  for (let i = 0; i < column.length; i += 1) total += column[i];
  return total;
};

/**
 * Contracts with no reachable winning state, or no reachable losing one.
 *
 * These must be surfaced, and they must be surfaced with a reason, because the
 * two reasons mean opposite things. A contract refuted by a settled fact is
 * genuinely dead and the venue agrees. A contract unreachable only because of
 * the declared move alphabet is a scope limit of this model, and calling it a
 * certain loss would be a lie.
 *
 * They are also excluded from relation inference: a constant-0 column is a
 * subset of every other column, so leaving them in floods the Relationships
 * view with meaningless implications.
 */
const settledIds = new Set(
  (universe.contracts as { contract_id: string; closed: boolean; resolution: { resolved_outcome: string | null } }[])
    .filter((c) => c.closed && c.resolution.resolved_outcome)
    .map((c) => c.contract_id),
);

export const DEGENERATE: Degenerate[] = SUPPORTED.flatMap((a) => {
  const wins = popcount(payoffOf(a.contract_id));
  if (wins !== 0 && wins !== STATE_COUNT) return [];

  const kind = wins === 0 ? ('ALWAYS_0' as const) : ('ALWAYS_1' as const);
  const settled = settledIds.has(a.contract_id);
  return [
    {
      contract_id: a.contract_id,
      kind,
      cause: settled ? ('SETTLED' as const) : ('OUT_OF_ALPHABET' as const),
      reason: settled
        ? 'The venue has already settled this contract and the model computes the same outcome in every world. Determinate, nothing to review.'
        : `This contract could only settle ${wins === 0 ? 'Yes' : 'No'} under a single move larger than the declared alphabet allows. It is outside the scope of this model, not a certain outcome.`,
    },
  ];
});

const degenerateIds = new Set(DEGENERATE.map((d) => d.contract_id));

/** Contracts that actually discriminate between worlds. */
export const DISCRIMINATING: string[] = SUPPORTED.map((a) => a.contract_id).filter(
  (id) => !degenerateIds.has(id),
);

// ---------------------------------------------------------------- collapse

export type Scenario = {
  /** Stable key derived from the payoff signature, not from any one world. */
  key: string;
  /** The plainest world in the class. See pickRepresentative. */
  representative: WorldState;
  label: string;
  /** How many raw worlds collapsed into this scenario. */
  memberCount: number;
  /** How much is going on in the representative. Lower reads more plainly, and
   *  is the tiebreak wherever scenarios are ranked by something else first. */
  complexity: number;
  /** Indices into ALL_STATES. Needed to read payoffs back out. */
  memberIndices: number[];
};

/**
 * The plainest world in a class of payoff-equivalent worlds.
 *
 * Every world in the class produces the same payout, so any of them is a
 * correct representative -- but they are not equally useful to read. Taking the
 * first by enumeration order surfaces things like "Oct -75 bp / Dec +100 bp /
 * -25 bp before October, +25 bp between meetings, +25 bp after December" when
 * "Oct +25 bp / Dec -25 bp / no inter-meeting move" describes the same payout.
 * A trader has to be able to say the scenario out loud, so prefer the world with
 * the fewest moving parts: fewest inter-meeting moves first, then the smallest
 * scheduled moves.
 */
function complexityOf(s: WorldState): number {
  const interMoves = [s.interSepOct, s.interOctDec, s.postDec];
  return (
    interMoves.filter((m) => m !== 0).length * 1000 +
    interMoves.reduce((t, m) => t + Math.abs(m), 0) +
    (Math.abs(s.october) + Math.abs(s.december)) / 25
  );
}

function pickRepresentative(memberIndices: number[]): { state: WorldState; complexity: number } {
  let best = ALL_STATES[memberIndices[0]];
  let bestScore = Infinity;
  for (const index of memberIndices) {
    const score = complexityOf(ALL_STATES[index]);
    if (score < bestScore) {
      bestScore = score;
      best = ALL_STATES[index];
    }
  }
  return { state: best, complexity: bestScore };
}

/**
 * Group worlds that every contract in `contractIds` pays identically on. Two
 * worlds that produce the same payout on every contract you care about are the
 * same scenario as far as the portfolio is concerned (PRD FR8).
 */
export function collapse(contractIds: string[]): Scenario[] {
  const columns = contractIds.map(payoffOf);
  const groups = new Map<string, number[]>();

  for (let i = 0; i < STATE_COUNT; i += 1) {
    // The signature is the payoff row for this world across the chosen columns.
    let signature = '';
    for (let c = 0; c < columns.length; c += 1) signature += columns[c][i];
    const existing = groups.get(signature);
    if (existing) existing.push(i);
    else groups.set(signature, [i]);
  }

  return [...groups.entries()].map(([signature, memberIndices]) => {
    const { state, complexity } = pickRepresentative(memberIndices);
    return {
      key: signature,
      representative: state,
      label: describeState(state),
      memberCount: memberIndices.length,
      complexity,
      memberIndices,
    };
  });
}

/** The canonical basis: collapsed over every discriminating contract. */
export const BASIS_SCENARIOS: Scenario[] = collapse(DISCRIMINATING);

export const BASIS_SUMMARY = {
  rawStateCount: STATE_COUNT,
  basisScenarioCount: BASIS_SCENARIOS.length,
  supportedContracts: SUPPORTED.length,
  discriminatingContracts: DISCRIMINATING.length,
  degenerateContracts: DEGENERATE.length,
  degenerateSettled: DEGENERATE.filter((d) => d.cause === 'SETTLED').length,
  degenerateOutOfAlphabet: DEGENERATE.filter((d) => d.cause === 'OUT_OF_ALPHABET').length,
  unsupportedContracts: AUTHORED.length - SUPPORTED.length,
};

export { ALL_STATES, stateKey };
