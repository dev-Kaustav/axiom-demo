import { useEffect, useState } from 'react';
import { data, price, sideMark } from '../domain/engine';

// The tape shows the frozen 21 Sep snapshot, not a live feed. Where a contract
// is held, the delta is the real mark-versus-entry move on that position; the
// rest carry no delta because the fixture has no prior mark to compare against.
const held = new Map(data.portfolio.positions.map(p => [p.instrument_id, p]));

const tapeItems = data.instruments.map(i => {
  const position = held.get(i.instrument_id);
  const delta = position ? (sideMark(position) - position.entry_price) * 100 : null;
  return {
    id: i.instrument_id,
    name: i.short_name,
    mark: price(i.snapshot_mark),
    delta,
  };
});

function Run({ ariaHidden }: { ariaHidden?: boolean }) {
  return (
    <div className="tape-run" aria-hidden={ariaHidden}>
      {tapeItems.map(t => (
        <span className="tape-item" key={t.id}>
          <b>{t.name}</b>
          <i>{t.mark}</i>
          {t.delta !== null && (
            <s className={t.delta > 0 ? 'up' : t.delta < 0 ? 'down' : 'flat'}>
              {t.delta > 0 ? '▲' : t.delta < 0 ? '▼' : '■'} {Math.abs(t.delta).toFixed(1)}
            </s>
          )}
        </span>
      ))}
    </div>
  );
}

export function Ticker() {
  return (
    <div className="tape" aria-hidden="true">
      <span className="tape-label">
        <span className="dot teal" />
        Snapshot tape
      </span>
      <div className="tape-track">
        <Run />
        <Run ariaHidden />
      </div>
    </div>
  );
}

export function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const hh = String(now.getUTCHours()).padStart(2, '0');
  const mm = String(now.getUTCMinutes()).padStart(2, '0');
  const ss = String(now.getUTCSeconds()).padStart(2, '0');
  return <span className="clock">{hh}:{mm}:{ss}<small> UTC</small></span>;
}
