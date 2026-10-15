import { useEffect, useId, useRef, type ReactNode } from 'react';
import type { Resource } from './hooks';

export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const paths: Record<string, ReactNode> = {
    overview: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
    events: <><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M16 3v4M8 3v4M3 11h18M8 15h3" /></>,
    tickets: <><path d="M3 8h18v3a3 3 0 0 0 0 6v3H3v-3a3 3 0 0 0 0-6V8Z" /><path d="M15 8v3m0 3v3m0 2v1" /></>,
    access: <><path d="M4 21h16M8 21V4l10-1v18M12 12h1M3 10h3m-2-2 2 2-2 2" /></>,
    incidents: <><path d="m12 3 10 17H2L12 3Z" /><path d="M12 9v5m0 3h.01" /></>,
    audit: <><path d="M15 3H5v18h14V7l-4-4Z" /><path d="M14 3v5h5M8 12h8M8 16h6" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6 7a8 8 0 0 1 14 5M18 17A8 8 0 0 1 4 12" /></>,
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
    logout: <><path d="M9 4H4v16h5M9 12h11m-4-4 4 4-4 4" /></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    zone: <><path d="M4 4h16v16H4zM4 10h16M10 4v16" /></>,
    money: <><rect x="2" y="5" width="20" height="14" rx="2" /><circle cx="12" cy="12" r="3" /><path d="M5 12h.01M19 12h.01" /></>,
    sync: <><path d="M3 7h13l-3-3M21 17H8l3 3M16 7l-3 3M8 17l3-3" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...common}>{paths[name] ?? paths.overview}</svg>;
}

export function Loading({ label = 'Cargando datos del servidor…' }: { label?: string }) {
  return <div className="state-state" role="status"><span className="spinner" />{label}</div>;
}
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty-state"><span className="empty-symbol"><Icon name="overview" size={27} /></span><strong>{title}</strong>{children && <p>{children}</p>}</div>;
}
export function ErrorMessage({ message, retry }: { message: string; retry?: () => void }) {
  return <div className="error-message" role="alert"><Icon name="incidents" /><div><strong>No se pudo completar la operación</strong><p>{message}</p></div>{retry && <button type="button" className="button secondary small" onClick={retry}>Reintentar</button>}</div>;
}
export function ResourceState<T>({ resource, children }: { resource: Resource<T>; children: (data: T) => ReactNode }) {
  if (resource.loading) return <Loading />;
  if (resource.error) return <ErrorMessage message={resource.error} retry={resource.reload} />;
  if (!resource.data) return <Empty title="Sin datos disponibles" />;
  return <>{children(resource.data)}</>;
}

const stateLabels: Record<string, string> = {
  paid: 'Pagada', transferred: 'Transferida', used: 'Usada', refunded: 'Reembolsada', void: 'Anulada',
  active: 'Activa', expired: 'Vencida', cancelled: 'Cancelada', pending: 'Pendiente', accepted: 'Aceptada',
  en_venta: 'En venta', agotado: 'Agotado', borrador: 'Borrador', finalizado: 'Finalizado',
  critical: 'Crítico', high: 'Alta', medium: 'Media', low: 'Baja', warning: 'Advertencia',
};
export function Badge({ value }: { value: string }) { return <span className={`badge state-${value}`}>{stateLabels[value] ?? value.replaceAll('_', ' ')}</span>; }
export const money = (cents: number) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(cents / 100);
export function dateTime(value: string | null | undefined): string {
  if (!value) return 'Sin registro';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}
export function Modal({ title, description, close, children }: { title: string; description?: string; close: () => void; children: ReactNode }) {
  const titleId = useId();
  const modalRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const modal = modalRef.current;
    const focusable = () => Array.from(modal?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]') ?? []);
    (modal?.querySelector<HTMLElement>('input:not([disabled]), select:not([disabled]), textarea:not([disabled])') ?? focusable()[0])?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current();
      if (event.key !== 'Tab') return;
      const elements = focusable(); const first = elements[0]; const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keydown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', keydown); document.body.style.overflow = previousOverflow; previous?.focus(); };
  }, []);
  return <div className="modal-backdrop" onMouseDown={event => { if (event.currentTarget === event.target) close(); }}><div ref={modalRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className="modal"><div className="modal-heading"><div><span className="eyebrow">Administración</span><h2 id={titleId}>{title}</h2>{description && <p>{description}</p>}</div><button className="icon-button" type="button" aria-label="Cerrar diálogo" onClick={close}><Icon name="close" /></button></div>{children}</div></div>;
}
export function SectionHeading({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <div className="section-heading"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{action}</div>;
}
export function RefreshButton({ onClick }: { onClick: () => void }) { return <button className="button secondary small" onClick={onClick}><Icon name="refresh" size={16} />Actualizar</button>; }
