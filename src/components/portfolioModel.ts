import { SNAPSHOT, contractView, shortEventName, type Position } from '../domain/engine';
export type Grouping = 'Event' | 'Payoff structure' | 'Side';
export function payoffFamily(id: string): string {
  const claim = contractView(id).authored.claim;
  if (!claim) return 'Not interpreted';
  const metric = claim.predicate?.metric ?? '';
  if (metric.includes('bucket')) return 'Scheduled decisions';
  if (metric.includes('terminal')) return 'Terminal rate';
  if (metric.includes('max_') || metric.includes('min_')) return 'Rate touched';
  if (metric.includes('scheduled_path')) return 'Decision sequences';
  if (metric === 'hikes_2026' || metric === 'cuts_2026') return 'Move counts';
  return 'Conditional events';
}
/**
 * Why a contract can or cannot take part in relation inference.
 *
 * The three reasons a contract carries no edge are not one reason, and the
 * canvas must never merge them: a settled contract is determinate and the venue
 * agrees, an out-of-alphabet contract is a limit of this model, and a refused
 * contract was never interpreted at all.
 */
export type ContractStatus = { group: string; flag: string | null; reason: string };
export function contractStatus(id: string): ContractStatus {
  const v = contractView(id);
  if (!v.authored.claim) return {group: 'No predicate', flag: 'NO PREDICATE', reason: v.authored.rationale};
  if (v.degenerate) return v.degenerate.cause === 'SETTLED'
    ? {group: 'Settled by venue', flag: 'SETTLED', reason: v.degenerate.reason}
    : {group: 'Outside move alphabet', flag: 'OUT OF ALPHABET', reason: v.degenerate.reason};
  return {group: 'Interpreted', flag: null, reason: v.authored.rationale};
}

/** The same drill-down dimensions the positions navigator offers, over
 *  contracts rather than lots. A contract has no side, so status takes that
 *  slot: at universe scope it is what explains an edgeless node. */
export type ContractGrouping = 'Event' | 'Payoff structure' | 'Status' | 'Venue';
export function contractGroup(id: string, grouping: ContractGrouping): string {
  if (grouping === 'Payoff structure') return payoffFamily(id);
  if (grouping === 'Status') return contractStatus(id).group;
  if (grouping === 'Venue') return SNAPSHOT.venue;
  return shortEventName(contractView(id).event);
}

export function groupPositions(positions: Position[], grouping: Grouping) {
  const grouped = new Map<string, Position[]>();
  for (const p of positions) {
    const key = grouping === 'Side' ? p.side : grouping === 'Payoff structure' ? payoffFamily(p.contract_id) : contractView(p.contract_id).event.title;
    grouped.set(key, [...(grouped.get(key) ?? []), p]);
  }
  return [...grouped].map(([name, rows]) => ({name, positions: rows}));
}
