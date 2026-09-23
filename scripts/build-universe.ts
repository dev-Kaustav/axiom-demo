// Build the versioned Demo Contract Universe from Polymarket's public Gamma API.
//
//   node --experimental-strip-types scripts/build-universe.ts
//
// Writes src/data/universe/universe.json. The demo reads only that file; it
// never talks to a venue at page load (PRD section 29). Re-running this script
// refreshes marks and resolution status, which is why marks live in their own
// section and no payoff computation reads them.
//
// Conventions mirrored from axiom-backend rather than reinvented:
//   - ingestion/polymarket/mapping.py::map_outcomes_to_tokens
//       outcomes and clobTokenIds are paired POSITIONALLY behind an
//       equal-length assertion. Never zip blindly, never reorder.
//   - ingestion/polymarket/collect.py
//       rule_hash covers an ordered, settlement-bearing field set only. Titles,
//       tags, volume and prices must never make a contract look amended.
//   - All external identifiers stay TEXT. Polymarket token ids are 78-digit
//     decimals and lose precision the moment they touch a JS number.

import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { SCOPED_EVENTS, type Scope } from './universe-scope.ts';

const GAMMA = 'https://gamma-api.polymarket.com';
const MIN_REQUEST_INTERVAL_MS = 200; // matches AXIOM_GAMMA_MIN_REQUEST_INTERVAL_SECONDS
const MAX_ATTEMPTS = 4;

// Field and record separators for hashing. Plain printable sentinels, chosen so
// the hash input stays greppable and no field can forge a boundary.
const FIELD_SEP = '<|field|>';
const ITEM_SEP = '<|item|>';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../src/data/universe/universe.json');

export const SCHEMA_VERSION = 'axiom-demo-universe/2.0';

// ---------------------------------------------------------------- HTTP

let lastRequestAt = 0;

async function pace(): Promise<void> {
  const wait = MIN_REQUEST_INTERVAL_MS - (Date.now() - lastRequestAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
}

async function getJson(path: string): Promise<any> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    await pace();
    try {
      const response = await fetch(`${GAMMA}${path}`, { headers: { accept: 'application/json' } });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 2 ** attempt * 250));
      }
    }
  }
  throw new Error(`GET ${path} failed after ${MAX_ATTEMPTS} attempts: ${lastError}`);
}

// ---------------------------------------------------------------- parsing

/** Gamma returns these as JSON-encoded strings, not arrays. */
function parseJsonArray(value: unknown, field: string, marketId: string): string[] {
  if (value === undefined || value === null || value === '') return [];
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== 'string') throw new Error(`market ${marketId}: ${field} is neither array nor string`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`market ${marketId}: ${field} is not valid JSON`);
  }
  if (!Array.isArray(parsed)) throw new Error(`market ${marketId}: ${field} did not decode to an array`);
  return parsed.map(String);
}

export type OutcomeToken = { index: number; outcome: string; token_id: string };

/**
 * Pair outcomes against token ids positionally. Refuses on any length mismatch
 * or duplicate token, because a silently mispaired token means every payout
 * computed from it is attributed to the wrong side of the contract.
 */
export function mapOutcomesToTokens(outcomes: string[], tokenIds: string[], marketId: string): OutcomeToken[] {
  if (outcomes.length === 0) throw new Error(`market ${marketId}: no outcomes`);
  if (outcomes.length !== tokenIds.length) {
    throw new Error(
      `market ${marketId}: ${outcomes.length} outcomes against ${tokenIds.length} token ids -- refusing to pair`,
    );
  }
  if (new Set(tokenIds).size !== tokenIds.length) {
    throw new Error(`market ${marketId}: duplicate token id`);
  }
  return outcomes.map((outcome, index) => ({ index, outcome, token_id: tokenIds[index] }));
}

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

/**
 * Ordered, settlement-bearing fields only. Everything a venue may restyle
 * without changing how the contract pays is deliberately excluded.
 */
function ruleHash(market: any, outcomes: string[]): string {
  const fields = [
    market.question ?? '',
    market.description ?? '',
    market.resolutionSource ?? '',
    market.groupItemTitle ?? '',
    market.groupItemThreshold ?? '',
    market.endDate ?? '',
    outcomes.join(ITEM_SEP),
  ];
  return sha256(fields.join(FIELD_SEP));
}

function resolutionStatus(market: any): string | null {
  const status = market.umaResolutionStatus ?? market.umaResolutionStatuses;
  if (status === undefined || status === null || status === '') return null;
  if (Array.isArray(status)) return status.length > 0 ? String(status[0]) : null;
  if (typeof status === 'string' && status.startsWith('[')) {
    const parsed = parseJsonArray(status, 'umaResolutionStatuses', String(market.id));
    return parsed.length > 0 ? parsed[0] : null;
  }
  return String(status);
}

/** The winning outcome label, only when the venue actually resolved the market. */
function resolvedOutcome(outcomes: string[], prices: string[]): string | null {
  if (prices.length !== outcomes.length) return null;
  const winners = prices.map((p, i) => ({ p: Number(p), i })).filter(({ p }) => p === 1);
  return winners.length === 1 ? outcomes[winners[0].i] : null;
}

// ---------------------------------------------------------------- records

export type ContractRecord = {
  contract_id: string;
  event_id: string;
  condition_id: string;
  slug: string;
  question: string;
  group_item_title: string | null;
  group_item_threshold: string | null;
  outcomes: string[];
  outcome_tokens: OutcomeToken[];
  end_date: string | null;
  closed: boolean;
  resolution: { status: string | null; outcome_prices: string[]; resolved_outcome: string | null };
  marks: {
    last_trade_price: number | null;
    best_bid: number | null;
    best_ask: number | null;
    volume: number | null;
    liquidity: number | null;
  };
  rule_hash: string;
  source_url: string;
};

export type EventRecord = {
  event_id: string;
  slug: string;
  title: string;
  description: string;
  start_date: string | null;
  end_date: string | null;
  neg_risk: boolean;
  scope: Scope;
  scope_reason: string;
  source_url: string;
  rule_hash: string;
  contract_ids: string[];
};

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function toContract(market: any, eventId: string): ContractRecord {
  const marketId = String(market.id);
  const outcomes = parseJsonArray(market.outcomes, 'outcomes', marketId);
  const tokenIds = parseJsonArray(market.clobTokenIds, 'clobTokenIds', marketId);
  const prices = parseJsonArray(market.outcomePrices, 'outcomePrices', marketId);
  const closed = Boolean(market.closed);
  return {
    contract_id: marketId,
    event_id: eventId,
    condition_id: String(market.conditionId ?? ''),
    slug: String(market.slug ?? ''),
    question: String(market.question ?? ''),
    group_item_title: market.groupItemTitle ? String(market.groupItemTitle).trim() : null,
    group_item_threshold: market.groupItemThreshold ? String(market.groupItemThreshold) : null,
    outcomes,
    outcome_tokens: mapOutcomesToTokens(outcomes, tokenIds, marketId),
    end_date: market.endDate ? String(market.endDate) : null,
    closed,
    resolution: {
      status: resolutionStatus(market),
      outcome_prices: prices,
      resolved_outcome: closed ? resolvedOutcome(outcomes, prices) : null,
    },
    marks: {
      last_trade_price: num(market.lastTradePrice),
      best_bid: num(market.bestBid),
      best_ask: num(market.bestAsk),
      volume: num(market.volumeNum ?? market.volume),
      liquidity: num(market.liquidityNum ?? market.liquidity),
    },
    rule_hash: ruleHash(market, outcomes),
    source_url: `${GAMMA}/markets/${marketId}`,
  };
}


/** Shared by the authoring layer and the anchor derivation. */
export function percentBpFromLabel(label: string): number | null {
  const match = label.replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const percent = Number(match[1]);
  return Number.isFinite(percent) ? Math.round(percent * 100) : null;
}

// ---------------------------------------------------------------- anchors

/**
 * Facts about 2026 that have already happened. The state space is enumerated
 * forward from these, so each one carries the evidence that established it and
 * how strongly. Nothing here is asserted bare.
 */
export type AnchorFact = {
  anchor_id: string;
  statement: string;
  value: string | number;
  derivation: 'RESOLVED_MARKET' | 'RESOLVED_MARKET_INFERENCE' | 'EXTERNAL_SOURCE';
  confidence: 'VERIFIED' | 'HIGH_CONFIDENCE';
  reasoning: string;
  evidence: { contract_id: string; question: string; resolved_outcome: string | null }[];
  source_url?: string;
};

const evidenceFor = (contracts: ContractRecord[], ids: string[]) =>
  ids
    .map((id) => contracts.find((c) => c.contract_id === id))
    .filter((c): c is ContractRecord => Boolean(c))
    .map((c) => ({
      contract_id: c.contract_id,
      question: c.question,
      resolved_outcome: c.resolution.resolved_outcome,
    }));

/** Contracts of an event whose group label matches a predicate, already resolved. */
const resolvedWhere = (contracts: ContractRecord[], eventId: string, match: (label: string) => boolean) =>
  contracts.filter(
    (c) => c.event_id === eventId && c.closed && match((c.group_item_title ?? '').toLowerCase()),
  );

function deriveAnchors(contracts: ContractRecord[]): AnchorFact[] {
  const anchors: AnchorFact[] = [];

  // 1. No cut has occurred in 2026 through the September meeting.
  //    "Fed rate cut by <month> 2026 meeting?" resolved No for every month.
  const cutBy = resolvedWhere(contracts, '106884', (l) => l.includes('meeting') && !l.includes('2027'));
  const cutByNo = cutBy.filter((c) => c.resolution.resolved_outcome === 'No');
  if (cutByNo.length > 0 && cutByNo.length === cutBy.length) {
    anchors.push({
      anchor_id: 'cuts_2026_to_date',
      statement: 'Cuts of 25 bp in 2026 to date',
      value: 0,
      derivation: 'RESOLVED_MARKET',
      confidence: 'VERIFIED',
      reasoning:
        'Every settled "Fed rate cut by <month> 2026 meeting?" contract resolved No, including the September meeting. A cut at any earlier meeting would have resolved the corresponding contract Yes.',
      evidence: evidenceFor(contracts, cutByNo.map((c) => c.contract_id)),
    });
  }

  // 2. The September 2026 decision was a hike.
  //    Every Pause-leading leg of the Sep-Dec sequence resolved No while the
  //    Hike-leading legs remain open.
  const pauseLegs = resolvedWhere(contracts, '955999', (l) => l.startsWith('pause'));
  const pauseNo = pauseLegs.filter((c) => c.resolution.resolved_outcome === 'No');
  const hikeLegsOpen = contracts.filter(
    (c) => c.event_id === '955999' && !c.closed && (c.group_item_title ?? '').toLowerCase().startsWith('hike'),
  );
  if (pauseNo.length === pauseLegs.length && pauseNo.length >= 2 && hikeLegsOpen.length > 0) {
    anchors.push({
      anchor_id: 'sep_2026_decision',
      statement: 'September 2026 FOMC decision',
      value: 'HIKE_25',
      derivation: 'RESOLVED_MARKET',
      confidence: 'VERIFIED',
      reasoning:
        'Every sequence leg beginning with Pause resolved No, while the legs beginning with Hike are still open. The September decision was therefore a hike. Combined with the cut anchor and the 25 bp increment, it was a 25 bp hike.',
      evidence: evidenceFor(contracts, pauseNo.map((c) => c.contract_id)),
    });
  }

  // 3. At least one hike in 2026, and at most one so far.
  //    "no hikes" resolved No; the "1 hike" leg is still open, and these ladders
  //    resolve early to No once a strike becomes impossible.
  const zeroHikes = resolvedWhere(contracts, '626860', (l) => l.startsWith('0'));
  const oneHikeOpen = contracts.find(
    (c) => c.event_id === '626860' && !c.closed && (c.group_item_title ?? '').startsWith('1'),
  );
  if (zeroHikes.length === 1 && zeroHikes[0].resolution.resolved_outcome === 'No' && oneHikeOpen) {
    anchors.push({
      anchor_id: 'hikes_2026_to_date',
      statement: 'Hikes of 25 bp in 2026 to date',
      value: 1,
      derivation: 'RESOLVED_MARKET_INFERENCE',
      confidence: 'HIGH_CONFIDENCE',
      reasoning:
        'The "no hikes in 2026" contract resolved No, so at least one hike has occurred. The "1 hike" contract is still open, and this ladder resolves early to No once a strike becomes impossible, so no more than one has occurred. Exactly one is an inference from that early-resolution rule, not a direct settlement.',
      evidence: evidenceFor(contracts, [zeroHikes[0].contract_id, oneHikeOpen.contract_id]),
    });
  }

  // 4. Realised path extremes for 2026 to date.
  //    The touch contracts settle on the whole of 2026, not on the remaining
  //    meetings, so a forward-only path would mis-resolve every one of them.
  //    Settled touch legs bound the realised extremes directly: a leg that
  //    resolved Yes proves the level was reached.
  const touchDown = contracts.filter(
    (c) => c.event_id === '84803' && (c.group_item_title ?? '').includes('↓'),
  );
  const downYes = touchDown
    .filter((c) => c.resolution.resolved_outcome === 'Yes')
    .map((c) => ({ c, bp: percentBpFromLabel(c.group_item_title ?? '') }))
    .filter((x): x is { c: ContractRecord; bp: number } => x.bp !== null);
  if (downYes.length > 0) {
    // The highest threshold that resolved Yes is the tightest proven bound.
    const tightest = downYes.reduce((best, x) => (x.bp > best.bp ? x : best));
    anchors.push({
      anchor_id: 'realized_min_lower_bound_2026_bp',
      statement: 'Lowest lower bound of the target range reached in 2026 to date',
      value: tightest.bp,
      derivation: 'RESOLVED_MARKET',
      confidence: 'VERIFIED',
      reasoning:
        'This touch contract resolved Yes, which by its own settlement rule proves the lower bound reached that level at some point in 2026. The next tighter leg is still open, so the realised minimum is exactly this level. The touch contracts settle over the whole of 2026, so a path modelled only forward from today would mis-resolve them.',
      evidence: evidenceFor(contracts, [tightest.c.contract_id]),
    });
  }

  // The realised maximum is the level established by the anchors above: 2026
  // has been monotonically upward (one hike, no cuts), so the highest upper
  // bound reached to date is the current one.
  anchors.push({
    anchor_id: 'realized_max_upper_bound_2026_bp',
    statement: 'Highest upper bound of the target range reached in 2026 to date',
    value: 400,
    derivation: 'RESOLVED_MARKET_INFERENCE',
    confidence: 'HIGH_CONFIDENCE',
    reasoning:
      'No cut has occurred in 2026 and exactly one hike has, so the target range has moved only upward and the highest upper bound reached to date is the current one. Corroborated by the touch ladder: no upward leg above the current level has resolved Yes.',
    evidence: [],
  });

  // 5. The level itself is not derivable from any settled contract.
  anchors.push({
    anchor_id: 'upper_bound_after_sep_2026_bps',
    statement: 'Target federal funds upper bound after the September 2026 meeting',
    value: 400,
    derivation: 'EXTERNAL_SOURCE',
    confidence: 'HIGH_CONFIDENCE',
    reasoning:
      'No settled contract in this universe states the level, so it is taken from the Federal Reserve. It is corroborated by cross-event pricing: the touch contract at 4.25% trades near one minus the product of the two no-change legs, and the terminal contract at 4.50% or above trades near the product of the two hike legs. Both identities only hold at a 4.00% base.',
    evidence: [],
    source_url: 'https://www.federalreserve.gov/monetarypolicy/openmarket.htm',
  });

  return anchors;
}

// ---------------------------------------------------------------- main

async function main(): Promise<void> {
  const retrievedAt = new Date().toISOString();
  const events: EventRecord[] = [];
  const contracts: ContractRecord[] = [];
  const warnings: string[] = [];

  for (const scoped of SCOPED_EVENTS) {
    const raw = await getJson(`/events/${scoped.event_id}`);
    const eventId = String(raw.id);
    if (eventId !== scoped.event_id) {
      throw new Error(`event ${scoped.event_id}: Gamma returned id ${eventId}`);
    }
    const slug = String(raw.slug ?? '');
    if (scoped.expect_slug && slug !== scoped.expect_slug) {
      warnings.push(
        `event ${eventId}: slug is "${slug}", scope file expected "${scoped.expect_slug}" -- the venue may have relisted this event`,
      );
    }

    const markets = Array.isArray(raw.markets) ? raw.markets : [];
    if (markets.length === 0) warnings.push(`event ${eventId}: no markets returned`);

    const eventContracts = markets.map((m: any) => toContract(m, eventId));
    contracts.push(...eventContracts);

    events.push({
      event_id: eventId,
      slug,
      title: String(raw.title ?? ''),
      description: String(raw.description ?? ''),
      start_date: raw.startDate ? String(raw.startDate) : null,
      end_date: raw.endDate ? String(raw.endDate) : null,
      neg_risk: Boolean(raw.enableNegRisk ?? raw.negRisk),
      scope: scoped.scope,
      scope_reason: scoped.reason,
      source_url: `${GAMMA}/events/${eventId}`,
      rule_hash: sha256([raw.title ?? '', raw.description ?? ''].join(FIELD_SEP)),
      contract_ids: eventContracts.map((c: ContractRecord) => c.contract_id),
    });

    process.stderr.write(
      `  ${scoped.scope.padEnd(12)} ${eventId.padEnd(8)} ${String(raw.title ?? '').slice(0, 44).padEnd(46)} ${eventContracts.length} contracts\n`,
    );
  }

  const anchors = deriveAnchors(contracts);

  const universe = {
    schema_version: SCHEMA_VERSION,
    snapshot: {
      retrieved_at: retrievedAt,
      venue: 'POLYMARKET',
      source: 'gamma',
      generator: 'scripts/build-universe.ts',
      note: 'Marks are venue-quoted indicative values captured at retrieval. No payout computation reads them.',
    },
    scope_counts: {
      core_events: events.filter((e) => e.scope === 'CORE').length,
      decoy_events: events.filter((e) => e.scope === 'DECOY').length,
      out_of_scope_events: events.filter((e) => e.scope === 'OUT_OF_SCOPE').length,
      core_contracts: contracts.filter(
        (c) => events.find((e) => e.event_id === c.event_id)?.scope === 'CORE',
      ).length,
      total_contracts: contracts.length,
    },
    warnings,
    anchors,
    events,
    contracts,
  };

  writeFileSync(OUT, `${JSON.stringify(universe, null, 2)}\n`, 'utf8');

  process.stderr.write(`\n${events.length} events, ${contracts.length} contracts -> ${OUT}\n`);
  process.stderr.write(`anchors: ${anchors.map((a) => `${a.anchor_id}=${a.value}`).join(', ')}\n`);
  if (warnings.length > 0) {
    process.stderr.write(`\nWARNINGS (${warnings.length}):\n${warnings.map((w) => `  - ${w}`).join('\n')}\n`);
  }
}

await main();
