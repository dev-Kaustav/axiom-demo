// Positions -> terminal payout by state.
//
// The arithmetic is semantics/exposure.py's, including the part that is easy to
// get wrong. A NO holding is not a negative YES holding. It is an affine map:
//
//     payout(position, state) = quantity * (offset + scale * payoff[state])
//     YES: offset 0, scale  1
//     NO : offset 1, scale -1
//
// Negating the quantity alone drops the cash leg and understates the payout by
// a constant in every state.
//
// Money is integer cents throughout, and entry prices are integer
// ten-thousandths of a dollar, because Polymarket quotes to 0.001 and a price
// of 0.004 is four tenths of a cent. The float rounding the previous engine did
// (Math.round(x * 100) / 100) happened to be exact for five positions at
// two-decimal prices; it would not survive this book.

import { payoffOf } from './basis';

export type Side = 'YES' | 'NO';

export type Position = {
  position_id: string;
  contract_id: string;
  side: Side;
  /** Number of contracts. Each pays $1 if it settles in the holder's favour. */
  quantity: number;
  /** Entry price in ten-thousandths of a dollar. 0.53 is 5300, 0.004 is 40. */
  entry_price_x4: number;
  /** As the venue quoted it, preserved for the audit trail. */
  entry_price_text: string;
};

/**
 * Cost in whole cents. quantity * price_x4 is in ten-thousandths of a dollar,
 * so it divides by 100 to reach cents. The assertion is what keeps the exactness
 * claim honest: if a quantity and price ever produce a fractional cent, this
 * refuses rather than rounding it away.
 */
export function costCents(p: Position): number {
  const tenThousandths = p.quantity * p.entry_price_x4;
  if (tenThousandths % 100 !== 0) {
    throw new Error(
      `position ${p.position_id}: ${p.quantity} at ${p.entry_price_text} is not a whole number of cents`,
    );
  }
  return tenThousandths / 100;
}

/** Payout in cents for one position in one world. */
export function payoutCents(p: Position, stateIndex: number): number {
  const payoff = payoffOf(p.contract_id)[stateIndex];
  const perUnit = p.side === 'YES' ? payoff : 1 - payoff;
  return p.quantity * perUnit * 100;
}

export type PositionResult = {
  position: Position;
  payoutCents: number;
  costCents: number;
  pnlCents: number;
  /** 1 if this position pays in this world, 0 if it does not. */
  paysHere: 0 | 1;
};

export function positionResult(p: Position, stateIndex: number): PositionResult {
  const payout = payoutCents(p, stateIndex);
  const cost = costCents(p);
  return {
    position: p,
    payoutCents: payout,
    costCents: cost,
    pnlCents: payout - cost,
    paysHere: payout > 0 ? 1 : 0,
  };
}

export type PortfolioResult = {
  rows: PositionResult[];
  payoutCents: number;
  costCents: number;
  pnlCents: number;
};

export function portfolioAt(positions: Position[], stateIndex: number): PortfolioResult {
  const rows = positions.map((p) => positionResult(p, stateIndex));
  return {
    rows,
    payoutCents: rows.reduce((t, r) => t + r.payoutCents, 0),
    costCents: rows.reduce((t, r) => t + r.costCents, 0),
    pnlCents: rows.reduce((t, r) => t + r.pnlCents, 0),
  };
}

/** Portfolio P&L across every world, as a vector indexed like ALL_STATES. */
export function pnlVector(positions: Position[], stateCount: number): Float64Array {
  // Float64 holds these exactly: every value is an integer well inside 2^53,
  // and a book of this size overflows Int32.
  const vector = new Float64Array(stateCount);
  const cost = positions.reduce((t, p) => t + costCents(p), 0);
  for (const p of positions) {
    const column = payoffOf(p.contract_id);
    const yes = p.side === 'YES';
    for (let i = 0; i < stateCount; i += 1) {
      vector[i] += p.quantity * (yes ? column[i] : 1 - column[i]) * 100;
    }
  }
  for (let i = 0; i < stateCount; i += 1) vector[i] -= cost;
  return vector;
}

/**
 * Holdings of the same contract on the same side, aggregated.
 *
 * Correctness rule 2 from axiom-backend: aggregate quantities, never discard
 * duplicate holdings. The aggregate is shown alongside the individual rows, not
 * instead of them, because analytical offset is not operational netting.
 */
export type Aggregated = {
  contract_id: string;
  side: Side;
  totalQuantity: number;
  positionIds: string[];
};

export function aggregate(positions: Position[]): Aggregated[] {
  const groups = new Map<string, Aggregated>();
  for (const p of positions) {
    const key = `${p.contract_id}|${p.side}`;
    const existing = groups.get(key);
    if (existing) {
      existing.totalQuantity += p.quantity;
      existing.positionIds.push(p.position_id);
    } else {
      groups.set(key, {
        contract_id: p.contract_id,
        side: p.side,
        totalQuantity: p.quantity,
        positionIds: [p.position_id],
      });
    }
  }
  return [...groups.values()].filter((g) => g.positionIds.length > 1);
}

// ---------------------------------------------------------------- formatting

/** Cents -> "$276,150". The U+2212 minus is deliberate and asserted by the e2e suite. */
export function money(cents: number, signed = false): string {
  const dollars = Math.abs(cents) / 100;
  const sign = cents < 0 ? '−' : signed && cents > 0 ? '+' : '';
  return `${sign}$${dollars.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

export function compact(cents: number): string {
  const dollars = cents / 100;
  const sign = dollars < 0 ? '−' : dollars > 0 ? '+' : '';
  return `${sign}${(Math.abs(dollars) / 1000).toFixed(1)}k`;
}

/** Ten-thousandths of a dollar -> "53.0¢". */
export const price = (x4: number) => `${(x4 / 100).toFixed(1)}¢`;
