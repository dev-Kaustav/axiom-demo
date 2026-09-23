import { useEffect, useState } from 'react';
import { POSITIONS, SNAPSHOT, contractView, price } from '../domain/engine';
const items = [...new Set(POSITIONS.map(p => p.contract_id))].map(contractView).filter(v => v.contract.marks.last_trade_price !== null);
export function Ticker() {
  return <div className="tape"><span className="tape-label">POLYMARKET <small>SNAPSHOT · {SNAPSHOT.retrieved_at.slice(0,10)}</small></span><div className="tape-track" tabIndex={0} role="region" aria-label="Snapshot tape">{items.map(v => <span className="tape-item" key={v.contract.contract_id} title={v.contract.question}><span>{v.authored.shortName}</span><b>{price(Math.round(v.contract.marks.last_trade_price! * 10000))}</b><small>YES</small></span>)}</div></div>;
}
export function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {const id = setInterval(() => setNow(new Date()),1000);return () => clearInterval(id);},[]);
  return <span className="clock">{now.toISOString().slice(11,19)}<small> UTC</small></span>;
}
