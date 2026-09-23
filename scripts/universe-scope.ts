// The curated Demo Contract Universe.
//
// This file is the editorial decision about which Polymarket events the demo
// models and why. It is deliberately explicit rather than a keyword sweep: a
// contract is in scope only when its settlement rule is a determinate function
// of the modelled 2026 FOMC decision sequence.
//
// PRD section 34 forbids quiet exclusion, so events we decline to model are
// listed here with a reason and carried through to the UI, not dropped.

export type Scope = 'CORE' | 'DECOY' | 'OUT_OF_SCOPE';

export type ScopedEvent = {
  event_id: string;
  expect_slug: string;
  scope: Scope;
  /** Shown verbatim in the UI next to every contract from this event. */
  reason: string;
};

/**
 * Every contract in a CORE event resolves from the rate path we enumerate:
 * the October and December 2026 FOMC decisions, any inter-meeting move, and
 * any move between the December meeting and 31 December.
 */
export const SCOPED_EVENTS: ScopedEvent[] = [
  {
    event_id: '606422',
    expect_slug: 'fed-decision-in-october-20260617190323537',
    scope: 'CORE',
    reason: 'Settles on the October 2026 FOMC change bucket, a modelled observable.',
  },
  {
    event_id: '770450',
    expect_slug: 'fed-decision-in-december-20260729232808632',
    scope: 'CORE',
    reason: 'Settles on the December 2026 FOMC change bucket, a modelled observable.',
  },
  {
    event_id: '51456',
    expect_slug: 'how-many-fed-rate-cuts-in-2026',
    scope: 'CORE',
    reason: 'Counts 25 bp cuts across 2026 through 31 December, including inter-meeting moves.',
  },
  {
    event_id: '626860',
    expect_slug: 'how-many-fed-rate-hikes-in-2026-20260623190717369',
    scope: 'CORE',
    reason: 'Counts 25 bp hikes across 2026 through 31 December, including inter-meeting moves.',
  },
  {
    event_id: '159954',
    expect_slug: 'what-will-the-fed-rate-be-at-the-end-of-2026',
    scope: 'CORE',
    reason: 'Terminal upper bound after the December 2026 meeting, rounded to 25 bp.',
  },
  {
    event_id: '84803',
    expect_slug: 'what-will-fed-rate-hit-before-2027',
    scope: 'CORE',
    reason: 'Path predicate: whether a bound is reached at any point before 2027. Not a terminal level.',
  },
  {
    event_id: '955999',
    expect_slug: 'fed-decisions-sepdec',
    scope: 'CORE',
    reason: 'Sequence of the September, October and December scheduled decisions. Excludes inter-meeting moves.',
  },
  {
    event_id: '106884',
    expect_slug: 'fed-rate-cut-by-629',
    scope: 'CORE',
    reason: 'Cumulative temporal predicate: whether any cut has occurred by a named meeting.',
  },
  {
    event_id: '1034268',
    expect_slug: 'another-fed-rate-hike-in-2026',
    scope: 'CORE',
    reason: 'Whether any further hike occurs in 2026.',
  },
  {
    event_id: '79124',
    expect_slug: 'fed-emergency-rate-cut-before-2027',
    scope: 'CORE',
    reason: 'Whether an inter-meeting cut occurs before 2027, a modelled observable.',
  },

  // Fed-tagged and superficially similar, but NOT functions of the rate path.
  // These are carried so the demo can prove it does not silently ignore
  // contracts (PRD section 8, section 34).
  {
    event_id: '990713',
    expect_slug: '',
    scope: 'DECOY',
    reason: 'Settles on the number of FOMC dissenting votes, which the rate path does not determine.',
  },
  {
    event_id: '770454',
    expect_slug: '',
    scope: 'DECOY',
    reason: 'Settles on the number of FOMC dissenting votes, which the rate path does not determine.',
  },
  {
    event_id: '778684',
    expect_slug: '',
    scope: 'DECOY',
    reason: 'Settles on the number of FOMC dissenting votes, which the rate path does not determine.',
  },
  {
    event_id: '385797',
    expect_slug: '',
    scope: 'DECOY',
    reason: 'Settles on a personnel action, not on any interest-rate observable.',
  },
  {
    event_id: '145648',
    expect_slug: '',
    scope: 'DECOY',
    reason: 'Settles on a personnel action, not on any interest-rate observable.',
  },
  {
    event_id: '812904',
    expect_slug: '',
    scope: 'DECOY',
    reason: 'Settles on a personnel action, not on any interest-rate observable.',
  },
  {
    event_id: '743529',
    expect_slug: '',
    scope: 'DECOY',
    reason: 'Settles on a personnel action, not on any interest-rate observable.',
  },

  // Real rate contracts we decline to model, so the state space stays honest.
  {
    event_id: '770451',
    expect_slug: '',
    scope: 'OUT_OF_SCOPE',
    reason:
      'Settles on the January 2027 FOMC decision. Modelling it would multiply the 2026 state space fivefold to serve five contracts, so the January meeting is outside the declared basis.',
  },
];

export const CORE_EVENT_IDS = SCOPED_EVENTS.filter((e) => e.scope === 'CORE').map((e) => e.event_id);
