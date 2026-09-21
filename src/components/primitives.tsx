import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { X, ArrowUpRight, Grip } from 'lucide-react';

export function Panel({ title, eyebrow, actions, children, className = '' }: { title: string; eyebrow?: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`panel ${className}`}><header className="panel-header"><div className="panel-title"><Grip size={13} className="grip"/><h2>{title}</h2>{eyebrow && <span className="panel-count">{eyebrow}</span>}</div>{actions}</header>{children}</section>;
}
export function Badge({ children, tone = '' }: { children: ReactNode; tone?: string }) { return <span className={`badge ${tone}`}>{children}</span>; }
export function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const opener = document.activeElement as HTMLElement | null; ref.current?.showModal(); const old = document.body.style.overflow; document.body.style.overflow = 'hidden'; const node = ref.current; return () => { document.body.style.overflow = old; node?.close(); opener?.focus(); }; }, []);
  return <dialog ref={ref} className={`modal ${wide ? 'wide' : ''}`} aria-label={title} onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) onClose(); }}><header className="modal-header"><span>{title}</span><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={18}/></button></header><div className="modal-body">{children}</div></dialog>;
}
export function SourceLink({ url, children = 'View venue source' }: { url: string; children?: ReactNode }) { return <a className="source-link" href={url} target="_blank" rel="noreferrer">{children}<ArrowUpRight size={14}/></a>; }
export function KeyValue({ label, children }: { label: string; children: ReactNode }) { return <div className="key-value"><span>{label}</span><div>{children}</div></div>; }
