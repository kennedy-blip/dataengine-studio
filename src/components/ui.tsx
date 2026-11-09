'use client';
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, CheckCircle2, ChevronDown, Info, X, AlertCircle, LoaderCircle } from 'lucide-react';

export function Modal({ open, onClose, title, description, children, footer, wide, drawer }: { open: boolean; onClose: () => void; title: string; description?: string; children: ReactNode; footer?: ReactNode; wide?: boolean; drawer?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    const timer = setTimeout(() => (ref.current?.querySelector<HTMLElement>('[data-autofocus]') ?? ref.current?.querySelector<HTMLElement>('input:not([type="file"]),select,textarea') ?? ref.current?.querySelector<HTMLElement>('button'))?.focus(), 60);
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); }
      if (event.key === 'Tab') {
        const focusable = ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled):not([type="file"]),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]');
        if (!focusable?.length) return;
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', keydown);
    return () => { clearTimeout(timer); document.body.style.overflow = overflow; document.removeEventListener('keydown', keydown); previous?.focus(); };
  }, [open]);
  if (typeof document === 'undefined') return null;
  return createPortal(<AnimatePresence>{open && <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <motion.div ref={ref} role="dialog" aria-modal="true" aria-label={title} className={`modal ${wide ? 'modal-wide' : ''} ${drawer ? 'modal-drawer' : ''}`} initial={drawer ? { x: 70, opacity: 0 } : { y: 14, scale: .985, opacity: 0 }} animate={{ x: 0, y: 0, scale: 1, opacity: 1 }} exit={drawer ? { x: 70, opacity: 0 } : { y: 8, opacity: 0 }} transition={{ duration: .18 }}>
      <div className="modal-header"><div><h2>{title}</h2>{description && <p>{description}</p>}</div><button className="icon-btn shrink-0" onClick={onClose} aria-label="Close dialog"><X size={17} /></button></div>
      <div className="modal-body">{children}</div>{footer && <div className="modal-footer">{footer}</div>}
    </motion.div>
  </motion.div>}</AnimatePresence>, document.body);
}
export function Field({ label, hint, children, className = '' }: { label: string; hint?: string; children: ReactNode; className?: string }) { return <div className={className}><label><span className="field-label">{label}</span>{children}</label>{hint && <p className="field-hint">{hint}</p>}</div>; }
export function Select({ value, onChange, options, placeholder, disabled }: { value: string; onChange: (value: string) => void; options: (string | { value: string; label: string })[]; placeholder?: string; disabled?: boolean }) { return <div className="relative"><select className="input appearance-none" value={value} onChange={e => onChange(e.target.value)} disabled={disabled}>{placeholder && <option value="">{placeholder}</option>}{options.map(o => { const v = typeof o === 'string' ? o : o.value; return <option key={v} value={v}>{typeof o === 'string' ? o : o.label}</option>; })}</select><ChevronDown size={13} className="pointer-events-none absolute right-3 top-3.5 text-muted" /></div>; }
export function ColumnPicker({ columns, selected, onChange, multiple = true }: { columns: string[]; selected: string[]; onChange: (value: string[]) => void; multiple?: boolean }) { return <div className="column-chips">{columns.map(c => <button type="button" key={c} className={`column-chip ${selected.includes(c) ? 'selected' : ''}`} onClick={() => onChange(multiple ? selected.includes(c) ? selected.filter(v => v !== c) : [...selected, c] : [c])}>{selected.includes(c) && <Check size={10} />}{c}</button>)}{!columns.length && <span className="text-xs text-muted">No columns available</span>}</div>; }
export function InfoBox({ children, tone = 'green' }: { children: ReactNode; tone?: 'green' | 'amber' | 'purple' }) { return <div className={`info-box ${tone}`}><Info size={14} /><div>{children}</div></div>; }
export function Spinner({ size = 15 }: { size?: number }) { return <LoaderCircle size={size} className="animate-spin" />; }
export interface ToastMessage { id: number; message: string; type: 'success' | 'error' | 'info' }
export function Toasts({ items, dismiss }: { items: ToastMessage[]; dismiss: (id: number) => void }) { return <div className="fixed bottom-6 right-6 z-[150] flex max-w-[420px] flex-col gap-2" aria-live="polite"><AnimatePresence>{items.map(item => <motion.div key={item.id} initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 20 }} className="card flex items-start gap-3 p-4 shadow-lg"><span className={item.type === 'error' ? 'text-red-400' : 'text-accent'}>{item.type === 'error' ? <AlertCircle size={17} /> : <CheckCircle2 size={17} />}</span><p className="flex-1 text-[11px] leading-5 text-slate-600">{item.message}</p><button onClick={() => dismiss(item.id)} className="text-slate-400" aria-label="Dismiss notification"><X size={14} /></button></motion.div>)}</AnimatePresence></div>; }
export function ConfirmDialog({ open, title, description, confirm = 'Confirm', danger, onConfirm, onClose }: { open: boolean; title: string; description: string; confirm?: string; danger?: boolean; onConfirm: () => void; onClose: () => void }) { return <Modal open={open} onClose={onClose} title={title} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => { onConfirm(); onClose(); }}>{confirm}</button></>}><p className="text-xs leading-6 text-muted">{description}</p></Modal>; }
