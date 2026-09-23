import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { X, ArrowUpRight, Grip } from 'lucide-react';

/**
 * A draggable column divider. Drag or use the arrow keys; every panel that
 * carries a name too long for its default width has to be widenable, because
 * a truncated contract name is the one thing this app must never do.
 *
 * `invert` is for a handle on the LEFT of the panel it sizes: dragging left
 * then makes that panel wider, not narrower.
 */
export function ResizeHandle({ value, min, max, onChange, label, invert = false }: {
  value: number; min: number; max: number; onChange: (next: number) => void; label: string; invert?: boolean;
}) {
  const origin = useRef({ x: 0, value: 0 });
  const clamp = (n: number) => Math.min(max, Math.max(min, Math.round(n)));
  return (
    <div
      className="resize-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        origin.current = { x: e.clientX, value };
      }}
      onPointerMove={(e) => {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
        const delta = (e.clientX - origin.current.x) * (invert ? -1 : 1);
        onChange(clamp(origin.current.value + delta));
      }}
      onLostPointerCapture={() => undefined}
      onKeyDown={(e) => {
        const step = (e.shiftKey ? 48 : 12) * (invert ? -1 : 1);
        if (e.key === 'ArrowLeft') onChange(clamp(value - step));
        else if (e.key === 'ArrowRight') onChange(clamp(value + step));
        else return;
        e.preventDefault();
      }}
    />
  );
}

/**
 * A workspace side column whose width the user controls. The width lives here
 * rather than in each view, so every screen resizes the same way.
 */
export function useColumnWidth(initial: number) {
  const [width, setWidth] = useState(initial);
  return { width, setWidth, reset: () => setWidth(initial) };
}

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
