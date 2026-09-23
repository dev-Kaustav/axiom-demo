import { useMemo, useState, type CSSProperties } from 'react';
import { ArrowUpRight, Crosshair, RotateCcw } from 'lucide-react';
import { Panel, KeyValue, Badge, ResizeHandle, useColumnWidth } from './primitives';
import {
  ALL_STATES, BASIS_SUMMARY, INTER_MOVES_BP, SCHEDULED_MOVES_BP, SCOPE_COUNTS,
  bpPercent, compact, contractView, describeState, drivers, exposureSummary, facts,
  money, pnlVector, portfolioAt, scenarioRows, type Position,
} from '../domain/engine';

const move = (bp: number) => bp === 0 ? 'Hold' : `${bp > 0 ? '+' : '−'}${Math.abs(bp)}`;
const WINDOWS = [ ['interSepOct', 'Before October'], ['interOctDec', 'Between meetings'], ['postDec', 'After December'] ] as const;

export function ExposureView({ positions, onScenario, onContract }: {
  positions: Position[]; onScenario: (key: string) => void; onContract: (id: string) => void;
}) {
  const side = useColumnWidth(330);
  const [windows, setWindows] = useState({ interSepOct: 0, interOctDec: 0, postDec: 0 });
  const [selectedMoves, setSelectedMoves] = useState({ october: 0, december: 0 });
  const summary = useMemo(() => exposureSummary(positions), [positions]);
  const rows = useMemo(() => scenarioRows(positions), [positions]);
  const vector = useMemo(() => pnlVector(positions, ALL_STATES.length), [positions]);
  const driving = useMemo(() => drivers(positions), [positions]);
  const slice = useMemo(() => ALL_STATES.flatMap((s, index) =>
    WINDOWS.every(([key]) => s[key] === windows[key]) ? [{ state: s, index, pnl: vector[index] }] : []), [windows, vector]);
  const selected = slice.find(r => r.state.october === selectedMoves.october && r.state.december === selectedMoves.december)!;
  const result = portfolioAt(positions, selected.index);
  const stateFacts = facts(selected.state);
  const contributions = [...result.rows].sort((a, b) => a.pnlCents - b.pnlCents);
  const maxAbs = Math.max(Math.abs(summary.worst.pnlCents), Math.abs(summary.best.pnlCents));
  const selectedScenario = rows.find(r => r.scenario.memberIndices.includes(selected.index))!;
  const selectExtreme = (which: 'worst' | 'best') => {
    const s = ALL_STATES[summary[which].index];
    setWindows({ interSepOct: s.interSepOct, interOctDec: s.interOctDec, postDec: s.postDec });
    setSelectedMoves({ october: s.october, december: s.december });
  };

  return <div className="exposure-layout">
    <div className="summary-strip exposure-metrics">
      <KeyValue label="Capital deployed">{money(summary.costCents)}<small>18 positions · 17 contracts</small></KeyValue>
      <KeyValue label="Worst outcome"><button className="metric-button negative" onClick={() => selectExtreme('worst')}>{money(summary.worst.pnlCents, true)}<ArrowUpRight size={16}/></button><small>Across all modelled worlds</small></KeyValue>
      <KeyValue label="Best outcome"><button className="metric-button positive" onClick={() => selectExtreme('best')}>{money(summary.best.pnlCents, true)}<ArrowUpRight size={16}/></button><small>Across all modelled worlds</small></KeyValue>
      <KeyValue label="Loss-making outcomes">{rows.filter(r => r.pnlCents < 0).length}<span className="metric-denominator"> / {rows.length}</span><small>Distinct outcomes, not odds</small></KeyValue>
      <KeyValue label="Model coverage">{BASIS_SUMMARY.supportedContracts}<span className="metric-denominator"> / {SCOPE_COUNTS.total_contracts}</span><small>Every held contract interpreted</small></KeyValue>
    </div>
    <div className="exposure-workspace" style={{ '--side-width': `${side.width}px` } as CSSProperties}>
      <Panel title="Portfolio payoff landscape" eyebrow="OCTOBER × DECEMBER" className="landscape-panel" actions={<Badge>USD P&amp;L</Badge>}>
        <div className="landscape-controls"><div><span className="section-label">INTER-MEETING MOVES</span><span className="quiet-copy">81 worlds in this slice</span></div>
          {WINDOWS.map(([key, label]) => <label key={key}>{label}<select aria-label={label} value={windows[key]} onChange={e => setWindows({...windows, [key]: Number(e.target.value)})}>{INTER_MOVES_BP.map(n => <option key={n} value={n}>{n === 0 ? 'No move' : `${move(n)} bp`}</option>)}</select></label>)}
          <button className="icon-button" aria-label="Reset landscape" onClick={() => {setWindows({interSepOct:0,interOctDec:0,postDec:0});setSelectedMoves({october:0,december:0});}}><RotateCcw size={14}/></button>
        </div>
        <div className="heatmap-wrap"><div className="axis-title">DECEMBER DECISION <span>→ basis points</span></div>
          <div className="heatmap-frame"><div className="vertical-axis">OCTOBER DECISION</div><table className="heatmap" aria-label="October and December portfolio profit and loss">
            <thead><tr><th scope="col"><span className="sr-only">October / December</span></th>{SCHEDULED_MOVES_BP.map(d => <th scope="col" key={d}>{move(d)}</th>)}</tr></thead>
            <tbody>{SCHEDULED_MOVES_BP.map(o => <tr key={o}><th scope="row">{move(o)}</th>{SCHEDULED_MOVES_BP.map(d => {
              const cell = slice.find(r => r.state.october === o && r.state.december === d)!;
              const active = selectedMoves.october === o && selectedMoves.december === d;
              return <td key={d}><button className={`heat-cell ${cell.pnl < 0 ? 'loss' : 'gain'} ${active ? 'selected' : ''}`} style={{backgroundColor: `color-mix(in srgb, var(${cell.pnl < 0 ? '--down' : '--up'}) ${7 + Math.abs(cell.pnl) / maxAbs * 63}%, var(--bg-app))`}} aria-label={`October ${o} bp, December ${d} bp, ${money(cell.pnl, true)} P&L`} aria-pressed={active} onClick={() => setSelectedMoves({october:o,december:d})}>{compact(cell.pnl)}{active && <Crosshair size={11} aria-hidden="true"/>}</button></td>;
            })}</tr>)}</tbody>
          </table></div>
          <div className="heatmap-legend"><span><i className="legend-loss"/>Loss</span><div className="heat-scale"/><span>Profit<i className="legend-gain"/></span><span className="legend-note">Select a cell to inspect its positions</span></div>
        </div>
        <div className="panel-footnote">Cell values in $ thousands. Scheduled moves −100 to +100 bp; each inter-meeting window −25, 0 or +25 bp. Counts are not probabilities.</div>
      </Panel>
      <ResizeHandle value={side.width} min={260} max={680} invert onChange={side.setWidth} label="Selected outcome panel width" />
      <Panel title="Selected outcome" eyebrow="LINKED" className="outcome-panel">
        <div className="outcome-readout"><div className="section-label">OCT {move(selected.state.october)} / DEC {move(selected.state.december)}</div><strong className={selected.pnl < 0 ? 'negative' : 'positive'}>{money(selected.pnl, true)}</strong><span>Portfolio P&amp;L at settlement</span></div>
        <div className="outcome-facts"><KeyValue label="Terminal payout">{money(result.payoutCents)}</KeyValue><KeyValue label="December upper bound">{bpPercent(stateFacts.terminalUpperBp)}</KeyValue><KeyValue label="2026 hike / cut units">{stateFacts.hikes2026} / {stateFacts.cuts2026}</KeyValue></div>
        <div className="subpanel-title"><span>POSITION CONTRIBUTIONS</span><span>P&amp;L</span></div>
        <div className="contribution-list">{contributions.map(r => {
          const v = contractView(r.position.contract_id);
          return <button key={r.position.position_id} onClick={() => onContract(r.position.contract_id)}><span><b>{v.authored.shortName}</b><small>{r.position.side} · {v.event.title}</small></span><span className={`mono ${r.pnlCents < 0 ? 'negative' : 'positive'}`}>{compact(r.pnlCents)}</span></button>;
        })}</div>
        <button className="panel-action" onClick={() => onScenario(selectedScenario.scenario.key)}>Open full scenario breakdown <ArrowUpRight size={14}/></button>
      </Panel>
    </div>
    <div className="exposure-bottom">
      <Panel title="Economic drivers" eyebrow="MAXIMUM P&L SWING">
        <ul className="driver-list">{driving.map(d => <li key={d.id}><span>{d.label}</span><span className="driver-bar"><i style={{width:`${d.swingCents / driving[0].swingCents * 100}%`}}/></span><span className="mono">{money(d.swingCents)}</span></li>)}</ul>
        <p className="panel-footnote">Sweep one variable while holding the others fixed. These swings are not additive.</p>
      </Panel>
      <Panel title="Stress monitor" eyebrow="WHOLE BOOK">
        {(['worst','best'] as const).map(which => <button className="stress-row" key={which} onClick={() => selectExtreme(which)}><span><small>{which === 'worst' ? 'MAXIMUM MODELLED LOSS' : 'MAXIMUM MODELLED PROFIT'}</small><b>{describeState(ALL_STATES[summary[which].index])}</b></span><span className={`mono ${which === 'worst' ? 'negative' : 'positive'}`}>{money(summary[which].pnlCents,true)}<ArrowUpRight size={14}/></span></button>)}
        <div className="coverage-status"><Badge tone="teal">{summary.unsupportedHoldings.length === 0 ? 'HELD BOOK COVERED' : 'REVIEW COVERAGE'}</Badge><span>{summary.rawWorldCount.toLocaleString()} worlds → {summary.scenarioCount} book outcomes</span></div>
      </Panel>
    </div>
  </div>;
}
