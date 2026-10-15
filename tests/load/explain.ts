import { writeFileSync, mkdirSync } from 'node:fs';
import { sql, literal } from '../helpers/runtime';

// Representative real application queries: EXPLAIN ANALYZE executes SELECTs.
// This is a measured comparison for this seed, not a claim about all future workloads.
const eventId=Number(sql('SELECT event_id FROM tickets GROUP BY event_id ORDER BY count(*) DESC LIMIT 1'));
const holderId=sql('SELECT holder_id FROM tickets GROUP BY holder_id ORDER BY count(*) DESC LIMIT 1');
const queries=[
  {name:'Disponibilidad por zona y fase vigente (EventsService.detail)',query:`SELECT z.id,z.name,z.capacity,z.sold_count AS sold,COALESCE(r.quantity,0)::int AS reserved,(z.capacity-z.sold_count-COALESCE(r.quantity,0))::int AS available,p.price_cents AS price_cents FROM zones z LEFT JOIN LATERAL(SELECT SUM(quantity) AS quantity FROM reservations WHERE zone_id=z.id AND state='active' AND expires_at>now()) r ON true LEFT JOIN LATERAL(SELECT price_cents FROM price_phases WHERE zone_id=z.id AND starts_at<=now() AND ends_at>now() ORDER BY starts_at DESC,id DESC LIMIT 1)p ON true WHERE z.event_id=${eventId} ORDER BY z.id`},
  {name:'Ingresos administrativos por evento (AdminService.sales)',query:`SELECT COALESCE(SUM(CASE WHEN t.state IN ('refunded','void') THEN 0 ELSE p.unit_price_cents END),0)::bigint AS total FROM tickets t JOIN purchases p ON p.id=t.purchase_id WHERE t.event_id=${eventId}`},
  {name:'Billetera paginada por cursor (CommerceService.tickets, primera página)',query:`SELECT t.id,t.event_id,e.name,t.zone_id,z.name,t.state,t.version,t.issued_at,t.purchase_id,p.unit_price_cents,t.holder_id FROM tickets t JOIN events e ON e.id=t.event_id JOIN zones z ON z.id=t.zone_id JOIN purchases p ON p.id=t.purchase_id WHERE t.holder_id=${literal(holderId)} ORDER BY t.id LIMIT 51`},
  {name:'Entradas administrativas con búsqueda textual (AdminService.tickets, alcance admin)',query:`SELECT t.id,t.event_id,e.name,t.zone_id,z.name,t.state,t.version,u.email,b.email,p.unit_price_cents FROM tickets t JOIN events e ON e.id=t.event_id JOIN zones z ON z.id=t.zone_id JOIN users u ON u.id=t.holder_id JOIN users b ON b.id=t.buyer_id JOIN purchases p ON p.id=t.purchase_id WHERE t.event_id=${eventId} AND (u.email ILIKE '%asistente%' OR u.name ILIKE '%asistente%' OR b.email ILIKE '%asistente%' OR t.id ILIKE '%asistente%') ORDER BY t.id LIMIT 51`},
];
sql('ANALYZE');
const measured=queries.map(item=>{
  const plan=sql(`EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT TEXT) ${item.query}`);
  const ms=Number(plan.match(/Execution Time: ([0-9.]+) ms/)?.[1]);
  return {...item,executionMs:ms,plan};
}).sort((a,b)=>b.executionMs-a.executionMs);
const counts=sql("SELECT json_build_object('events',(SELECT count(*) FROM events),'zones',(SELECT count(*) FROM zones),'tickets',(SELECT count(*) FROM tickets),'purchases',(SELECT count(*) FROM purchases),'reservations',(SELECT count(*) FROM reservations),'scanner_attempts',(SELECT count(*) FROM scanner_attempts))");
const body=[`EXPLAIN real — ${new Date().toISOString()}`,`PostgreSQL: ${sql('SELECT version()')}`,`Filas al ejecutar: ${counts}`,`Evento con más tickets: ${eventId}`,'Comparación: cuatro consultas reales sobre la semilla + fixtures QA; ANALYZE previamente.','La consulta señalada es la más lenta de esta muestra medida, no una afirmación global sobre producción.',`Más lenta en esta muestra: ${measured[0]?.name} — ${measured[0]?.executionMs} ms`,'',...measured.flatMap(item=>[`${item.name} — ${item.executionMs} ms`,item.query,'',item.plan,''])].join('\n');
mkdirSync('docs/qa',{recursive:true});writeFileSync('docs/qa/explain.txt',body+'\n');
console.log(JSON.stringify({queries:measured.map(({name,executionMs})=>({name,executionMs})),report:'docs/qa/explain.txt'}));
