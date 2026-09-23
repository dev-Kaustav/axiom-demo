import { useEffect, useState } from 'react';
import { Activity, Layers3, GitBranch, FlaskConical, ArrowLeftRight, BookOpen, Database } from 'lucide-react';
import './styles.css';
import { Modal } from './components/primitives';
import { PortfolioView } from './components/PortfolioView';
import { ExposureView } from './components/ExposureView';
import { ScenarioExplorer } from './components/ScenarioExplorer';
import { RelationshipsView } from './components/RelationshipsView';
import { TradeSimulator } from './components/TradeSimulator';
import { ContractsView, DataView } from './components/ContractsView';
import { ContractInspector } from './components/ContractInspector';
import { Ticker, Clock } from './components/Ticker';
import { PORTFOLIO, POSITIONS, contractView } from './domain/engine';

const PAGES = ['Exposure', 'Portfolio', 'Scenarios', 'Relationships', 'Trade', 'Contracts', 'Data'] as const;
type Page = (typeof PAGES)[number];
const ICONS = [Activity, Layers3, FlaskConical, GitBranch, ArrowLeftRight, BookOpen, Database];
const currentPage = () => PAGES.find(p => `#/${p.toLowerCase()}` === window.location.hash) ?? 'Exposure';

const HEADINGS: Record<Page, string> = {
  Exposure: 'What am I exposed to?',
  Portfolio: 'What has been loaded',
  Scenarios: 'What happens under this outcome?',
  Relationships: 'What offsets what, and where does the hedge fail?',
  Trade: 'What happens if I make this trade?',
  Contracts: 'Every contract, and what Axiom made of it',
  Data: 'Where the numbers come from',
};

export default function App() {
  const [page, setPage] = useState<Page>(currentPage);
  const [inspecting, setInspecting] = useState<string | null>(null);
  const [scenarioKey, setScenarioKey] = useState<string | null>(null);
  const navigate = (next: Page) => { window.location.hash = `/${next.toLowerCase()}`; setPage(next); };
  useEffect(() => {
    const sync = () => setPage(currentPage());
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);
  useEffect(() => { document.title = `${page} · Axiom Workstation`; }, [page]);
  // A trackpad pinch is a ctrl-wheel event, and the browser answers it by
  // zooming the whole page. This is a fixed desktop layout of panes that carry
  // their own scroll and their own zoom, so page zoom only breaks it. Capture
  // phase and non-passive, which is the only way the default can be refused;
  // the keyboard zoom the browser offers for accessibility is untouched.
  useEffect(() => {
    const block = (e: WheelEvent) => { if (e.ctrlKey || e.metaKey) e.preventDefault(); };
    document.addEventListener('wheel', block, { passive: false, capture: true });
    return () => document.removeEventListener('wheel', block, { capture: true });
  }, []);

  const openScenario = (key: string) => {
    setScenarioKey(key);
    navigate('Scenarios');
  };

  return (
    <div className="app">
      <header className="app-bar">
        <div className="brand">
          <span className="logo-mark" aria-hidden="true" />
          <span>axiom<span className="brand-period">.</span></span><small>WORKSTATION</small>
        </div>
        <nav aria-label="Views" className="page-nav">
          {PAGES.map((p, index) => {
            const Icon = ICONS[index];
            return (
            <button
              key={p}
              type="button"
              className={p === page ? 'tab active' : 'tab'}
              aria-current={p === page ? 'page' : undefined}
              onClick={() => navigate(p)}
            >
              <Icon size={14} aria-hidden="true" />{p}
            </button>
          ); })}
        </nav>
        <Clock />
      </header>

      <Ticker />

      <main className="workspace">
        <div className="workspace-header">
          <div><div className="workspace-kicker">MACRO / US RATES / 2026</div><h1>{page === 'Trade' ? 'Trade simulation' : page === 'Data' ? 'Data & provenance' : page}<span>{HEADINGS[page]}</span></h1></div>
          <div className="book-label"><span>{PORTFOLIO.name}</span><small><span className="status-dot" /> DEMO BOOK · {POSITIONS.length} POSITIONS</small></div>
        </div>

        {page === 'Exposure' && <ExposureView positions={POSITIONS} onScenario={openScenario} onContract={setInspecting} />}
        {page === 'Portfolio' && (
          <PortfolioView
            positions={POSITIONS}
            portfolioName={PORTFOLIO.name}
            onContract={setInspecting}
          />
        )}
        {page === 'Scenarios' && (
          <ScenarioExplorer
            positions={POSITIONS}
            selectedKey={scenarioKey}
            onSelect={setScenarioKey}
            onContract={setInspecting}
          />
        )}
        {page === 'Relationships' && (
          <RelationshipsView positions={POSITIONS} onContract={setInspecting} onScenario={openScenario} />
        )}
        {page === 'Trade' && <TradeSimulator positions={POSITIONS} onContract={setInspecting} />}
        {page === 'Contracts' && <ContractsView onContract={setInspecting} />}
        {page === 'Data' && <DataView />}
      </main>

      <footer className="app-footer">
        <span><span className="status-dot" /> SNAPSHOT DATA · Fictional portfolio over real Polymarket contracts.</span>
        <span className="footer-separator">·</span>
        <span>No probabilities, no fair values, no execution.</span>
      </footer>

      {inspecting && (
        <Modal
          title={contractView(inspecting).contract.question}
          onClose={() => setInspecting(null)}
          wide
        >
          <ContractInspector contractId={inspecting} />
        </Modal>
      )}
    </div>
  );
}
