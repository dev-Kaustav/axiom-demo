// Composition layer. The views import from here and nothing deeper, so the
// shape of the UI never constrains the shape of the model.

import universe from '../data/universe/universe.json';
import portfolioData from '../data/portfolio.json';
import { AUTHORED, authoredById, expressionOf, type Authored } from './claims';
import {
  ALL_STATES,
  BASIS_SCENARIOS,
  BASIS_SUMMARY,
  DEGENERATE,
  STATE_COUNT,
  collapse,
  payoffOf,
  type Degenerate,
  type Scenario,
} from './basis';
import {
  aggregate,
  compact,
  costCents,
  money,
  payoutCents,
  pnlVector,
  portfolioAt,
  price,
  type Position,
} from './exposure';
import { exactGroupOffsets, rankedOffsets, type OffsetAssessment } from './relations';
import { ANCHORS, ASSUMPTIONS, describeState, type WorldState } from './world';

export * from './world';
export * from './claims';
export * from './basis';
export * from './exposure';
export * from './relations';

// ---------------------------------------------------------------- contracts

export type EventRecord = (typeof universe.events)[number];
export type ContractRecord = (typeof universe.contracts)[number];

export const EVENTS = universe.events as EventRecord[];
export const CONTRACTS = universe.contracts as ContractRecord[];
export const ANCHOR_FACTS = universe.anchors;
export const SNAPSHOT = universe.snapshot;
export const SCOPE_COUNTS = universe.scope_counts;

const eventById = new Map(EVENTS.map((e) => [e.event_id, e]));
const contractById = new Map(CONTRACTS.map((c) => [c.contract_id, c]));
const degenerateById = new Map(DEGENERATE.map((d) => [d.contract_id, d]));

/** Everything the UI needs about one contract, joined in one place. */
export type ContractView = {
  contract: ContractRecord;
  event: EventRecord;
  authored: Authored;
  degenerate: Degenerate | undefined;
  displayName: string;
  expression: string | null;
};

/**
 * Built once per contract and kept.
 *
 * The universe is a build-time snapshot and nothing here mutates, but the view
 * was being rebuilt on every call -- and rendering the expression walks the
 * whole claim tree to a string. The graph alone asks for this twice per node on
 * every render, so the join is cached rather than recomputed.
 */
const viewById = new Map<string, ContractView>();

export function contractView(contractId: string): ContractView {
  const cached = viewById.get(contractId);
  if (cached) return cached;

  const contract = contractById.get(contractId);
  if (!contract) throw new Error(`unknown contract ${contractId}`);
  const event = eventById.get(contract.event_id)!;
  const authored = authoredById.get(contractId)!;
  const view: ContractView = {
    contract,
    event,
    authored,
    degenerate: degenerateById.get(contractId),
    displayName: `${shortEventName(event)} ${authored.shortName}`,
    expression: authored.claim ? expressionOf(authored.claim) : null,
  };
  viewById.set(contractId, view);
  return view;
}

export const CONTRACT_VIEWS: ContractView[] = CONTRACTS.map((c) => contractView(c.contract_id));

/** The event title, trimmed to something that fits in a table cell. */
export function shortEventName(event: EventRecord): string {
  return event.title
    .replace(/^What will (the )?/i, '')
    .replace(/^How many /i, '')
    .replace(/\?$/, '')
    .trim();
}

export const contractName = (contractId: string) => contractView(contractId).displayName;

// ---------------------------------------------------------------- portfolio

export const PORTFOLIO = portfolioData;
export const POSITIONS = portfolioData.positions as Position[];
export const PROPOSED_TRADE = portfolioData.proposed_trade as Omit<Position, 'position_id'> & {
  note: string;
};

export const tradeAsPosition = (
  trade: { contract_id: string; side: 'YES' | 'NO'; quantity: number; entry_price_x4: number; entry_price_text: string },
): Position => ({ position_id: 'proposed', ...trade });

// ---------------------------------------------------------------- exposure

export type ScenarioRow = {
  scenario: Scenario;
  index: number;
  payoutCents: number;
  costCents: number;
  pnlCents: number;
};

/**
 * Portfolio P&L in every economically distinct scenario.
 *
 * Distinct means distinct *for this book*: worlds that pay the held contracts
 * identically are one row, which is what keeps the table readable without
 * discarding anything (PRD FR8).
 */
export function scenarioRows(positions: Position[]): ScenarioRow[] {
  const held = [...new Set(positions.map((p) => p.contract_id))];
  const scenarios = collapse(held);
  return scenarios.map((scenario) => {
    const index = scenario.memberIndices[0];
    const result = portfolioAt(positions, index);
    return {
      scenario,
      index,
      payoutCents: result.payoutCents,
      costCents: result.costCents,
      pnlCents: result.pnlCents,
    };
  });
}

export type ExposureSummary = {
  positionCount: number;
  contractCount: number;
  venues: string[];
  costCents: number;
  worst: ScenarioRow;
  best: ScenarioRow;
  scenarioCount: number;
  rawWorldCount: number;
  /** Held contracts we could not interpret, so coverage is never implied. */
  unsupportedHoldings: string[];
};

export function exposureSummary(positions: Position[]): ExposureSummary {
  const rows = scenarioRows(positions);
  const sorted = [...rows].sort((a, b) => a.pnlCents - b.pnlCents);
  return {
    positionCount: positions.length,
    contractCount: new Set(positions.map((p) => p.contract_id)).size,
    venues: [...new Set(positions.map((p) => contractView(p.contract_id).event && SNAPSHOT.venue))],
    costCents: positions.reduce((t, p) => t + costCents(p), 0),
    worst: sorted[0],
    best: sorted[sorted.length - 1],
    scenarioCount: rows.length,
    rawWorldCount: STATE_COUNT,
    unsupportedHoldings: positions
      .filter((p) => authoredById.get(p.contract_id)?.claim === null)
      .map((p) => p.contract_id),
  };
}

/**
 * How much each free variable matters to this book.
 *
 * Measured, not asserted: hold everything else at the scenario's own values,
 * sweep this variable across its alphabet, and record how far P&L moves. A
 * variable that never moves P&L is not an exposure the book has.
 */
export type Driver = { id: keyof WorldState; label: string; swingCents: number };

const DRIVER_LABELS: Record<keyof WorldState, string> = {
  october: 'October FOMC decision',
  december: 'December FOMC decision',
  interSepOct: 'Inter-meeting move before October',
  interOctDec: 'Inter-meeting move, October to December',
  postDec: 'Move after the December meeting',
};

export function drivers(positions: Position[]): Driver[] {
  const vector = pnlVector(positions, STATE_COUNT);
  const ids = Object.keys(DRIVER_LABELS) as (keyof WorldState)[];

  return ids
    .map((id) => {
      // Group worlds by everything except this variable; the spread inside a
      // group is what this variable alone is worth.
      const groups = new Map<string, number[]>();
      for (let i = 0; i < STATE_COUNT; i += 1) {
        const s = ALL_STATES[i];
        const key = ids
          .filter((other) => other !== id)
          .map((other) => s[other])
          .join('|');
        const bucket = groups.get(key);
        if (bucket) bucket.push(vector[i]);
        else groups.set(key, [vector[i]]);
      }
      let swing = 0;
      for (const values of groups.values()) {
        swing = Math.max(swing, Math.max(...values) - Math.min(...values));
      }
      return { id, label: DRIVER_LABELS[id], swingCents: swing };
    })
    .sort((a, b) => b.swingCents - a.swingCents);
}

// ---------------------------------------------------------------- re-exports

export {
  ALL_STATES,
  ANCHORS,
  ASSUMPTIONS,
  AUTHORED,
  BASIS_SCENARIOS,
  BASIS_SUMMARY,
  DEGENERATE,
  STATE_COUNT,
  aggregate,
  compact,
  costCents,
  describeState,
  exactGroupOffsets,
  expressionOf,
  money,
  payoffOf,
  payoutCents,
  portfolioAt,
  price,
  rankedOffsets,
};
export type { OffsetAssessment, Position, Scenario };
