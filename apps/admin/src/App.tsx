import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, describeError, login, logout, saveSession, session, type Session } from './api';
import { Badge, Empty, ErrorMessage, Field, Icon, Loading } from './components';
import EventConfig from './EventConfig';
import { useResource } from './hooks';
import { Accesses, Audit, EventRequired, Incidents, Overview, Tickets } from './Sections';
import type { CursorPage, EventInfo } from './types';

const sections = [
  { id: 'overview', label: 'Vista general', icon: 'overview', description: 'Inventario, ingresos y operación de tu evento.' },
  { id: 'events', label: 'Eventos', icon: 'events', description: 'Configura zonas, precios, puertas y equipo.' },
  { id: 'tickets', label: 'Entradas', icon: 'tickets', description: 'Consulta entradas y administra reembolsos.' },
  { id: 'access', label: 'Accesos', icon: 'access', description: 'Monitorea ingresos y dispositivos de escaneo.' },
  { id: 'incidents', label: 'Incidentes', icon: 'incidents', description: 'Revisa los conflictos y la evidencia de seguridad.' },
  { id: 'audit', label: 'Auditoría', icon: 'audit', description: 'Consulta el registro de acciones administrativas.' },
];
export default function App() {
  const [activeSession, setActiveSession] = useState<Session | null>(session);
  useEffect(() => { const expired = () => setActiveSession(null); window.addEventListener('hypernova:session-expired', expired); return () => window.removeEventListener('hypernova:session-expired', expired); }, []);
  if (!activeSession) return <Login onLogin={setActiveSession} />;
  if (!['admin', 'organizador'].includes(activeSession.user.role)) { saveSession(null); return <Login onLogin={setActiveSession} />; }
  return <Portal activeSession={activeSession} onLogout={() => setActiveSession(null)} />;
}

function Login({ onLogin }: { onLogin: (value: Session) => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const data = new FormData(event.currentTarget);
    setPending(true); setError(null);
    try { onLogin(await login(String(data.get('email')).trim(), String(data.get('password')))); }
    catch (problem) { setError(describeError(problem)); }
    finally { setPending(false); }
  }
  return <main className="login-page"><section className="login-story"><Brand /><div><span className="eyebrow">Una buena experiencia empieza en la puerta</span><h1>Grandes eventos.<br />Cada entrada<br /><span>cuenta.</span></h1><p>Venta de entradas y control de acceso en un solo lugar. Administra tu evento con claridad, desde la primera reserva hasta el último ingreso.</p></div><div className="login-story-footer"><span className="orbit-mark" aria-hidden="true">✦</span><span>Hypernova Labs<br /><small>Plataforma de operaciones</small></span></div></section><section className="login-form-side"><div className="login-card"><span className="eyebrow">Portal administrativo</span><h2>Bienvenido de nuevo</h2><p className="muted">Ingresa con tu cuenta de organizador o administrador.</p><form className="form-stack" onSubmit={event => void submit(event)}>{error && <ErrorMessage message={error} />}<Field label="Correo electrónico"><input name="email" type="email" autoComplete="username" required autoFocus placeholder="tu@organizacion.com" /></Field><Field label="Contraseña"><input name="password" type="password" autoComplete="current-password" required minLength={8} /></Field><button className="button primary login-submit" disabled={pending}>{pending ? 'Ingresando…' : 'Ingresar al portal'}<Icon name="arrow" size={18} /></button></form><p className="login-note">Para el entorno de prueba, consulta las cuentas y la contraseña generada en las instrucciones del proyecto.</p></div><span className="login-copyright">Hypernova Labs · Ticketing y control de acceso</span></section></main>;
}
function Brand() { return <a className="brand" href="#" aria-label="Hypernova inicio"><span className="brand-symbol" aria-hidden="true">✦</span><span>hypernova<small>LABS</small></span></a>; }

function Portal({ activeSession, onLogout }: { activeSession: Session; onLogout: () => void }) {
  const [section, setSection] = useState('overview');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [createEvent, setCreateEvent] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [extraEvents, setExtraEvents] = useState<EventInfo[]>([]);
  const [extraCursor, setExtraCursor] = useState<string | null | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const previousDrawer = useRef(false);
  useEffect(() => {
    if (drawer) document.querySelector<HTMLElement>('.sidebar .nav-item')?.focus();
    else if (previousDrawer.current) document.querySelector<HTMLElement>('.mobile-menu')?.focus();
    previousDrawer.current = drawer;
    if (!drawer) return;
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') setDrawer(false); };
    document.addEventListener('keydown', keydown);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', keydown); document.body.style.overflow = overflow; };
  }, [drawer]);
  const events = useResource<CursorPage<EventInfo>>('/admin/events');
  const detail = useResource<EventInfo>(selectedId ? `/admin/events/${selectedId}` : null);
  const eventList = [...(events.data?.items ?? []), ...extraEvents];
  const nextCursor = extraCursor === undefined ? events.data?.nextCursor : extraCursor;
  const event = detail.data;
  const activeSection = sections.find(item => item.id === section) ?? sections[0]!;
  useEffect(() => {
    if (!events.data) return;
    if (!selectedId && events.data.items.length) setSelectedId(events.data.items[0]!.id);
  }, [events.data, selectedId]);
  function changed(id?: number) { if (id) setSelectedId(id); events.reload(); detail.reload(); setExtraEvents([]); setExtraCursor(undefined); }
  function navigate(value: string) { setSection(value); setDrawer(false); }
  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true); setActionError(null);
    try {
      const result = await api<CursorPage<EventInfo>>(`/admin/events?cursor=${encodeURIComponent(nextCursor)}`);
      setExtraEvents(previous => [...previous, ...result.items]); setExtraCursor(result.nextCursor ?? null);
    } catch (problem) { setActionError(describeError(problem)); }
    finally { setLoadingMore(false); }
  }
  async function signOut() {
    if (signingOut) return;
    setSigningOut(true); setActionError(null);
    try { await logout(); onLogout(); }
    catch (problem) { setActionError(`No se pudo cerrar la sesión en el servidor: ${describeError(problem)} Vuelve a intentar para invalidarla.`); }
    finally { setSigningOut(false); }
  }
  return <div className="app-shell">{drawer && <button className="drawer-backdrop" aria-label="Cerrar menú" onClick={() => setDrawer(false)} />}<aside className={`sidebar ${drawer ? 'is-open' : ''}`}><Brand /><span className="nav-caption">Administración</span><nav aria-label="Menú principal">{sections.map(item => <button key={item.id} className={section === item.id ? 'nav-item active' : 'nav-item'} aria-current={section === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}><Icon name={item.icon} /><span>{item.label}</span>{section === item.id && <span className="nav-indicator" />}</button>)}</nav><div className="sidebar-bottom"><div className="workspace-card"><span className="workspace-dot" /><div><strong>Operaciones de eventos</strong><small>Datos sincronizados con la API</small></div></div><div className="user-card"><span className="avatar">{activeSession.user.name.slice(0, 1).toUpperCase()}</span><div><strong>{activeSession.user.name}</strong><small>{activeSession.user.role === 'admin' ? 'Administrador' : 'Organizador'}</small></div><button className="icon-button" aria-label="Cerrar sesión" title="Cerrar sesión" disabled={signingOut} onClick={() => void signOut()}><Icon name="logout" size={18} /></button></div></div></aside><div className="main-layout" inert={drawer}><header className="topbar"><button className="icon-button mobile-menu" aria-label="Abrir menú" aria-expanded={drawer} onClick={() => setDrawer(true)}><Icon name="overview" /></button><div className="breadcrumbs"><span>Administración</span><span>/</span><strong>{activeSection.label}</strong></div><div className="topbar-right"><span className="environment-label"><span className="status-dot" />Operación</span><span className="avatar small">{activeSession.user.name.slice(0, 1).toUpperCase()}</span></div></header><main id="main-content" className="content"><div className="page-heading"><div><span className="eyebrow">Hypernova · Administración</span><h1>{activeSection.label}</h1><p>{activeSection.description}</p></div><button className="button primary" onClick={() => { setCreateEvent(true); navigate('events'); }}><Icon name="plus" size={18} />Crear evento</button></div>{actionError && <ErrorMessage message={actionError} retry={() => setActionError(null)} />}<div className="event-toolbar"><label className="event-picker"><span>Evento activo</span><select aria-label="Evento activo" value={selectedId ?? ''} disabled={events.loading} onChange={change => setSelectedId(Number(change.target.value))}>{!eventList.some(item => item.id === selectedId) && <option value={selectedId ?? ''}>{event?.name ?? (events.loading ? 'Cargando eventos…' : 'Selecciona un evento')}</option>}{eventList.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>{nextCursor && <button className="text-button" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? 'Cargando…' : 'Cargar más eventos'}</button>}<span className="event-toolbar-note">{activeSession.user.role === 'admin' ? 'Acceso administrativo' : 'Sólo los eventos de tu organización'}</span></div>{events.error && <ErrorMessage message={events.error} retry={events.reload} />}{events.loading && !createEvent ? <Loading label="Cargando tus eventos…" /> : detail.loading && !createEvent && section !== 'audit' ? <Loading label="Cargando el evento…" /> : detail.error && !createEvent && section !== 'audit' ? <ErrorMessage message={detail.error} retry={detail.reload} /> : <div className="section-content" key={`${section}-${selectedId}`}>
          {section === 'overview' && (event ? <Overview event={event} go={navigate} /> : <Empty title="Tu próximo evento empieza aquí">Crea un evento para configurar el aforo, los precios y el equipo.</Empty>)}
          {section === 'events' && <EventConfig event={event} user={activeSession.user} changed={changed} createEvent={createEvent} closeCreate={() => setCreateEvent(false)} />}
          {section === 'tickets' && (event ? <Tickets event={event} /> : <EventRequired />)}
          {section === 'access' && (event ? <Accesses event={event} /> : <EventRequired />)}
          {section === 'incidents' && (event ? <Incidents event={event} /> : <EventRequired />)}
          {section === 'audit' && <Audit />}
        </div>}<footer className="content-footer"><span>Hypernova Labs · Gestión de eventos</span><span>Importes en USD · Horarios en tu zona local</span></footer></main></div></div>;
}
