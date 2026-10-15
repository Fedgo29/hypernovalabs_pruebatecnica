import { useState, type FormEvent } from 'react';
import { describeError, mutate, type User } from './api';
import { Badge, dateTime, Empty, ErrorMessage, Field, Icon, Modal, money, SectionHeading } from './components';
import { useResource } from './hooks';
import type { CursorPage, EventInfo, Gate, PricePhase, StaffMember, Zone } from './types';

type Editor = { kind: 'event'; value?: EventInfo } | { kind: 'zone'; value?: Zone } | { kind: 'phase'; value?: PricePhase } | { kind: 'gate'; value?: Gate } | { kind: 'staff' };
const localDate = (value: string | undefined) => {
  if (!value) return '';
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};
const iso = (value: FormDataEntryValue | null) => new Date(String(value)).toISOString();
const text = (data: FormData, key: string) => String(data.get(key) ?? '').trim();
const integer = (data: FormData, key: string) => Number(data.get(key));

export default function EventConfig({ event, user, changed, createEvent, closeCreate }: { event: EventInfo | null; user: User; changed: (id?: number) => void; createEvent: boolean; closeCreate: () => void }) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const active = createEvent ? { kind: 'event' as const } : editor;
  const staffOptions = useResource<CursorPage<StaffMember>>(active?.kind === 'staff' ? '/admin/staff' : null);
  const organizers = useResource<CursorPage<StaffMember>>(active?.kind === 'event' && user.role === 'admin' && !active.value ? '/admin/organizers' : null);
  const open = (value: Editor) => { setError(null); setEditor(value); };
  const close = () => { if (pending) return; setEditor(null); setError(null); closeCreate(); };

  async function submit(eventSubmit: FormEvent<HTMLFormElement>) {
    eventSubmit.preventDefault();
    if (!active || pending) return;
    const data = new FormData(eventSubmit.currentTarget);
    setPending(true); setError(null);
    try {
      let savedEventId: number | undefined;
      if (active.kind === 'event') {
        const payload = {
          name: text(data, 'name'), venue: text(data, 'venue'),
          startsAt: iso(data.get('startsAt')), saleOpensAt: iso(data.get('saleOpensAt')), refundUntil: iso(data.get('refundUntil')),
          perAccountLimit: integer(data, 'perAccountLimit'), status: text(data, 'status'),
          ...(text(data, 'organizerId') ? { organizerId: text(data, 'organizerId') } : {}),
        };
        if (new Date(payload.refundUntil) >= new Date(payload.startsAt)) throw new Error('La fecha límite de reembolso debe ser anterior al evento.');
        if (new Date(payload.saleOpensAt) >= new Date(payload.startsAt)) throw new Error('La venta debe abrir antes del inicio del evento.');
        const saved = await mutate<EventInfo>(active.value ? `/admin/events/${active.value.id}` : '/admin/events', payload, active.value ? 'PATCH' : 'POST');
        savedEventId = saved.id;
      } else {
        if (!event) throw new Error('Selecciona un evento.');
        if (active.kind === 'zone') await mutate(active.value ? `/admin/zones/${active.value.id}` : `/admin/events/${event.id}/zones`, { name: text(data, 'name'), capacity: integer(data, 'capacity') }, active.value ? 'PATCH' : 'POST');
        if (active.kind === 'phase') {
          const price = integer(data, 'priceCents');
          if (!Number.isSafeInteger(price) || price < 0) throw new Error('El precio debe ser un entero positivo en centésimos.');
          const startsAt = iso(data.get('startsAt')); const endsAt = iso(data.get('endsAt'));
          if (new Date(startsAt) >= new Date(endsAt)) throw new Error('El fin de la fase debe ser posterior al inicio.');
          await mutate(active.value ? `/admin/phases/${active.value.id}` : `/admin/events/${event.id}/phases`, { zoneId: active.value?.zoneId ?? integer(data, 'zoneId'), name: text(data, 'name'), priceCents: price, startsAt, endsAt }, active.value ? 'PATCH' : 'POST');
        }
        if (active.kind === 'gate') {
          const zoneId = text(data, 'zoneId');
          await mutate(active.value ? `/admin/gates/${active.value.id}` : `/admin/events/${event.id}/gates`, { name: text(data, 'name'), zoneId: zoneId ? Number(zoneId) : null }, active.value ? 'PATCH' : 'POST');
        }
        if (active.kind === 'staff') await mutate(`/admin/events/${event.id}/staff`, { userId: text(data, 'userId') });
      }
      setEditor(null); closeCreate(); changed(savedEventId); setNotice('Cambios guardados. La API validó los permisos y las reglas del evento.');
    } catch (problem) { setError(describeError(problem)); }
    finally { setPending(false); }
  }
  async function removeStaff(userId: string) {
    if (!event || pending) return;
    setPending(true); setNotice(null);
    try { await mutate(`/admin/events/${event.id}/staff/${encodeURIComponent(userId)}`, {}, 'DELETE'); changed(); setNotice('Asignación de staff retirada.'); }
    catch (problem) { setNotice(describeError(problem)); }
    finally { setPending(false); }
  }

  return <>
    {notice && <div className="notice" role="status"><Icon name="check" /><span>{notice}</span><button className="icon-button" aria-label="Cerrar aviso" onClick={() => setNotice(null)}><Icon name="close" size={16} /></button></div>}
    {event ? <>
      <div className="panel event-description"><div><span className="eyebrow">Configuración del evento</span><h2>{event.name}</h2><p>{event.venue || 'Sede por definir'} <span className="middot">·</span> {dateTime(event.startsAt)}</p><Badge value={event.status} /></div><button className="button secondary" onClick={() => open({ kind: 'event', value: event })}>Editar evento</button><dl className="detail-list"><div><dt>Apertura de venta</dt><dd>{dateTime(event.saleOpensAt)}</dd></div><div><dt>Reembolsos hasta</dt><dd>{dateTime(event.refundUntil)}</dd></div><div><dt>Límite por cuenta</dt><dd>{event.perAccountLimit} entradas</dd></div></dl></div>
      <div className="panel"><SectionHeading title="Zonas y aforo" description="La base de datos protege el cupo durante cada reserva." action={<button className="button secondary small" onClick={() => open({ kind: 'zone' })}><Icon name="plus" size={16} />Añadir zona</button>} />{event.zones.length ? <div className="table-scroll"><table><thead><tr><th>Zona</th><th>Aforo</th><th>Vendidas</th><th>Reservadas</th><th>Disponibles</th><th><span className="sr-only">Acciones</span></th></tr></thead><tbody>{event.zones.map(zone => <tr key={zone.id}><td><strong>{zone.name}</strong></td><td>{zone.capacity}</td><td>{zone.sold}</td><td>{zone.reserved}</td><td><strong>{zone.available}</strong></td><td className="align-right"><button className="text-button" onClick={() => open({ kind: 'zone', value: zone })}>Editar</button></td></tr>)}</tbody></table></div> : <Empty title="Aún no hay zonas">Añade una zona y su capacidad para habilitar la venta.</Empty>}</div>
      <div className="panel"><SectionHeading title="Fases de precio" description="Los importes se guardan en centésimos; el servidor fija el precio al reservar." action={<button className="button secondary small" disabled={!event.zones.length} onClick={() => open({ kind: 'phase' })}><Icon name="plus" size={16} />Añadir fase</button>} />{event.phases?.length ? <div className="table-scroll"><table><thead><tr><th>Fase / zona</th><th>Precio</th><th>Desde</th><th>Hasta</th><th><span className="sr-only">Acciones</span></th></tr></thead><tbody>{event.phases.map(phase => <tr key={phase.id}><td><strong>{phase.name}</strong><small>{event.zones.find(zone => zone.id === phase.zoneId)?.name ?? `Zona ${phase.zoneId}`}</small></td><td>{money(phase.priceCents)}</td><td>{dateTime(phase.startsAt)}</td><td>{dateTime(phase.endsAt)}</td><td className="align-right"><button className="text-button" onClick={() => open({ kind: 'phase', value: phase })}>Editar</button></td></tr>)}</tbody></table></div> : <Empty title="No hay fases configuradas">Define las fechas y el precio de preventa, general o taquilla.</Empty>}</div>
      <div className="two-columns"><div className="panel"><SectionHeading title="Puertas de acceso" action={<button className="button secondary small" onClick={() => open({ kind: 'gate' })}><Icon name="plus" size={16} />Añadir</button>} />{event.gates?.length ? <ul className="entity-list">{event.gates.map(gate => <li key={gate.id}><span className="entity-icon"><Icon name="access" /></span><div><strong>{gate.name}</strong><small>{gate.zoneIds?.length ? gate.zoneIds.map(id => event.zones.find(zone => zone.id === id)?.name ?? `Zona ${id}`).join(', ') : gate.zoneId ? event.zones.find(zone => zone.id === gate.zoneId)?.name : 'Todas las zonas'}</small></div><button className="text-button" onClick={() => open({ kind: 'gate', value: gate })}>Editar</button></li>)}</ul> : <Empty title="Sin puertas configuradas" />}</div>
      <div className="panel"><SectionHeading title="Equipo de staff" action={<button className="button secondary small" onClick={() => open({ kind: 'staff' })}><Icon name="plus" size={16} />Asignar</button>} />{event.staff?.length ? <ul className="entity-list">{event.staff.map(member => <li key={member.id}><span className="avatar small">{member.name.slice(0, 1)}</span><div><strong>{member.name}</strong><small>{member.email}</small></div><button className="text-button danger-text" disabled={pending} onClick={() => void removeStaff(member.id)} aria-label={`Retirar a ${member.name}`}>Retirar</button></li>)}</ul> : <Empty title="Sin staff asignado">Asigna usuarios con rol staff para iniciar turnos.</Empty>}</div></div>
    </> : <Empty title="Crea tu primer evento">Después podrás configurar las zonas, precios y puertas.</Empty>}
    {active && <Modal title={active.kind === 'event' ? active.value ? 'Editar evento' : 'Crear evento' : active.kind === 'zone' ? active.value ? 'Editar zona' : 'Añadir zona' : active.kind === 'phase' ? active.value ? 'Editar fase' : 'Añadir fase de precio' : active.kind === 'gate' ? active.value ? 'Editar puerta' : 'Añadir puerta' : 'Asignar staff'} close={close}>
      <form onSubmit={eventSubmit => void submit(eventSubmit)} className="form-stack">{error && <ErrorMessage message={error} />}
        {active.kind === 'event' && <><Field label="Nombre"><input name="name" required maxLength={180} defaultValue={active.value?.name} autoFocus /></Field><Field label="Lugar"><input name="venue" required maxLength={200} defaultValue={active.value?.venue} /></Field><div className="form-grid"><Field label="Inicio del evento"><input type="datetime-local" name="startsAt" required defaultValue={localDate(active.value?.startsAt)} /></Field><Field label="Apertura de venta"><input type="datetime-local" name="saleOpensAt" required defaultValue={localDate(active.value?.saleOpensAt)} /></Field><Field label="Límite de reembolsos"><input type="datetime-local" name="refundUntil" required defaultValue={localDate(active.value?.refundUntil)} /></Field><Field label="Entradas por cuenta"><input type="number" name="perAccountLimit" min={1} max={100} required defaultValue={active.value?.perAccountLimit ?? 4} /></Field></div><Field label="Estado"><select name="status" defaultValue={active.value?.status ?? 'en_venta'}><option value="en_venta">En venta</option><option value="proximo">Próximo</option>{active.value && <><option value="finalizado">Finalizado</option><option value="cancelado">Cancelado</option></>}</select></Field>{user.role === 'admin' && !active.value && <Field label="Organizador" hint="Si se deja vacío, el evento pertenece a tu cuenta."><select name="organizerId" defaultValue=""><option value="">Mi cuenta</option>{organizers.data?.items.map(member => <option key={member.id} value={member.id}>{member.name} · {member.email}</option>)}</select>{organizers.error && <span role="alert">{organizers.error}</span>}</Field>}</>}
        {active.kind === 'zone' && <><Field label="Nombre de zona"><input name="name" required maxLength={100} defaultValue={active.value?.name} autoFocus /></Field><Field label="Aforo" hint="No puede ser menor al cupo vendido más las reservas vigentes."><input type="number" name="capacity" min={Math.max(1, (active.value?.sold ?? 0) + (active.value?.reserved ?? 0))} step={1} required defaultValue={active.value?.capacity} /></Field></>}
        {active.kind === 'phase' && <><Field label="Nombre"><input name="name" required maxLength={100} defaultValue={active.value?.name} placeholder="Preventa, general o taquilla" autoFocus /></Field><Field label="Zona"><select name="zoneId" required disabled={Boolean(active.value)} defaultValue={active.value?.zoneId ?? event?.zones[0]?.id}>{event?.zones.map(zone => <option key={zone.id} value={zone.id}>{zone.name}</option>)}</select></Field><Field label="Precio en centésimos" hint="Ejemplo: 2500 equivale a USD 25,00. Sólo enteros."><input type="number" name="priceCents" min={0} step={1} required defaultValue={active.value?.priceCents} /></Field><div className="form-grid"><Field label="Desde"><input type="datetime-local" name="startsAt" required defaultValue={localDate(active.value?.startsAt)} /></Field><Field label="Hasta"><input type="datetime-local" name="endsAt" required defaultValue={localDate(active.value?.endsAt)} /></Field></div></>}
        {active.kind === 'gate' && <><Field label="Nombre de puerta"><input name="name" required maxLength={100} defaultValue={active.value?.name} autoFocus /></Field><Field label="Zona habilitada"><select name="zoneId" defaultValue={active.value?.zoneIds?.[0] ?? active.value?.zoneId ?? ''}><option value="">Todas las zonas</option>{event?.zones.map(zone => <option key={zone.id} value={zone.id}>{zone.name}</option>)}</select></Field></>}
        {active.kind === 'staff' && <Field label="Usuario staff" hint="El servidor comprueba el rol y registra la asignación."><select name="userId" required defaultValue="" disabled={staffOptions.loading}><option value="">{staffOptions.loading ? 'Cargando equipo…' : 'Selecciona una cuenta'}</option>{staffOptions.data?.items.filter(member => !event?.staff?.some(assigned => assigned.id === member.id)).map(member => <option key={member.id} value={member.id}>{member.name} · {member.email}</option>)}</select>{staffOptions.error && <ErrorMessage message={staffOptions.error} retry={staffOptions.reload} />}</Field>}
        <div className="form-actions"><button className="button secondary" type="button" onClick={close} disabled={pending}>Cancelar</button><button className="button primary" disabled={pending}>{pending ? 'Guardando…' : 'Guardar cambios'}<Icon name="check" size={16} /></button></div>
      </form>
    </Modal>}
  </>;
}
