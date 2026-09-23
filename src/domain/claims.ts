// Contract language -> economic predicate.
//
// The claim tree mirrors axiom-backend's contracts/claim.py so the two systems
// describe a contract the same way: an op, an optional predicate, optional
// children, and an optional count for the threshold ops. Evaluation is total
// and deterministic -- it returns exactly 0 or 1 and throws on anything it does
// not understand, rather than guessing.
//
// Authoring here is deterministic template matching, not inference. Every
// contract in a CORE event is authored from its event and its venue-assigned
// group label; anything that does not match a known template is refused and
// surfaced as UNSUPPORTED rather than quietly dropped (PRD section 8, 34).

import universe from '../data/universe/universe.json';
import { ANCHORS, facts, type WorldState } from './world';

export type Comparator = 'EQ' | 'NE' | 'LT' | 'LTE' | 'GT' | 'GTE';
export type Op = 'PREDICATE' | 'AND' | 'OR' | 'NOT' | 'AT_LEAST' | 'AT_MOST' | 'EXACTLY';

export type Predicate = {
  metric: string;
  comparator: Comparator;
  value: string | number | boolean;
};

export type Claim = {
  op: Op;
  predicate?: Predicate;
  args?: Claim[];
  count?: number;
};

export const predicate = (metric: string, comparator: Comparator, value: string | number | boolean): Claim => ({
  op: 'PREDICATE',
  predicate: { metric, comparator, value },
});

// ---------------------------------------------------------------- evaluation

/**
 * The flat name -> value view of one world that predicates are written against.
 * Contract claims never reach into the trajectory directly.
 */
export function metrics(state: WorldState): Record<string, string | number | boolean> {
  const f = facts(state);
  return {
    // The venue's change bucket is what the decision-bracket contracts settle
    // on. The underlying basis-point move is kept alongside it because the
    // level, touch and count contracts need the magnitude the bucket discards.
    october_bucket: f.octoberBucket,
    december_bucket: f.decemberBucket,
    october_move_bp: state.october,
    december_move_bp: state.december,
    terminal_upper_bound_bp: f.terminalUpperBp,
    max_upper_bound_bp: f.maxUpperBp,
    min_lower_bound_bp: f.minLowerBp,
    cuts_2026: f.cuts2026,
    hikes_2026: f.hikes2026,
    scheduled_path_sep_oct_dec: f.scheduledPath,
    another_hike_2026: f.anotherHike,
    emergency_cut_2026: f.emergencyCut,
    cut_by_october_meeting: f.cutByOctoberMeeting,
    cut_by_december_meeting: f.cutByDecemberMeeting,
    // Settled history, constant across the whole space. Contracts covering a
    // meeting that has already passed read this and nothing else.
    cuts_2026_to_date: ANCHORS.cutsToDate,
  };
}

export const METRIC_NAMES = Object.keys(
  metrics({ interSepOct: 0, october: 0, interOctDec: 0, december: 0, postDec: 0 }),
);

function evaluatePredicate(p: Predicate, values: Record<string, string | number | boolean>): 0 | 1 {
  if (!(p.metric in values)) throw new Error(`unknown metric: ${p.metric}`);
  const actual = values[p.metric];

  if (p.comparator === 'EQ') return actual === p.value ? 1 : 0;
  if (p.comparator === 'NE') return actual !== p.value ? 1 : 0;

  if (typeof actual !== 'number' || typeof p.value !== 'number') {
    throw new Error(`comparator ${p.comparator} needs numbers, got ${p.metric}=${String(actual)}`);
  }
  switch (p.comparator) {
    case 'LT':
      return actual < p.value ? 1 : 0;
    case 'LTE':
      return actual <= p.value ? 1 : 0;
    case 'GT':
      return actual > p.value ? 1 : 0;
    case 'GTE':
      return actual >= p.value ? 1 : 0;
  }
}

export function evaluate(claim: Claim, values: Record<string, string | number | boolean>): 0 | 1 {
  switch (claim.op) {
    case 'PREDICATE': {
      if (!claim.predicate) throw new Error('PREDICATE claim carries no predicate');
      return evaluatePredicate(claim.predicate, values);
    }
    case 'NOT': {
      const [only] = claim.args ?? [];
      if (!only) throw new Error('NOT claim carries no argument');
      return evaluate(only, values) === 1 ? 0 : 1;
    }
    case 'AND':
      return (claim.args ?? []).every((a) => evaluate(a, values) === 1) ? 1 : 0;
    case 'OR':
      return (claim.args ?? []).some((a) => evaluate(a, values) === 1) ? 1 : 0;
    case 'AT_LEAST':
    case 'AT_MOST':
    case 'EXACTLY': {
      const total = (claim.args ?? []).reduce((sum, a) => sum + evaluate(a, values), 0);
      const count = claim.count ?? 0;
      if (claim.op === 'AT_LEAST') return total >= count ? 1 : 0;
      if (claim.op === 'AT_MOST') return total <= count ? 1 : 0;
      return total === count ? 1 : 0;
    }
  }
}

/** Human-readable form of a claim, shown in the audit trail next to the rule text. */
export function expressionOf(claim: Claim): string {
  const symbol: Record<Comparator, string> = {
    EQ: '=',
    NE: '!=',
    LT: '<',
    LTE: '<=',
    GT: '>',
    GTE: '>=',
  };
  switch (claim.op) {
    case 'PREDICATE': {
      const p = claim.predicate!;
      const value = typeof p.value === 'string' ? `"${p.value}"` : String(p.value);
      return `${p.metric} ${symbol[p.comparator]} ${value}`;
    }
    case 'NOT':
      return `NOT (${expressionOf(claim.args![0])})`;
    case 'AND':
      return claim.args!.map(expressionOf).map((e) => `(${e})`).join(' AND ');
    case 'OR':
      return claim.args!.map(expressionOf).map((e) => `(${e})`).join(' OR ');
    default:
      return `${claim.op} ${claim.count} OF [${claim.args!.map(expressionOf).join(', ')}]`;
  }
}

// ---------------------------------------------------------------- authoring

export type InterpretationStatus = 'VERIFIED' | 'HIGH_CONFIDENCE' | 'REVIEW_REQUIRED' | 'UNSUPPORTED';

export type Authored = {
  contract_id: string;
  event_id: string;
  claim: Claim | null;
  status: InterpretationStatus;
  /** Why this contract carries the claim it does, or why it carries none. */
  rationale: string;
  /** Short display label, e.g. "Oct +25 bp". */
  shortName: string;
};

/** "4.25%", "≥ 4.5%", "≤1.0%", "1.25", " ↑ 5.0%" -> basis points. */
function parsePercentBp(label: string): number | null {
  const match = label.replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const percent = Number(match[1]);
  if (!Number.isFinite(percent)) return null;
  return Math.round(percent * 100);
}

/** "3 (75 bps)", "12+ (300+ bps)", "5+ (125+ bps)" -> { count, orMore }. */
function parseLadder(label: string): { count: number; orMore: boolean } | null {
  const match = label.match(/^(\d+)(\+)?/);
  if (!match) return null;
  return { count: Number(match[1]), orMore: Boolean(match[2]) };
}

const BUCKET_BY_LABEL: Record<string, string> = {
  '50+ bps decrease': 'CUT_50_PLUS',
  '25 bps decrease': 'CUT_25',
  'no change': 'HOLD',
  '25 bps increase': 'HIKE_25',
  '50+ bps increase': 'HIKE_50_PLUS',
};

const BUCKET_SHORT: Record<string, string> = {
  CUT_50_PLUS: '-50+',
  CUT_25: '-25',
  HOLD: 'hold',
  HIKE_25: '+25',
  HIKE_50_PLUS: '+50+',
};

const unsupported = (contract_id: string, event_id: string, shortName: string, rationale: string): Authored => ({
  contract_id,
  event_id,
  claim: null,
  status: 'UNSUPPORTED',
  rationale,
  shortName,
});

type RawContract = {
  contract_id: string;
  event_id: string;
  group_item_title: string | null;
  question: string;
};

function authorOne(c: RawContract, scope: string): Authored {
  const label = (c.group_item_title ?? '').trim();
  const lower = label.toLowerCase();
  const id = c.contract_id;
  const ev = c.event_id;

  if (scope === 'DECOY') {
    return unsupported(id, ev, label || c.question.slice(0, 40), 'Not a function of the modelled rate path.');
  }
  if (scope === 'OUT_OF_SCOPE') {
    return unsupported(id, ev, label || c.question.slice(0, 40), 'Settles outside the declared 2026 basis.');
  }

  const ok = (claim: Claim, shortName: string, rationale: string): Authored => ({
    contract_id: id,
    event_id: ev,
    claim,
    status: 'VERIFIED',
    rationale,
    shortName,
  });

  switch (ev) {
    // Scheduled decision brackets.
    case '606422':
    case '770450': {
      const bucket = BUCKET_BY_LABEL[lower];
      if (!bucket) break;
      const month = ev === '606422' ? 'october' : 'december';
      const short = ev === '606422' ? 'Oct' : 'Dec';
      return ok(
        predicate(`${month}_bucket`, 'EQ', bucket),
        `${short} ${BUCKET_SHORT[bucket]}`,
        `The contract settles on the change bucket announced after the ${month} 2026 meeting, so it reads the ${month} decision variable directly.`,
      );
    }

    // Annual 25 bp ladders. The venue counts a 50 bp move as two units.
    case '51456':
    case '626860': {
      const ladder = parseLadder(label);
      if (!ladder) break;
      const metric = ev === '51456' ? 'cuts_2026' : 'hikes_2026';
      const word = ev === '51456' ? 'cuts' : 'hikes';
      const short = `${ladder.count}${ladder.orMore ? '+' : ''} ${word}`;
      return ok(
        predicate(metric, ladder.orMore ? 'GTE' : 'EQ', ladder.count),
        short,
        `The contract counts 25 bp ${word} across all of 2026 through 31 December, including inter-meeting moves, so it reads the annual ${word} count.`,
      );
    }

    // Year-end level, settled after the December meeting.
    case '159954': {
      const value = parsePercentBp(label);
      if (value === null) break;
      const comparator: Comparator = label.includes('≥') ? 'GTE' : label.includes('≤') ? 'LTE' : 'EQ';
      const prefix = comparator === 'GTE' ? '>=' : comparator === 'LTE' ? '<=' : '';
      return ok(
        predicate('terminal_upper_bound_bp', comparator, value),
        `EOY ${prefix}${(value / 100).toFixed(2)}%`,
        'The contract settles on the upper bound after the December 2026 meeting, rounded to 25 bp. It reads the terminal level, not the path.',
      );
    }

    // Path contracts: reached at any point before 2027.
    case '84803': {
      const value = parsePercentBp(label);
      if (value === null) break;
      const up = label.includes('↑');
      const down = label.includes('↓');
      if (!up && !down) break;
      return ok(
        up
          ? predicate('max_upper_bound_bp', 'GTE', value)
          : predicate('min_lower_bound_bp', 'LTE', value),
        `Touch ${up ? '>=' : '<='}${(value / 100).toFixed(2)}%`,
        up
          ? 'The contract settles Yes if the upper bound reaches this level at any point before 2027, including inter-meeting moves. It reads the maximum of the path, not the terminal level.'
          : 'The contract settles Yes if the lower bound reaches this level at any point before 2027, including inter-meeting moves. It reads the minimum of the path, not the terminal level.',
      );
    }

    // Scheduled September-October-December sequence.
    case '955999': {
      if (lower === 'other') {
        return ok(
          predicate('scheduled_path_sep_oct_dec', 'EQ', 'OTHER'),
          'Path other',
          'The residual leg of the sequence event. Any scheduled cut falls here, since the event offers only hike and pause legs.',
        );
      }
      const parts = label.split(/[–-]/).map((p) => p.trim().toLowerCase());
      if (parts.length !== 3 || !parts.every((p) => p === 'hike' || p === 'pause')) break;
      const code = parts.map((p) => (p === 'hike' ? 'H' : 'P')).join('');
      return ok(
        predicate('scheduled_path_sep_oct_dec', 'EQ', code),
        `Path ${code}`,
        'The contract settles on the sequence of the three scheduled decisions. Inter-meeting moves are excluded from the sequence.',
      );
    }

    // Cumulative "cut by meeting X".
    case '106884': {
      if (lower.includes('2027')) {
        return unsupported(id, ev, label, 'Settles on a 2027 meeting, outside the declared 2026 basis.');
      }
      if (lower.startsWith('october')) {
        return ok(
          predicate('cut_by_october_meeting', 'EQ', true),
          'Cut by Oct',
          'Cumulative predicate: Yes if any cut has occurred at or before the October 2026 meeting.',
        );
      }
      if (lower.startsWith('december')) {
        return ok(
          predicate('cut_by_december_meeting', 'EQ', true),
          'Cut by Dec',
          'Cumulative predicate: Yes if any cut has occurred at or before the December 2026 meeting.',
        );
      }
      // Jan/Mar/Apr/Jun/Jul/Sep 2026 legs are settled history. In the modelled
      // space no cut has occurred to date, so these are constant and must
      // reproduce the venue's own No resolutions.
      return ok(
        predicate('cuts_2026_to_date', 'GTE', 1),
        `Cut by ${label.split(' ')[0].slice(0, 3)}`,
        'A meeting that has already passed. The cut anchor establishes that no cut occurred, so this contract is constant in the modelled space and must reproduce its settled No.',
      );
    }

    case '1034268':
      return ok(
        predicate('another_hike_2026', 'EQ', true),
        'Another hike',
        'Yes if any hike occurs through completion of the December 2026 meeting, inter-meeting moves included.',
      );

    case '79124':
      return ok(
        predicate('emergency_cut_2026', 'EQ', true),
        'Emergency cut',
        'Yes if a cut occurs outside a scheduled meeting before 2027.',
      );
  }

  return unsupported(
    id,
    ev,
    label || c.question.slice(0, 40),
    `No authoring template matched the venue label "${label}". Interpretation is withheld rather than guessed.`,
  );
}

const scopeByEvent = new Map<string, string>(
  (universe.events as { event_id: string; scope: string }[]).map((e) => [e.event_id, e.scope]),
);

export const AUTHORED: Authored[] = (universe.contracts as RawContract[]).map((c) =>
  authorOne(c, scopeByEvent.get(c.event_id) ?? 'DECOY'),
);

export const authoredById = new Map(AUTHORED.map((a) => [a.contract_id, a]));
