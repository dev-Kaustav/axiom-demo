import { Fragment, useMemo, useState, type CSSProperties } from 'react';
import { ChevronRight, ChevronDown, Layers3, Search } from 'lucide-react';
import { Panel, Badge, KeyValue, ResizeHandle, useColumnWidth } from './primitives';
import { ALL_STATES, contractView, costCents, describeState, exposureSummary, money, portfolioAt, price, type Position } from '../domain/engine';
import { groupPositions, type Grouping } from './portfolioModel';

export function PortfolioView({positions, portfolioName, onContract}: {positions: Position[]; portfolioName: string; onContract: (id: string) => void}) {
  const side = useColumnWidth(320);
  const [grouping, setGrouping] = useState<Grouping>('Event');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [lots, setLots] = useState<Set<string>>(new Set());
  const [focused, setFocused] = useState<string | null>(null);
  const [scenario, setScenario] = useState<'worst' | 'best' | 'hold'>('worst');
  const summary = useMemo(() => exposureSummary(positions), [positions]);
  const filtered = useMemo(() => positions.filter(p => `${contractView(p.contract_id).displayName} ${p.position_id} ${p.side}`.toLowerCase().includes(query.toLowerCase())), [positions,query]);
  const groups = useMemo(() => groupPositions(filtered,grouping), [filtered,grouping]);
  const focus = groups.find(g => g.name === focused) ?? groups[0];
  const stateIndex = scenario === 'hold' ? ALL_STATES.findIndex(s => Object.values(s).every(v => v === 0)) : summary[scenario].index;
  const focusSummary = useMemo(() => focus ? exposureSummary(focus.positions) : null, [focus]);
  const focusResult = focus ? portfolioAt(focus.positions,stateIndex) : null;
  const bookResult = portfolioAt(filtered,stateIndex);
  const toggle = (set: Set<string>, id: string) => {const next = new Set(set);if (next.has(id)) next.delete(id);else next.add(id);return next;};

  return <div className="portfolio-view">
    <div className="summary-strip"><KeyValue label="Capital deployed">{money(summary.costCents)}<small>{portfolioName}</small></KeyValue><KeyValue label="Positions">{positions.length}<small>Individual lots retained</small></KeyValue><KeyValue label="Unique contracts">{summary.contractCount}<small>Across {groupPositions(positions,'Event').length} events</small></KeyValue><KeyValue label="Current grouping">{groups.length}<small>{grouping} groups</small></KeyValue><KeyValue label="P&L in selected world"><span className={bookResult.pnlCents < 0 ? 'negative' : 'positive'}>{money(bookResult.pnlCents,true)}</span><small>{query ? 'Filtered positions' : 'Entire portfolio'}</small></KeyValue></div>
    <div className="portfolio-workspace" style={{ '--side-width': `${side.width}px` } as CSSProperties}>
      <Panel title="Position navigator" eyebrow={`${filtered.length} LOTS`} className="position-panel">
        <div className="navigator-toolbar"><label className="search-box"><Search size={14}/><input aria-label="Search positions" placeholder="Search contract, event or lot…" value={query} onChange={e=>setQuery(e.target.value)}/></label><label>Group by <select aria-label="Group positions by" value={grouping} onChange={e=>{setGrouping(e.target.value as Grouping);setExpanded(new Set());setFocused(null);}}>{(['Event','Payoff structure','Side'] as const).map(g=><option key={g}>{g}</option>)}</select></label><button className="text-button" onClick={()=>setExpanded(new Set(groups.map(g=>g.name)))}>Expand all</button><button className="text-button" onClick={()=>{setExpanded(new Set());setLots(new Set());}}>Collapse all</button></div>
        <div className="group-path"><Layers3 size={13}/><span>Portfolio</span><ChevronRight size={12}/><b>{grouping}</b><ChevronRight size={12}/><span>Contract / side</span><ChevronRight size={12}/><span>Lot</span></div>
        <div className="table-scroll navigator-scroll"><table className="positions-table grouped-table"><thead><tr><th scope="col">Group / contract / position</th><th scope="col">Side</th><th scope="col" className="numeric">Quantity</th><th scope="col" className="numeric">Avg entry</th><th scope="col" className="numeric">Cost</th><th scope="col" className="numeric">Payout</th><th scope="col" className="numeric">Scenario P&amp;L</th></tr></thead><tbody>
          {groups.map(g=>{
            const open = expanded.has(g.name);const result=portfolioAt(g.positions,stateIndex);
            const holdings = new Map<string,Position[]>();g.positions.forEach(p=>{const key=`${p.contract_id}:${p.side}`;holdings.set(key,[...(holdings.get(key)??[]),p]);});
            return <Fragment key={g.name}><tr className={`group-row ${focus?.name===g.name ? 'focused-group' : ''}`}><th scope="row"><button className="group-toggle" aria-expanded={open} onClick={()=>{setExpanded(toggle(expanded,g.name));setFocused(g.name);}}>{open?<ChevronDown size={14}/>:<ChevronRight size={14}/>}<span>{g.name}</span><small>{g.positions.length}</small></button></th><td>—</td><td className="numeric mono">{g.positions.reduce((s,p)=>s+p.quantity,0).toLocaleString()}</td><td className="numeric">—</td><MoneyCell value={result.costCents}/><MoneyCell value={result.payoutCents}/><MoneyCell value={result.pnlCents} signed/></tr>
            {open && [...holdings].map(([key,ps])=>{
              const view=contractView(ps[0].contract_id);const q=ps.reduce((s,p)=>s+p.quantity,0);const r=portfolioAt(ps,stateIndex);const lotOpen=lots.has(`${g.name}:${key}`);
              return <Fragment key={key}><tr className="holding-row"><th scope="row"><div className="holding-name"><button className="icon-button" aria-label={`Show lots for ${view.displayName} ${ps[0].side}`} aria-expanded={lotOpen} onClick={()=>setLots(toggle(lots,`${g.name}:${key}`))}>{lotOpen?<ChevronDown size={12}/>:<ChevronRight size={12}/>}</button><button className="instrument-link" onClick={()=>onContract(ps[0].contract_id)}>{view.authored.shortName}</button><small>{ps.length} {ps.length===1?'lot':'lots'}</small></div></th><td><Badge>{ps[0].side}</Badge></td><td className="numeric mono">{q.toLocaleString()}</td><td className="numeric mono">{price(r.costCents*100/q)}</td><MoneyCell value={r.costCents}/><MoneyCell value={r.payoutCents}/><MoneyCell value={r.pnlCents} signed/></tr>
              {lotOpen && ps.map(p=>{const r=portfolioAt([p],stateIndex);return <tr className="lot-row" key={p.position_id}><th scope="row"><span className="mono">↳ {p.position_id}</span></th><td>{p.side}</td><td className="numeric mono">{p.quantity.toLocaleString()}</td><td className="numeric mono">{price(p.entry_price_x4)}</td><MoneyCell value={costCents(p)}/><MoneyCell value={r.payoutCents}/><MoneyCell value={r.pnlCents} signed/></tr>;})}</Fragment>;
            })}</Fragment>;
          })}
          {groups.length===0 && <tr><td colSpan={7} className="empty-state">No positions match your search.</td></tr>}
        </tbody><tfoot><tr><th scope="row">{query?'Filtered portfolio':'Portfolio total'}</th><td colSpan={3}/><MoneyCell value={bookResult.costCents}/><MoneyCell value={bookResult.payoutCents}/><MoneyCell value={bookResult.pnlCents} signed/></tr></tfoot></table></div>
        <p className="panel-footnote">Group totals include every lot. Scenario columns use the same world across the entire table, so child values reconcile to parent totals.</p>
      </Panel>
      <ResizeHandle value={side.width} min={260} max={680} invert onChange={side.setWidth} label="Group drill-down panel width" />
      <Panel title="Group drill-down" eyebrow="LINKED" className="group-inspector">
        <div className="inspector-section"><label className="field-label">Scenario for all rows<select aria-label="Portfolio scenario" value={scenario} onChange={e=>setScenario(e.target.value as typeof scenario)}><option value="worst">Whole-book worst outcome</option><option value="hold">No further rate moves</option><option value="best">Whole-book best outcome</option></select></label><p className="quiet-copy">{describeState(ALL_STATES[stateIndex])}</p></div>
        {focus && focusSummary && focusResult && <><div className="inspector-section"><span className="section-label">{grouping.toUpperCase()} GROUP</span><h3>{focus.name}</h3><Badge>{focus.positions.length} positions</Badge><div className="group-readout"><small>P&amp;L IN SELECTED WORLD</small><strong className={focusResult.pnlCents<0?'negative':'positive'}>{money(focusResult.pnlCents,true)}</strong></div><KeyValue label="Capital deployed">{money(focusResult.costCents)}</KeyValue><KeyValue label="Terminal payout">{money(focusResult.payoutCents)}</KeyValue></div><div className="inspector-section"><h4>Standalone group risk</h4><KeyValue label="Worst P&L"><span className={focusSummary.worst.pnlCents<0?'negative':'positive'}>{money(focusSummary.worst.pnlCents,true)}</span></KeyValue><KeyValue label="Best P&L"><span className={focusSummary.best.pnlCents<0?'negative':'positive'}>{money(focusSummary.best.pnlCents,true)}</span></KeyValue><p className="quiet-copy">Each group's extremes can occur in different worlds. Do not add them to obtain portfolio risk.</p>{focusSummary.worst.pnlCents===focusSummary.best.pnlCents && <Badge tone="teal">CONSTANT PAYOUT GROUP</Badge>}</div><div className="inspector-section"><h4>Contracts in this group</h4>{[...new Set(focus.positions.map(p=>p.contract_id))].map(id=><button className="group-contract" key={id} onClick={()=>onContract(id)}>{contractView(id).authored.shortName}<ChevronRight size={13}/></button>)}</div></>}
      </Panel>
    </div>
  </div>;
}
function MoneyCell({value,signed=false}: {value:number;signed?:boolean}) {return <td className={`numeric mono ${signed ? value<0?'negative':'positive' : ''}`}>{money(value,signed)}</td>;}
