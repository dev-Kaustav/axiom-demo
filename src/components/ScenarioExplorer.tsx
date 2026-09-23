import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Panel, Badge, KeyValue, ResizeHandle, useColumnWidth } from './primitives';
import {
  ASSUMPTIONS,
  bpPercent,
  contractName,
  contractView,
  describeState,
  facts,
  money,
  portfolioAt,
  scenarioRows,
  type Position,
  type WorldState,
} from '../domain/engine';

type SortKey = 'pnl' | 'payout' | 'label' | 'worlds';

/** The five free variables, in the order they happen. */
const FIELDS = [
  { key: 'october', head: 'October', scheduled: true },
  { key: 'december', head: 'December', scheduled: true },
  { key: 'interSepOct', head: 'Pre-Oct', scheduled: false },
  { key: 'interOctDec', head: 'Oct→Dec', scheduled: false },
  { key: 'postDec', head: 'Post-Dec', scheduled: false },
] as const satisfies readonly { key: keyof WorldState; head: string; scheduled: boolean }[];

/** A move as a trader reads it in a column: signed, or a dot for no move. */
const moveCell = (bp: number) =>
  bp === 0 ? <span className="no-move">·</span> : <>{bp > 0 ? '+' : '−'}{Math.abs(bp)}</>;

/**
 * What happens under this outcome? Every economically distinct scenario, with
 * the five decisions in comparable columns rather than in a sentence, and the
 * positions that produced the selected number alongside.
 *
 * The table lists scenarios, not worlds. Worlds that pay this book identically
 * are one row, and the row says how many worlds it stands for, so nothing is
 * hidden by the collapse.
 */
export function ScenarioExplorer({
  positions,
  selectedKey,
  onSelect,
  onContract,
}: {
  positions: Position[];
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  onContract: (contractId: string) => void;
}) {
  const side = useColumnWidth(330);
  const [sort, setSort] = useState<SortKey>('pnl');
  const [ascending, setAscending] = useState(true);

  const rows = useMemo(() => scenarioRows(positions), [positions]);

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const value =
        sort === 'pnl'
          ? a.pnlCents - b.pnlCents
          : sort === 'payout'
            ? a.payoutCents - b.payoutCents
            : sort === 'worlds'
              ? a.scenario.memberCount - b.scenario.memberCount
              : a.scenario.label.localeCompare(b.scenario.label);
      return ascending ? value : -value;
    });
    return copy;
  }, [rows, sort, ascending]);

  const selected = rows.find((r) => r.scenario.key === selectedKey) ?? sorted[0];
  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.pnlCents)), 1);
  const losing = rows.filter((r) => r.pnlCents < 0).length;

  const toggle = (key: SortKey) => {
    if (key === sort) setAscending((a) => !a);
    else {
      setSort(key);
      setAscending(key === 'label');
    }
  };

  const ariaSort = (key: SortKey) =>
    sort === key ? (ascending ? ('ascending' as const) : ('descending' as const)) : ('none' as const);

  return (
    <div className="scenario-explorer">
      <div className="summary-strip">
        <KeyValue label="Distinct outcomes">
          {rows.length}
          <small>Worlds that pay this book alike are one row</small>
        </KeyValue>
        <KeyValue label="Loss-making">
          <span className="negative">{losing}</span>
          <span className="metric-denominator"> / {rows.length}</span>
          <small>Counts of outcomes, never odds</small>
        </KeyValue>
        <KeyValue label="Worst outcome">
          <span className="negative">{money(sorted[0] ? Math.min(...rows.map((r) => r.pnlCents)) : 0, true)}</span>
          <small>Across every modelled world</small>
        </KeyValue>
        <KeyValue label="Best outcome">
          <span className="positive">{money(Math.max(...rows.map((r) => r.pnlCents)), true)}</span>
          <small>Across every modelled world</small>
        </KeyValue>
        <KeyValue label="Selected">
          <span className={selected.pnlCents < 0 ? 'negative' : 'positive'}>
            {money(selected.pnlCents, true)}
          </span>
          <small>{selected.scenario.memberCount} world{selected.scenario.memberCount === 1 ? '' : 's'} in this row</small>
        </KeyValue>
      </div>

      <div className="scenario-workspace" style={{ '--side-width': `${side.width}px` } as CSSProperties}>
        <Panel
          title="Scenario outcomes"
          eyebrow={`${rows.length} distinct`}
          className="scenario-panel"
          actions={
            <span className="quiet-copy">
              Sorted by {sort === 'pnl' ? 'profit and loss' : sort}, {ascending ? 'worst first' : 'best first'}
            </span>
          }
        >
          <div className="table-scroll scenario-scroll">
            <table className="matrix-table scenario-table">
              <thead>
                <tr className="group-head">
                  <th scope="colgroup" colSpan={2} className="section-label">
                    SCHEDULED DECISIONS
                  </th>
                  <th scope="colgroup" colSpan={3} className="section-label field-break">
                    INTER-MEETING WINDOWS
                  </th>
                  <th scope="colgroup" className="section-label field-break">
                    RATE PATH
                  </th>
                  <th scope="colgroup" colSpan={4} className="section-label field-break">
                    BOOK RESULT
                  </th>
                </tr>
                <tr>
                  {FIELDS.map((f, i) => (
                    <th
                      key={f.key}
                      scope="col"
                      className={`numeric move-head ${i === 2 ? 'field-break' : ''}`}
                      aria-sort={i === 0 ? ariaSort('label') : undefined}
                    >
                      {i === 0 ? (
                        <button type="button" className="text-button" onClick={() => toggle('label')}>
                          {f.head}
                        </button>
                      ) : (
                        f.head
                      )}
                    </th>
                  ))}
                  <th scope="col" className="numeric field-break bound-head">
                    Upper bound
                  </th>
                  <th scope="col" aria-sort={ariaSort('worlds')} className="numeric field-break">
                    <button type="button" className="text-button" onClick={() => toggle('worlds')}>
                      Worlds
                    </button>
                  </th>
                  <th scope="col" aria-sort={ariaSort('payout')} className="numeric">
                    <button type="button" className="text-button" onClick={() => toggle('payout')}>
                      Terminal payout
                    </button>
                  </th>
                  <th scope="col" aria-sort={ariaSort('pnl')} className="numeric">
                    <button type="button" className="text-button" onClick={() => toggle('pnl')}>
                      Profit and loss
                    </button>
                  </th>
                  <th scope="col" className="bar-head">
                    <span className="sr-only">Profit and loss, to scale</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((row) => (
                  <ScenarioRowView
                    key={row.scenario.key}
                    row={row}
                    selected={row.scenario.key === selected.scenario.key}
                    maxAbs={maxAbs}
                    onSelect={() => onSelect(row.scenario.key)}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <p className="panel-footnote">
            Basis points per decision. A dot means no move in that window. Each row stands for every
            world that pays this book the same amount, so the Worlds column is a count, not a weight.
          </p>
        </Panel>

        <ResizeHandle value={side.width} min={260} max={680} invert onChange={side.setWidth} label="Selected outcome panel width" />
        <Panel title="Selected outcome" eyebrow="LINKED" className="scenario-detail">
          <SelectedOutcome
            row={selected}
            positions={positions}
            onContract={onContract}
          />
        </Panel>
      </div>

      <details className="model-assumptions">
        <summary>Model scope and assumptions</summary>
        <ul>
          {ASSUMPTIONS.map((a) => (
            <li key={a.id}>
              <strong>{a.statement}</strong> {a.consequence}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function ScenarioRowView({
  row,
  selected,
  maxAbs,
  onSelect,
}: {
  row: ReturnType<typeof scenarioRows>[number];
  selected: boolean;
  maxAbs: number;
  onSelect: () => void;
}) {
  const ref = useRef<HTMLTableRowElement>(null);
  const s = row.scenario.representative;
  const loss = row.pnlCents < 0;

  // A selection made on another screen has to be findable here.
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  return (
    <tr ref={ref} className={selected ? 'selected-row' : ''} onClick={onSelect}>
      {FIELDS.map((f, i) => {
        const bp = s[f.key];
        const weight = f.scheduled ? Math.abs(bp) / 100 : Math.abs(bp) / 25;
        const cell = (
          <span
            className="move-chip"
            style={bp === 0 ? undefined : { background: `rgba(255,255,255,${0.03 + weight * 0.05})` }}
          >
            {moveCell(bp)}
          </span>
        );
        return i === 0 ? (
          <th key={f.key} scope="row" className="numeric move-cell">
            <button
              type="button"
              className="text-button"
              aria-label={describeState(s)}
              aria-pressed={selected}
              onClick={onSelect}
            >
              {cell}
            </button>
          </th>
        ) : (
          <td key={f.key} className={`numeric move-cell ${i === 2 ? 'field-break' : ''}`}>
            {cell}
          </td>
        );
      })}
      <td className="numeric mono field-break bound-cell">{bpPercent(facts(s).terminalUpperBp)}</td>
      <td className="numeric mono field-break worlds-cell">{row.scenario.memberCount}</td>
      <td className="numeric mono">{money(row.payoutCents)}</td>
      <td className={`numeric mono ${loss ? 'negative' : 'positive'}`}>{money(row.pnlCents, true)}</td>
      <td className="bar-cell">
        <span className="pnl-bar" aria-hidden="true">
          <i
            className={loss ? 'loss' : 'gain'}
            style={{ width: `${(Math.abs(row.pnlCents) / maxAbs) * 50}%` }}
          />
        </span>
      </td>
    </tr>
  );
}

/** The state behind the selected row, and the positions that produced it. */
function SelectedOutcome({
  row,
  positions,
  onContract,
}: {
  row: ReturnType<typeof scenarioRows>[number];
  positions: Position[];
  onContract: (contractId: string) => void;
}) {
  const f = facts(row.scenario.representative);
  const result = portfolioAt(positions, row.index);
  const contributions = [...result.rows].sort((a, b) => a.pnlCents - b.pnlCents);
  const paying = contributions.filter((r) => r.paysHere).length;

  return (
    <>
      <div className="outcome-readout">
        <div className="section-label">{describeState(row.scenario.representative).toUpperCase()}</div>
        <strong className={row.pnlCents < 0 ? 'negative' : 'positive'}>
          {money(row.pnlCents, true)}
        </strong>
        <span>Portfolio P&amp;L at settlement</span>
      </div>

      <div className="outcome-facts">
        <KeyValue label="Terminal payout">{money(result.payoutCents)}</KeyValue>
        <KeyValue label="Capital deployed">{money(result.costCents)}</KeyValue>
        <KeyValue label="Upper bound after December">{bpPercent(f.terminalUpperBp)}</KeyValue>
        <KeyValue label="Highest / lowest touched">
          {bpPercent(f.maxUpperBp)} / {bpPercent(f.minLowerBp)}
        </KeyValue>
        <KeyValue label="2026 hike / cut units">
          {f.hikes2026} / {f.cuts2026}
        </KeyValue>
        <KeyValue label="Worlds in this row">{row.scenario.memberCount}</KeyValue>
      </div>

      <div className="subpanel-title">
        <span>POSITION CONTRIBUTIONS</span>
        <span>{paying} of {contributions.length} pay</span>
      </div>
      <div className="contribution-list scenario-contributions">
        {contributions.map((r) => {
          const v = contractView(r.position.contract_id);
          return (
            <button
              key={r.position.position_id}
              type="button"
              onClick={() => onContract(r.position.contract_id)}
            >
              <span>
                <b>{v.authored.shortName}</b>
                <small>
                  {r.position.side} {r.position.quantity.toLocaleString('en-US')} ·{' '}
                  {r.paysHere ? 'pays' : 'expires'}
                </small>
              </span>
              <span className={`mono ${r.pnlCents < 0 ? 'negative' : 'positive'}`}>
                {money(r.pnlCents, true)}
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

/** Per-position contribution in one state. Used by the trade simulator. */
export function ContributionTable({
  positions,
  stateIndex,
  onContract,
  highlightId,
}: {
  positions: Position[];
  stateIndex: number;
  onContract: (contractId: string) => void;
  highlightId?: string;
}) {
  const result = portfolioAt(positions, stateIndex);
  const rows = [...result.rows].sort((a, b) => a.pnlCents - b.pnlCents);

  return (
    <div className="table-scroll">
      <table className="master-table">
        <thead>
          <tr>
            <th scope="col">Contract</th>
            <th scope="col">Side</th>
            <th scope="col" className="numeric">
              Quantity
            </th>
            <th scope="col">Settles</th>
            <th scope="col" className="numeric">
              Payout
            </th>
            <th scope="col" className="numeric">
              Cost
            </th>
            <th scope="col" className="numeric">
              P&amp;L
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.position.position_id}
              className={r.position.position_id === highlightId ? 'selected-row' : ''}
            >
              <th scope="row">
                <button
                  type="button"
                  className="instrument-link"
                  onClick={() => onContract(r.position.contract_id)}
                >
                  {contractName(r.position.contract_id)}
                </button>
                {r.position.position_id === highlightId && <Badge tone="amber">proposed</Badge>}
              </th>
              <td>{r.position.side}</td>
              <td className="numeric mono">{r.position.quantity.toLocaleString('en-US')}</td>
              <td>
                <Badge tone={r.paysHere ? 'teal' : ''}>{r.paysHere ? 'pays' : 'expires'}</Badge>
              </td>
              <td className="numeric mono">{money(r.payoutCents)}</td>
              <td className="numeric mono">{money(r.costCents)}</td>
              <td className={`numeric mono ${r.pnlCents < 0 ? 'negative' : 'positive'}`}>
                {money(r.pnlCents, true)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Portfolio</th>
            <td colSpan={3} />
            <td className="numeric mono">{money(result.payoutCents)}</td>
            <td className="numeric mono">{money(result.costCents)}</td>
            <td className={`numeric mono ${result.pnlCents < 0 ? 'negative' : 'positive'}`}>
              {money(result.pnlCents, true)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
