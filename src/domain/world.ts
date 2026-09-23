// The world model: what can still happen to the 2026 federal funds target, and
// what each such world says about the quantities contracts settle on.
//
// Everything here is integer basis points. The target range moves in 25 bp
// increments, so integers are exact and no float ever touches a payout path --
// the discipline axiom-backend enforces with Fraction/Decimal (storage/
// basis_codec.py refuses floats outright).
//
// The free variables are MOVES IN BASIS POINTS, not the venue's change buckets.
// That ordering matters. A contract that settles on "50+ bps increase" cannot
// distinguish +50 from +100, but the level, touch and count contracts can. If
// the bucket were the free variable we would have to pin the open-ended tails to
// a single magnitude, and 19 real contracts in this universe would then compute
// a constant 0 -- wrong rather than absent. So the move is primitive and the
// bucket is derived from it.

import universe from '../data/universe/universe.json';

// ---------------------------------------------------------------- alphabet

/** Signed basis-point moves available at a scheduled FOMC meeting. */
export const SCHEDULED_MOVES_BP = [-100, -75, -50, -25, 0, 25, 50, 75, 100] as const;

/** Signed basis-point moves available in an inter-meeting window. */
export const INTER_MOVES_BP = [-25, 0, 25] as const;

/** The Fed's target range is 25 bp wide, so the lower bound tracks the upper. */
export const RANGE_WIDTH_BP = 25;

/**
 * One world. Five free variables: the two remaining scheduled 2026 decisions
 * and the three windows in which an inter-meeting move could land.
 */
export type WorldState = {
  /** 17 September -> the October meeting. */
  interSepOct: number;
  /** The October 27-28 scheduled decision. */
  october: number;
  /** After October -> the December meeting. */
  interOctDec: number;
  /** The December 8-9 scheduled decision. */
  december: number;
  /** After the December meeting -> 31 December. */
  postDec: number;
};

export const ASSUMPTIONS = [
  {
    id: 'move_alphabet',
    statement:
      'A scheduled decision moves the target by at most 100 bp, in 25 bp steps. An inter-meeting move is at most 25 bp.',
    consequence:
      'Contracts that could only settle Yes under a larger move are unreachable here. They are reported as outside the declared alphabet, never as a certain loss.',
  },
  {
    id: 'one_move_per_window',
    statement: 'At most one inter-meeting move occurs in each of the three inter-meeting windows.',
    consequence:
      'Worlds with repeated emergency action inside a single window are outside the modelled space. No contract in this universe distinguishes them below that bound.',
  },
  {
    id: 'range_width',
    statement: 'The target range is 25 bp wide, so the lower bound is always the upper bound minus 25 bp.',
    consequence:
      'This is what lets the touch contracts, which settle on "the lower or the upper bound", be evaluated from a single trajectory.',
  },
  {
    id: 'scheduled_calendar',
    statement:
      'The remaining 2026 scheduled meetings are October 27-28 and December 8-9, per the FOMC calendar every contract in the family cites.',
    consequence: 'A cancelled or rescheduled meeting is not modelled.',
  },
] as const;

// ---------------------------------------------------------------- buckets

/** The venue's change bucket for a scheduled decision. Derived, never primitive. */
export type Bucket = 'CUT_50_PLUS' | 'CUT_25' | 'HOLD' | 'HIKE_25' | 'HIKE_50_PLUS';

export const BUCKET_LABELS: Record<Bucket, string> = {
  CUT_50_PLUS: 'Cut 50+ bp',
  CUT_25: 'Cut 25 bp',
  HOLD: 'No change',
  HIKE_25: 'Hike 25 bp',
  HIKE_50_PLUS: 'Hike 50+ bp',
};

/**
 * Every contract in the decision-bracket events rounds to the nearest 25 bp and
 * collects everything from 50 bp outward into one open-ended bucket.
 */
export function bucketOf(moveBp: number): Bucket {
  if (moveBp <= -50) return 'CUT_50_PLUS';
  if (moveBp === -25) return 'CUT_25';
  if (moveBp === 0) return 'HOLD';
  if (moveBp === 25) return 'HIKE_25';
  return 'HIKE_50_PLUS';
}

// ---------------------------------------------------------------- anchors

type AnchorValue = string | number;
const anchorMap = new Map<string, AnchorValue>(
  (universe.anchors as { anchor_id: string; value: AnchorValue }[]).map((a) => [a.anchor_id, a.value]),
);

function anchorNumber(id: string): number {
  const value = anchorMap.get(id);
  if (typeof value !== 'number') throw new Error(`anchor ${id} is missing or not numeric`);
  return value;
}

export const ANCHORS = {
  /** Upper bound of the target range as of 17 September 2026, in basis points. */
  startUpperBp: anchorNumber('upper_bound_after_sep_2026_bps'),
  cutsToDate: anchorNumber('cuts_2026_to_date'),
  hikesToDate: anchorNumber('hikes_2026_to_date'),
  /**
   * The touch contracts settle over the whole of 2026, not just the meetings
   * that remain. Without these the downside legs would all compute 0, and one
   * of them has already settled Yes at the venue.
   */
  realizedMaxUpperBp: anchorNumber('realized_max_upper_bound_2026_bp'),
  realizedMinLowerBp: anchorNumber('realized_min_lower_bound_2026_bp'),
};

// ---------------------------------------------------------------- facts

/**
 * Everything the contracts in this family actually settle on, derived from one
 * world. Claims are written against these names and nothing else, so adding a
 * contract never means touching the trajectory code.
 */
export type WorldFacts = {
  /** Upper bound after each step: [17 Sep, inter, after Oct, inter, after Dec, 31 Dec]. */
  path: number[];
  octoberBucket: Bucket;
  decemberBucket: Bucket;
  /** Upper bound after the December meeting. What the year-end level contracts settle on. */
  terminalUpperBp: number;
  /** Highest upper bound touched at any point in 2026, realised history included. */
  maxUpperBp: number;
  /** Lowest lower bound touched at any point in 2026, realised history included. */
  minLowerBp: number;
  /** 25 bp cut units across all of 2026, inter-meeting moves included. */
  cuts2026: number;
  /** 25 bp hike units across all of 2026, inter-meeting moves included. */
  hikes2026: number;
  /** Scheduled September-October-December sequence, or OTHER if any scheduled cut. */
  scheduledPath: string;
  /** Any hike through completion of the December meeting. */
  anotherHike: boolean;
  /** Any inter-meeting cut before 2027. */
  emergencyCut: boolean;
  /** Any cut at or before the October meeting. */
  cutByOctoberMeeting: boolean;
  /** Any cut at or before the December meeting. */
  cutByDecemberMeeting: boolean;
};

const cutUnits = (bp: number) => (bp < 0 ? -bp / 25 : 0);
const hikeUnits = (bp: number) => (bp > 0 ? bp / 25 : 0);

export function facts(s: WorldState): WorldFacts {
  const start = ANCHORS.startUpperBp;
  const path = [
    start,
    start + s.interSepOct,
    start + s.interSepOct + s.october,
    start + s.interSepOct + s.october + s.interOctDec,
    start + s.interSepOct + s.october + s.interOctDec + s.december,
  ];
  path.push(path[4] + s.postDec);

  const moves = [s.interSepOct, s.october, s.interOctDec, s.december, s.postDec];
  const scheduledHike = s.october > 0 || s.december > 0;
  const interHike = s.interSepOct > 0 || s.interOctDec > 0;

  return {
    path,
    octoberBucket: bucketOf(s.october),
    decemberBucket: bucketOf(s.december),
    // The year-end level contracts settle after the December meeting, before
    // the post-meeting window closes. path[4], not path[5].
    terminalUpperBp: path[4],
    maxUpperBp: Math.max(ANCHORS.realizedMaxUpperBp, ...path),
    minLowerBp: Math.min(ANCHORS.realizedMinLowerBp, ...path.map((p) => p - RANGE_WIDTH_BP)),
    cuts2026: ANCHORS.cutsToDate + moves.reduce((total, bp) => total + cutUnits(bp), 0),
    hikes2026: ANCHORS.hikesToDate + moves.reduce((total, bp) => total + hikeUnits(bp), 0),
    // The sequence contracts read scheduled meetings only and offer no cut leg,
    // so any scheduled cut falls into the venue's own "Other" bucket.
    scheduledPath:
      s.october < 0 || s.december < 0 ? 'OTHER' : `H${s.october > 0 ? 'H' : 'P'}${s.december > 0 ? 'H' : 'P'}`,
    anotherHike: scheduledHike || interHike,
    emergencyCut: s.interSepOct < 0 || s.interOctDec < 0 || s.postDec < 0,
    cutByOctoberMeeting: s.interSepOct < 0 || s.october < 0,
    cutByDecemberMeeting: s.interSepOct < 0 || s.october < 0 || s.interOctDec < 0 || s.december < 0,
  };
}

// ---------------------------------------------------------------- enumeration

export const stateKey = (s: WorldState) =>
  `${s.interSepOct}|${s.october}|${s.interOctDec}|${s.december}|${s.postDec}`;

/** Every world in the modelled space. 3 x 9 x 3 x 9 x 3 = 2187. */
export const ALL_STATES: WorldState[] = INTER_MOVES_BP.flatMap((interSepOct) =>
  SCHEDULED_MOVES_BP.flatMap((october) =>
    INTER_MOVES_BP.flatMap((interOctDec) =>
      SCHEDULED_MOVES_BP.flatMap((december) =>
        INTER_MOVES_BP.map((postDec) => ({ interSepOct, october, interOctDec, december, postDec })),
      ),
    ),
  ),
);

const signedBp = (bp: number) => `${bp > 0 ? '+' : bp < 0 ? '−' : ''}${Math.abs(bp)} bp`;

/**
 * A short human sentence for one world. The scenario table is unreadable
 * without this, and "Oct +25 bp / Dec hold" is what a trader actually says.
 */
export function describeState(s: WorldState): string {
  const parts = [
    `Oct ${s.october === 0 ? 'hold' : signedBp(s.october)}`,
    `Dec ${s.december === 0 ? 'hold' : signedBp(s.december)}`,
  ];
  const inter: string[] = [];
  if (s.interSepOct !== 0) inter.push(`${signedBp(s.interSepOct)} before October`);
  if (s.interOctDec !== 0) inter.push(`${signedBp(s.interOctDec)} between meetings`);
  if (s.postDec !== 0) inter.push(`${signedBp(s.postDec)} after December`);
  if (inter.length === 0) return `${parts.join(' / ')} / no inter-meeting move`;
  return `${parts.join(' / ')} / ${inter.join(', ')}`;
}

export const bpPercent = (value: number) => `${(value / 100).toFixed(2)}%`;
