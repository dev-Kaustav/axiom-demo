import { useMemo, useState, type CSSProperties } from 'react';
import { Panel, Badge, ResizeHandle, useColumnWidth } from './primitives';
import { ContributionTable } from './ScenarioExplorer';
import {
  CONTRACT_VIEWS,
  PROPOSED_TRADE,
  contractView,
  exposureSummary,
  money,
  rankedOffsets,
  scenarioRows,
  tradeAsPosition,
  type Position,
} from '../domain/engine';

/**
 * What happens if I make this trade?
 *
 * Nothing is executed. The hypothetical position is appended to the book and
 * every number is recomputed, so the comparison is like for like. The book as
 * it stands is on screen before anything is simulated -- an empty right-hand
 * side would waste the only screen where a trader compares two states.
 */
export function TradeSimulator({
  positions,
  onContract,
}: {
  positions: Position[];
  onContract: (contractId: string) => void;
}) {
  const tradeable = useMemo(
    () => CONTRACT_VIEWS.filter((v) => v.authored.claim !== null && !v.degenerate),
    [],
  );

  const ticket = useColumnWidth(300);
  const [contractId, setContractId] = useState(PROPOSED_TRADE.contract_id);
  const [side, setSide] = useState<'YES' | 'NO'>(PROPOSED_TRADE.side);
  const [quantity, setQuantity] = useState(String(PROPOSED_TRADE.quantity));
  const [priceText, setPriceText] = useState(PROPOSED_TRADE.entry_price_text);
  const [applied, setApplied] = useState<Position | null>(null);

  const quantityValue = Number(quantity);
  const priceValue = Number(priceText);
  const valid =
    Number.isFinite(quantityValue) &&
    quantityValue > 0 &&
    Number.isFinite(priceValue) &&
    priceValue > 0 &&
    priceValue < 1 &&
    Number.isInteger(Math.round(priceValue * 10000)) &&
    (quantityValue * Math.round(priceValue * 10000)) % 100 === 0;

  const premiumCents = valid ? (quantityValue * Math.round(priceValue * 10000)) / 100 : null;
  const maxPayoutCents = valid ? quantityValue * 100 : null;

  const simulate = () => {
    if (!valid) return;
    setApplied(
      tradeAsPosition({
        contract_id: contractId,
        side,
        quantity: quantityValue,
        entry_price_x4: Math.round(priceValue * 10000),
        entry_price_text: priceText,
      }),
    );
  };

  // Changing the order invalidates a comparison drawn against the old one.
  const edit = <T,>(set: (value: T) => void) => (value: T) => {
    set(value);
    setApplied(null);
  };

  return (
    <div className="trade-layout" style={{ '--side-width': `${ticket.width}px` } as CSSProperties}>
      <Panel title="Hypothetical trade" eyebrow="NOTHING IS EXECUTED" className="ticket-panel">
        <form
          className="trade-form"
          onSubmit={(e) => {
            e.preventDefault();
            simulate();
          }}
        >
          <label className="field-label" htmlFor="trade-contract">
            Contract
          </label>
          <select
            id="trade-contract"
            value={contractId}
            onChange={(e) => edit(setContractId)(e.target.value)}
          >
            {tradeable.map((v) => (
              <option key={v.contract.contract_id} value={v.contract.contract_id}>
                {v.displayName}
              </option>
            ))}
          </select>

          <div className="ticket-grid">
            <div>
              <label className="field-label" htmlFor="trade-side">
                Side
              </label>
              <select
                id="trade-side"
                value={side}
                onChange={(e) => edit(setSide)(e.target.value as 'YES' | 'NO')}
              >
                <option value="YES">YES</option>
                <option value="NO">NO</option>
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="trade-quantity">
                Quantity
              </label>
              <input
                id="trade-quantity"
                className="numeric"
                inputMode="numeric"
                value={quantity}
                onChange={(e) => edit(setQuantity)(e.target.value)}
              />
            </div>
            <div>
              <label className="field-label" htmlFor="trade-price">
                Price
              </label>
              <input
                id="trade-price"
                className="numeric"
                inputMode="decimal"
                value={priceText}
                onChange={(e) => edit(setPriceText)(e.target.value)}
              />
            </div>
          </div>

          <dl className="ticket-readout">
            <div>
              <dt>Premium</dt>
              <dd className="mono">{premiumCents === null ? '—' : money(premiumCents)}</dd>
            </div>
            <div>
              <dt>Maximum payout</dt>
              <dd className="mono">{maxPayoutCents === null ? '—' : money(maxPayoutCents)}</dd>
            </div>
            <div>
              <dt>At risk</dt>
              <dd className="mono negative">
                {premiumCents === null ? '—' : money(-premiumCents, true)}
              </dd>
            </div>
          </dl>

          <button type="submit" className="primary-button" disabled={!valid}>
            Simulate trade
          </button>
          {!valid && (
            <p className="panel-footnote">
              Quantity and price must produce a whole number of cents. Prices are between 0 and 1.
            </p>
          )}
        </form>
      </Panel>

      <ResizeHandle value={ticket.width} min={250} max={560} onChange={ticket.setWidth} label="Trade ticket width" />
      <Comparison positions={positions} trade={applied} onContract={onContract} />
    </div>
  );
}

/**
 * The book before, the book after, and the difference. The before column is
 * always real; the after column stays blank until a trade is simulated, which
 * keeps the comparison honest rather than filling the screen with the same
 * number twice.
 */
function Comparison({
  positions,
  trade,
  onContract,
}: {
  positions: Position[];
  trade: Position | null;
  onContract: (contractId: string) => void;
}) {
  const before = useMemo(() => exposureSummary(positions), [positions]);
  const beforeRows = useMemo(() => scenarioRows(positions), [positions]);

  const after = trade ? [...positions, trade] : null;
  const afterSummary = after ? exposureSummary(after) : null;
  const afterRows = after ? scenarioRows(after) : null;

  // Scenarios that get materially worse, even where the headline improves.
  const beforeByKey = new Map(beforeRows.map((r) => [r.scenario.label, r.pnlCents]));
  const worsened = (afterRows ?? [])
    .map((r) => ({ row: r, delta: r.pnlCents - (beforeByKey.get(r.scenario.label) ?? r.pnlCents) }))
    .filter((x) => x.delta < 0)
    .sort((a, b) => a.delta - b.delta)
    .slice(0, 6);

  const touched = after
    ? rankedOffsets(after).filter(
        (o) => o.a.position_id === 'proposed' || o.b.position_id === 'proposed',
      )
    : [];

  const view = trade ? contractView(trade.contract_id) : null;

  const METRICS = [
    { label: 'Worst outcome', b: before.worst.pnlCents, a: afterSummary?.worst.pnlCents, signed: true },
    { label: 'Best outcome', b: before.best.pnlCents, a: afterSummary?.best.pnlCents, signed: true },
    { label: 'Capital deployed', b: before.costCents, a: afterSummary?.costCents, signed: false },
    {
      label: 'Loss-making outcomes',
      b: beforeRows.filter((r) => r.pnlCents < 0).length,
      a: afterRows?.filter((r) => r.pnlCents < 0).length,
      count: true,
    },
    {
      label: 'Distinct outcomes',
      b: beforeRows.length,
      a: afterRows?.length,
      count: true,
    },
  ];

  return (
    <>
      <Panel
        title="Before and after"
        eyebrow={trade && view ? `${trade.side} ${view.displayName}` : 'AWAITING A SIMULATION'}
        actions={trade ? <Badge tone="amber">simulated</Badge> : undefined}
      >
        <table className="master-table compare-table">
          <thead>
            <tr>
              <th scope="col">Measure</th>
              <th scope="col" className="numeric">
                Before
              </th>
              <th scope="col" className="numeric">
                After
              </th>
              <th scope="col" className="numeric">
                Change
              </th>
            </tr>
          </thead>
          <tbody>
            {METRICS.map((m) => {
              const delta = m.a === undefined ? null : m.a - m.b;
              const fmt = (v: number, signed: boolean) =>
                m.count
                  ? `${signed && v > 0 ? '+' : ''}${v.toLocaleString('en-US')}`
                  : money(v, signed);
              return (
                <tr key={m.label}>
                  <th scope="row">{m.label}</th>
                  <td className={`numeric mono ${m.signed ? (m.b < 0 ? 'negative' : 'positive') : ''}`}>
                    {fmt(m.b, !!m.signed)}
                  </td>
                  <td
                    className={`numeric mono ${m.a === undefined ? 'muted' : m.signed ? (m.a < 0 ? 'negative' : 'positive') : ''}`}
                  >
                    {m.a === undefined ? '—' : fmt(m.a, !!m.signed)}
                  </td>
                  <td
                    className={`numeric mono ${
                      delta === null || delta === 0 || !m.signed
                        ? 'muted'
                        : delta > 0
                          ? 'positive'
                          : 'negative'
                    }`}
                  >
                    {delta === null ? '—' : delta === 0 ? 'no change' : fmt(delta, true)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="panel-footnote">
          Every figure is recomputed over the whole book in every modelled world. Nothing is
          executed, and no fee, financing or slippage is modelled.
        </p>
      </Panel>

      <Panel
        title="Outcomes this trade makes worse"
        eyebrow={trade ? `${worsened.length} shown` : 'AWAITING A SIMULATION'}
        className={trade ? '' : 'awaiting'}
      >
        {trade && (
          <p className="quiet-copy">
            A trade can improve the headline worst case and still create exposure somewhere else.
            These outcomes pay less after the trade than before it.
          </p>
        )}
        {!trade ? (
          <p className="empty-state">
            Simulate an order to see which outcomes pay less after it than before it.
          </p>
        ) : worsened.length === 0 ? (
          <p className="empty-state">No modelled outcome pays less after this trade.</p>
        ) : (
          <ul className="failure-list">
            {worsened.map(({ row, delta }) => (
              <li key={row.scenario.key}>
                <span className="extreme-label">{row.scenario.label}</span>
                <span className="mono negative">{money(delta, true)}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        title="Positions this trade touches"
        eyebrow={trade ? `${touched.length} pairs` : 'AWAITING A SIMULATION'}
        className={trade ? '' : 'awaiting'}
      >
        {!trade ? (
          <p className="empty-state">Simulate an order to see which held positions it offsets.</p>
        ) : touched.length === 0 ? (
          <p className="empty-state">This trade does not interact with any existing position.</p>
        ) : (
          <ul className="offset-list">
            {touched.slice(0, 6).map((o) => {
              const other = o.a.position_id === 'proposed' ? o.b : o.a;
              return (
                <li key={other.position_id} className="offset-row">
                  <div className="offset-summary static">
                    <span className="offset-legs">
                      {other.side} {contractView(other.contract_id).displayName}
                    </span>
                    <span className="offset-meta">
                      <Badge tone={o.klass === 'EXACT' || o.klass === 'PARTIAL' ? 'teal' : 'amber'}>
                        {o.klass}
                      </Badge>
                      <span className="mono">{Math.round(o.coverageFraction * 100)}% of outcomes</span>
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel
        title={trade ? 'Worst outcome, after the trade' : 'Worst outcome, as the book stands'}
        eyebrow={(afterSummary ?? before).worst.scenario.label}
      >
        <ContributionTable
          positions={after ?? positions}
          stateIndex={(afterSummary ?? before).worst.index}
          onContract={onContract}
          highlightId={trade ? 'proposed' : undefined}
        />
      </Panel>
    </>
  );
}
