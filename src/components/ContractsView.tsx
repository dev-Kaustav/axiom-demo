import { Fragment, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Layers3 } from 'lucide-react';
import { Panel, Badge, SourceLink, KeyValue } from './primitives';
import { contractGroup, type ContractGrouping } from './portfolioModel';
import {
  ANCHOR_FACTS,
  ASSUMPTIONS,
  BASIS_SUMMARY,
  CONTRACT_VIEWS,
  DEGENERATE,
  EVENTS,
  SNAPSHOT,
  contractView,
  shortEventName,
} from '../domain/engine';

const STATUS_TONE: Record<string, string> = {
  VERIFIED: 'teal',
  HIGH_CONFIDENCE: 'teal',
  REVIEW_REQUIRED: 'amber',
  UNSUPPORTED: 'amber',
};

const GROUPINGS: ContractGrouping[] = ['Event', 'Payoff structure', 'Status', 'Venue'];

/** Every contract Axiom pulled, what it made of each one, and where it came from. */
export function ContractsView({ onContract }: { onContract: (contractId: string) => void }) {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<'ALL' | 'CORE' | 'DECOY' | 'OUT_OF_SCOPE'>('ALL');
  const [grouping, setGrouping] = useState<ContractGrouping>('Event');
  /**
   * Folded by default: 122 rows is a scroll, the group headers carry each
   * group's own coverage, and opening one is a click. Nothing is dropped --
   * every group is listed with its count whether or not it is open.
   */
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return CONTRACT_VIEWS.filter((v) => {
      if (scope !== 'ALL' && v.event.scope !== scope) return false;
      if (!needle) return true;
      return (
        v.contract.question.toLowerCase().includes(needle) ||
        v.event.title.toLowerCase().includes(needle) ||
        v.displayName.toLowerCase().includes(needle)
      );
    });
  }, [query, scope]);

  const groups = useMemo(() => {
    const byName = new Map<string, typeof rows>();
    for (const v of rows) {
      const name = contractGroup(v.contract.contract_id, grouping);
      byName.set(name, [...(byName.get(name) ?? []), v]);
    }
    return [...byName].map(([name, members]) => ({ name, members }));
  }, [rows, grouping]);

  return (
    <div className="contracts-view">
      <div className="filter-bar">
        <label className="field-label" htmlFor="contract-search">
          Search contracts
        </label>
        <input
          id="contract-search"
          className="search-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="rate, cut, October"
        />
        <label className="field-label" htmlFor="contract-scope">
          Scope
        </label>
        <select id="contract-scope" value={scope} onChange={(e) => setScope(e.target.value as never)}>
          <option value="ALL">All</option>
          <option value="CORE">Modelled</option>
          <option value="DECOY">Not a rate contract</option>
          <option value="OUT_OF_SCOPE">Outside the basis</option>
        </select>
        <label className="field-label" htmlFor="contract-grouping">
          Group by
        </label>
        <select
          id="contract-grouping"
          value={grouping}
          onChange={(e) => {
            setGrouping(e.target.value as ContractGrouping);
            setExpanded(new Set());
          }}
        >
          {GROUPINGS.map((g) => (
            <option key={g}>{g}</option>
          ))}
        </select>
        <button
          type="button"
          className="text-button"
          onClick={() => setExpanded(new Set(groups.map((g) => g.name)))}
        >
          Expand all
        </button>
        <button type="button" className="text-button" onClick={() => setExpanded(new Set())}>
          Collapse all
        </button>
      </div>

      <Panel title="Contract universe" eyebrow={`${rows.length} of ${CONTRACT_VIEWS.length}`}>
        {rows.length === 0 ? (
          <p className="empty-state">No contract matches that search.</p>
        ) : (
          <>
            <div className="group-path">
              <Layers3 size={13} />
              <span>Universe</span>
              <ChevronRight size={12} />
              <b>{grouping}</b>
              <ChevronRight size={12} />
              <span>Contract</span>
            </div>
            <div className="table-scroll">
              <table className="master-table grouped-table">
                <thead>
                  <tr>
                    <th scope="col">Group / contract</th>
                    <th scope="col">Event</th>
                    <th scope="col">Predicate</th>
                    <th scope="col">Status</th>
                    <th scope="col">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => {
                    const open = expanded.has(g.name);
                    const withheld = g.members.filter((v) => !v.expression).length;
                    return (
                      <Fragment key={g.name}>
                        <tr className="group-row">
                          <th scope="row">
                            <button
                              type="button"
                              className="group-toggle"
                              aria-expanded={open}
                              onClick={() => {
                                const next = new Set(expanded);
                                if (open) next.delete(g.name);
                                else next.add(g.name);
                                setExpanded(next);
                              }}
                            >
                              {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                              <span>{g.name}</span>
                              <small>{g.members.length}</small>
                            </button>
                          </th>
                          <td className="muted">—</td>
                          <td className="muted">
                            {withheld === 0
                              ? 'every contract interpreted'
                              : `${g.members.length - withheld} interpreted, ${withheld} withheld`}
                          </td>
                          <td colSpan={2} />
                        </tr>
                        {open &&
                          g.members.map((v) => (
                            <tr key={v.contract.contract_id}>
                              <th scope="row">
                                <button
                                  type="button"
                                  className="instrument-link"
                                  onClick={() => onContract(v.contract.contract_id)}
                                >
                                  {v.authored.shortName}
                                </button>
                              </th>
                              <td className="muted">{shortEventName(v.event)}</td>
                              <td>
                                {v.expression ? (
                                  <code className="expression">{v.expression}</code>
                                ) : (
                                  <span className="muted">withheld</span>
                                )}
                              </td>
                              <td>
                                <Badge tone={STATUS_TONE[v.authored.status] ?? ''}>
                                  {v.authored.status.replace(/_/g, ' ')}
                                </Badge>
                              </td>
                              <td>
                                <SourceLink url={v.contract.source_url}>Venue</SourceLink>
                              </td>
                            </tr>
                          ))}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Panel>
    </div>
  );
}

/** Provenance: where the data came from and what the model assumes. */
export function DataView() {
  const outOfAlphabet = DEGENERATE.filter((d) => d.cause === 'OUT_OF_ALPHABET');
  const settled = DEGENERATE.filter((d) => d.cause === 'SETTLED');

  return (
    <div className="data-layout">
      <Panel title="Snapshot" eyebrow={SNAPSHOT.venue}>
        <div className="coverage-grid">
          <KeyValue label="Retrieved">{new Date(SNAPSHOT.retrieved_at).toUTCString()}</KeyValue>
          <KeyValue label="Source">{SNAPSHOT.source}</KeyValue>
          <KeyValue label="Events">{EVENTS.length}</KeyValue>
          <KeyValue label="Contracts">{BASIS_SUMMARY.supportedContracts + BASIS_SUMMARY.unsupportedContracts}</KeyValue>
          <KeyValue label="Worlds enumerated">{BASIS_SUMMARY.rawStateCount.toLocaleString('en-US')}</KeyValue>
          <KeyValue label="Distinct payoff states">{BASIS_SUMMARY.basisScenarioCount}</KeyValue>
        </div>
        <p className="panel-footnote">{SNAPSHOT.note}</p>
      </Panel>

      <Panel title="Established facts" eyebrow={`${ANCHOR_FACTS.length} anchors`}>
        <p className="quiet-copy">
          The state space is enumerated forward from what has already happened in 2026. Each fact
          carries how it was established.
        </p>
        {ANCHOR_FACTS.map((a) => (
          <div key={a.anchor_id} className="detail-section">
            <h4 className="inspector-heading">
              {a.statement}: <span className="mono">{String(a.value)}</span>{' '}
              <Badge tone={a.derivation === 'RESOLVED_MARKET' ? 'teal' : 'amber'}>
                {a.derivation.replace(/_/g, ' ')}
              </Badge>
            </h4>
            <p className="quiet-copy">{a.reasoning}</p>
            {a.evidence.length > 0 && (
              <ul className="download-list">
                {a.evidence.map((e) => (
                  <li key={e.contract_id}>
                    {e.question} — venue resolved <strong>{e.resolved_outcome}</strong>
                  </li>
                ))}
              </ul>
            )}
            {'source_url' in a && a.source_url && <SourceLink url={a.source_url as string}>Source</SourceLink>}
          </div>
        ))}
      </Panel>

      <Panel title="Model assumptions" eyebrow={`${ASSUMPTIONS.length} declared`}>
        <ul className="download-list">
          {ASSUMPTIONS.map((a) => (
            <li key={a.id}>
              <strong>{a.statement}</strong> {a.consequence}
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="Contracts with no reachable outcome" eyebrow={`${DEGENERATE.length} found`}>
        <p className="quiet-copy">
          These contracts pay the same in every modelled world. The two reasons mean opposite
          things and are never merged.
        </p>
        <h4 className="inspector-heading">Already settled ({settled.length})</h4>
        <ul className="download-list">
          {settled.map((d) => (
            <li key={d.contract_id}>
              {contractView(d.contract_id).displayName} — the venue resolved it and the model agrees.
            </li>
          ))}
        </ul>
        <h4 className="inspector-heading">Outside the declared move alphabet ({outOfAlphabet.length})</h4>
        <ul className="download-list">
          {outOfAlphabet.map((d) => (
            <li key={d.contract_id}>
              {contractView(d.contract_id).displayName} — {d.reason}
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="Events not modelled" eyebrow="carried, not dropped">
        <ul className="download-list">
          {EVENTS.filter((e) => e.scope !== 'CORE').map((e) => (
            <li key={e.event_id}>
              <strong>{e.title}</strong> — {e.scope_reason} <SourceLink url={e.source_url}>Venue</SourceLink>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
