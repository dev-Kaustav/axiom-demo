import { ArrowUpRight } from 'lucide-react';
import { Panel } from './primitives';
import { byId, price } from '../domain/engine';

const nodes = [
  { id: 'ins_path_hph', x: 26, y: 22, w: 164, title: 'Sep–Dec paths', subtitle: 'HHH · HPH · HHP', group: 'SCHEDULED PATH' },
  { id: 'ins_oct_hike_25', x: 314, y: 22, w: 158, title: 'October +25 bp', subtitle: 'Scheduled decision', group: 'OCTOBER' },
  { id: 'ins_another_hike', x: 151, y: 132, w: 205, title: 'Another Fed hike', subtitle: 'Through December meeting', group: 'CANONICAL CLAIM' },
  { id: 'ins_eoy_425', x: 24, y: 245, w: 156, title: 'Year-end ≥4.25%', subtitle: 'Terminal rate buckets', group: 'RATE LEVEL' },
  { id: 'ins_hike_count_1', x: 317, y: 245, w: 157, title: 'Annual hike count', subtitle: 'Through December 31', group: 'COUNT' },
  { id: 'ins_hit_425', x: 30, y: 353, w: 150, title: 'Hit ≥4.25%', subtitle: 'Path-dependent threshold', group: 'RATE HIT' },
  { id: 'ins_hit_450', x: 317, y: 353, w: 157, title: 'Hit ≥4.50%', subtitle: 'Path-dependent threshold', group: 'RATE HIT' },
];
const edges = [
  { id: 'con_another_hike_from_paths', path: 'M108 85 C108 124 202 100 202 132', label: 'LOWER BOUND', x: 112, y: 113 },
  { id: 'con_oct_hike25_implies_another', path: 'M393 85 C393 117 307 102 307 132', label: 'IMPLIES', x: 365, y: 113 },
  { id: 'con_eoy_high_implies_another_hike', path: 'M104 245 C104 204 202 228 202 196', label: 'LOWER BOUND', x: 110, y: 222 },
  { id: 'con_another_hike_implies_not_count1', path: 'M307 196 C307 223 395 211 395 245', label: 'IMPLIES ¬1', x: 380, y: 222 },
  { id: 'con_eoy425_implies_hit425', path: 'M103 308 L103 353', label: '4.25 → HIT', x: 145, y: 335 },
  { id: 'con_hit450_implies_hit425', path: 'M317 386 L180 386', label: 'IMPLIES', x: 248, y: 377 },
];
export function RelationshipGraph({ selected, onSelect, onInspect, onExpand, large = false }: { selected: string; onSelect: (id: string) => void; onInspect: (id: string) => void; onExpand?: () => void; large?: boolean }) {
  return <Panel title="Structural relationships" eyebrow="FED / 2026" className={`graph-panel ${large ? 'large' : ''}`} actions={onExpand && <button className="icon-button" onClick={onExpand} aria-label="Expand relationships"><ArrowUpRight size={16}/></button>}>
    <div className="graph-intro"><span className="dot teal"/> <span>Same underlying world. Different claims.</span></div>
    <svg className="relationship-graph" viewBox="0 0 500 444" role="group" aria-label="Interactive Fed contract relationships">
      <defs><pattern id="dots" width="16" height="16" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r=".6" fill="var(--line-strong)"/></pattern><marker id="arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7" fill="none" stroke="var(--text-faint)"/></marker></defs>
      <rect width="500" height="444" fill="url(#dots)"/>
      {edges.map(e => <g key={e.id} role="button" tabIndex={0} aria-label={`Inspect ${e.label}: ${e.id}`} onClick={() => onInspect(e.id)} onKeyDown={k => { if (k.key === 'Enter' || k.key === ' ') { k.preventDefault(); onInspect(e.id); } }} className="graph-edge"><path className="edge-hit" d={e.path}/><path className="edge-line" d={e.path} markerEnd="url(#arrow)"/><rect x={e.x - 45} y={e.y - 9} width="90" height="17" rx="3"/><text x={e.x} y={e.y + 3} textAnchor="middle">{e.label}</text></g>)}
      {nodes.map(n => <g key={n.id} className={`graph-node ${selected === n.id ? 'selected' : ''} ${n.id === 'ins_another_hike' ? 'central' : ''}`} role="button" tabIndex={0} aria-label={`Select ${n.title}`} onClick={() => onSelect(n.id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(n.id); } }}><rect x={n.x} y={n.y} width={n.w} height="64" rx="5"/><text x={n.x + 12} y={n.y + 16} className="node-group">{n.group}</text><text x={n.x + 12} y={n.y + 34} className="node-title">{n.title}</text><text x={n.x + 12} y={n.y + 51} className="node-subtitle">{n.subtitle}</text>{n.id === 'ins_another_hike' && <text x={n.x + n.w - 12} y={n.y + 34} textAnchor="end" className="node-price">{price(byId[n.id].snapshot_mark)}</text>}</g>)}
    </svg>
    <div className="graph-footer"><span><i className="legend-line"/> Directed payoff implication</span><span>Click an edge to inspect proof</span></div>
  </Panel>;
}
