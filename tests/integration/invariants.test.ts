import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { verifyRotatingCode, signRotatingCode, type AuthResponse } from '@hypernova/contracts';
import { baseUrl, runId, createdEventIds, request, ok, failure, sql, literal, login, roleSessions, createFixture, reserve, buy, material, scanner, scanAttempt, sync, type Fixture } from '../helpers/runtime';

let actors: Awaited<ReturnType<typeof roleSessions>>;
let fixture: Fixture;
let first: AuthResponse;
let second: AuthResponse;
const results: {name: string; status: 'passed'|'failed'; durationMs: number; error?: string}[] = [];
const started = new Date().toISOString();
let registeredScenarios = 0;
let setupStatus = 'pending';
function scenario(name: string, work: () => Promise<void>) {
  registeredScenarios++;
  test(name, async () => {
    const begin = performance.now();
    try { await work(); results.push({name,status:'passed',durationMs:performance.now()-begin}); }
    catch (error) { results.push({name,status:'failed',durationMs:performance.now()-begin,error:error instanceof Error ? error.message.replace(/Bearer\s+\S+/g, '[redacted]') : 'Unknown failure'}); throw error; }
  });
}
before(async () => {
  ok(await request('/v1/readiness'));
  actors = await roleSessions();
  first = actors.attendees[0]!; second = actors.attendees[1]!;
  fixture = await createFixture(actors.admin, actors.organizer.user.id, { zones: 2, label: 'integration' });
  setupStatus = 'passed';
});
after(() => {
  mkdirSync('docs/qa', {recursive:true});
  writeFileSync('docs/qa/runtime-results.json', JSON.stringify({ startedAt: started, finishedAt: new Date().toISOString(), baseUrl, runId, requiredRuntime: 'HTTP API + PostgreSQL 16 through Docker Compose', nodeVersion: process.version, setupStatus, plannedScenarios: registeredScenarios, overallPassed: setupStatus === 'passed' && results.length === registeredScenarios && results.every(r=>r.status==='passed'), fixtures: createdEventIds, passed: results.filter(r=>r.status==='passed').length, failed: results.filter(r=>r.status==='failed').length, scenarios: results, scope: 'Automated API, database and signed offline protocol checks; no native camera/device or browser interaction is claimed.' }, null, 2)+'\n');
});

scenario('Registro aplica rol asistente, errores consistentes, logout invalida access y refresh', async () => {
  const password = randomBytes(24).toString('base64url');
  const session = ok(await request<AuthResponse>('/v1/auth/register', {body:{email:`${runId}@example.test`,name:'QA Runtime',password,role:'admin'}}));
  assert.equal(session.user.role, 'asistente');
  assert.equal(ok(await request('/v1/auth/me',{session})).id,session.user.id);
  failure(await request('/v1/admin/events',{session}),403,'ADMIN_FORBIDDEN');
  ok(await request('/v1/auth/logout',{body:{refreshToken:session.refreshToken}}));
  failure(await request('/v1/auth/me',{session}),401);
  failure(await request('/v1/auth/refresh',{body:{refreshToken:session.refreshToken}}),401,'AUTH_INVALID_REFRESH');
  failure(await request('/v1/auth/register',{body:{email:'bad',password:'a',name:'x'}}),400);
});

scenario('Refresh rota, revoca access anterior y replay invalida toda la familia', async () => {
  const session = await login(first.user.email);
  const rotated = ok(await request<AuthResponse>('/v1/auth/refresh',{body:{refreshToken:session.refreshToken}}));
  assert.ok(rotated.refreshToken!==session.refreshToken,'rotation must replace refresh secret');
  failure(await request('/v1/auth/me',{session}),401);
  ok(await request('/v1/auth/me',{session:rotated}));
  failure(await request('/v1/auth/refresh',{body:{refreshToken:session.refreshToken}}),401);
  failure(await request('/v1/auth/me',{session:rotated}),401);
});

scenario('Doble toque concurrente reserva/pago: un cargo y una entrada; precio del servidor', async () => {
  const reservationKey = randomUUID();
  const body = {zoneId:fixture.zoneIds[0],quantity:1,amountCents:1};
  const attempts = await Promise.all(Array.from({length:8},()=>request('/v1/reservations',{session:first,key:reservationKey,body})));
  const reservations = attempts.map(ok);
  assert.equal(new Set(reservations.map(r=>r.id)).size,1);
  assert.equal(reservations[0].amountCents,12345);
  const id = reservations[0].id;
  const paymentKey = randomUUID();
  const paid = (await Promise.all(Array.from({length:8},()=>request(`/v1/reservations/${id}/pay`,{session:first,key:paymentKey,method:'POST',body:{amountCents:1}})))).map(ok);
  assert.equal(new Set(paid.map(p=>p.purchaseId)).size,1);
  assert.equal(paid[0].amountCents,12345);
  assert.equal(paid[0].tickets.length,1);
  assert.equal(sql(`SELECT count(*) FROM payment_ledger WHERE reservation_id=${literal(id)} AND kind='charge'`),'1');
  assert.equal(sql(`SELECT count(*) FROM tickets WHERE purchase_id=${literal(paid[0].purchaseId)}`),'1');
  failure(await request('/v1/reservations',{session:first,key:reservationKey,body:{zoneId:fixture.zoneIds[0],quantity:2}}),409,'IDEMPOTENCY_CONFLICT');
  const alternateKey = ok(await request(`/v1/reservations/${id}/pay`,{session:first,key:randomUUID(),method:'POST'}));
  assert.equal(alternateKey.purchaseId,paid[0].purchaseId);
});

scenario('Reserva vencida libera cupo; pago tardío reembolsa una sola vez sin emitir', async () => {
  const isolated = await createFixture(actors.admin, actors.organizer.user.id,{capacity:1,label:'expiry'});
  const reservation = await reserve(first,isolated.zoneIds[0]!);
  sql(`UPDATE reservations SET expires_at=now()-interval '1 second' WHERE id=${literal(reservation.id)}`);
  const availability = ok(await request(`/v1/events/${isolated.eventId}`));
  assert.equal(availability.zones[0].available,1,'availability excludes expired holds immediately');
  const late = ok(await request(`/v1/reservations/${reservation.id}/pay`,{session:first,key:randomUUID(),method:'POST'}));
  assert.equal(late.state,'late_refunded'); assert.deepEqual(late.tickets,[]);
  const retry = ok(await request(`/v1/reservations/${reservation.id}/pay`,{session:first,key:randomUUID(),method:'POST'}));
  assert.equal(retry.state,'late_refunded');
  assert.equal(sql(`SELECT count(*) FROM payment_ledger WHERE reservation_id=${literal(reservation.id)} AND kind='late_refund'`),'1');
  assert.equal(sql(`SELECT count(*) FROM purchases WHERE reservation_id=${literal(reservation.id)}`),'0');
  const next = await buy(second,isolated.zoneIds[0]!); assert.equal(next.tickets.length,1);
  assert.equal(sql(`SELECT sold_count||','||reserved_count FROM zones WHERE id=${isolated.zoneIds[0]}`),'1,0');
});

scenario('Cancelación repetida libera inventario sin hacerlo negativo', async () => {
  const reservation = await reserve(first,fixture.zoneIds[0]!);
  await Promise.all(Array.from({length:4},async()=>ok(await request(`/v1/reservations/${reservation.id}/cancel`,{session:first,method:'POST'}))));
  assert.equal(sql(`SELECT state FROM reservations WHERE id=${literal(reservation.id)}`),'cancelled');
  failure(await request(`/v1/reservations/${reservation.id}/pay`,{session:first,key:randomUUID(),method:'POST'}),409,'RESERVATION_CANCELLED');
  assert.equal(sql(`SELECT count(*) FROM zones WHERE id=${fixture.zoneIds[0]} AND reserved_count<0`),'0');
});

scenario('Límite por cuenta se cumple con reservas concurrentes entre zonas del mismo evento', async () => {
  const limited = await createFixture(actors.admin,actors.organizer.user.id,{limit:1,zones:2,label:'account-limit'});
  const concurrent = await Promise.all(limited.zoneIds.map(zoneId=>request('/v1/reservations',{session:actors.attendees[2],key:randomUUID(),body:{zoneId,quantity:1}})));
  assert.equal(concurrent.filter(r=>r.status===201).length,1);
  const rejected = concurrent.find(r=>r.status!==201)!; failure(rejected,409,'ACCOUNT_LIMIT');
  assert.equal(sql(`SELECT paid_count+reserved_count FROM account_inventory WHERE user_id=${literal(actors.attendees[2]!.user.id)} AND event_id=${limited.eventId}`),'1');
  await Promise.all(concurrent.filter(r=>r.status===201).map(async r=>ok(await request(`/v1/reservations/${r.body.id}/cancel`,{session:actors.attendees[2],method:'POST'}))));
});

scenario('Autorización: organizador ajeno, reserva de otro usuario y escáner sin asignación', async () => {
  failure(await request(`/v1/admin/events/${fixture.eventId}`,{session:actors.otherOrganizer}),403);
  failure(await request(`/v1/admin/events/${fixture.eventId}`,{session:first,method:'PATCH',body:{name:'forbidden'}}),403);
  failure(await request(`/v1/admin/events/${fixture.eventId}`,{session:actors.otherOrganizer,method:'PATCH',body:{name:'forbidden'}}),403);
  const reservation = await reserve(first,fixture.zoneIds[0]!);
  failure(await request(`/v1/reservations/${reservation.id}`,{session:second}),404);
  failure(await request(`/v1/reservations/${reservation.id}/pay`,{session:second,key:randomUUID(),method:'POST'}),404);
  const unassigned = await createFixture(actors.admin,actors.organizer.user.id,{label:'unassigned'});
  failure(await request('/v1/scanner/devices',{session:actors.staff,body:{deviceId:randomUUID(),eventId:unassigned.eventId,gateId:unassigned.gateIds[0],name:'Unauthorized'}}),403,'EVENT_SCOPE_FORBIDDEN');
  ok(await request(`/v1/reservations/${reservation.id}/cancel`,{session:first,method:'POST'}));
});

scenario('Código firmado funciona offline; captura de hace un minuto y firma alterada se rechazan', async () => {
  const paid = await buy(first,fixture.zoneIds[0]!); const ticket = paid.tickets[0];
  const code = await material(first,ticket.id); const now = Date.now()/1000;
  const context = {eventId:fixture.eventId,zoneIds:fixture.zoneIds}; const keys = {[code.material.keyId]:code.material.issuerPublicKey};
  assert.equal(verifyRotatingCode(code.token,keys,now,context).reason,'valid');
  const future = signRotatingCode(code.material.credential,code.seed,now+60);
  assert.equal(verifyRotatingCode(future,keys,now,context).reason,'expired');
  const screenshot = signRotatingCode(code.material.credential,code.seed,now-60);
  assert.equal(verifyRotatingCode(screenshot,keys,now,context).reason,'expired');
  const malformedSlot = JSON.parse(code.token); malformedSlot.slot=-1;
  assert.equal(verifyRotatingCode(JSON.stringify(malformedSlot),keys,now,context).reason,'invalid_signature');
  const forged = JSON.parse(code.token); forged.credential.payload.ticketId=randomUUID();
  assert.equal(verifyRotatingCode(JSON.stringify(forged),keys,now,context).reason,'invalid_signature');
  assert.equal(verifyRotatingCode(code.token,keys,now,{eventId:fixture.eventId+10000}).reason,'wrong_event');
  assert.equal(verifyRotatingCode(code.token,keys,now,{eventId:fixture.eventId,zoneIds:[fixture.zoneIds[1]!]}).reason,'wrong_zone');
  assert.equal(verifyRotatingCode(code.token,keys,now,{...context,revocations:[{ticketId:ticket.id,version:ticket.version}]}).reason,'revoked');
});

scenario('Transferencia aceptada revoca código anterior y el receptor genera material nuevo', async () => {
  const paid=await buy(first,fixture.zoneIds[0]!); const ticket=paid.tickets[0]; const old=await material(first,ticket.id);
  const device=await scanner(actors.admin,actors.staff,fixture,fixture.gateIds[0]!);
  const cancelled=ok(await request(`/v1/tickets/${ticket.id}/transfers`,{session:first,body:{email:second.user.email}}));
  assert.equal(ok(await request(`/v1/transfers/${cancelled.id}/cancel`,{session:first,method:'POST'})).state,'cancelled');
  assert.equal(ok(await request(`/v1/transfers/${cancelled.id}/cancel`,{session:first,method:'POST'})).state,'cancelled');
  const transfer=ok(await request(`/v1/tickets/${ticket.id}/transfers`,{session:first,body:{email:second.user.email}}));
  assert.equal(transfer.state,'pending');
  failure(await request(`/v1/transfers/${transfer.id}/accept`,{session:actors.attendees[3],method:'POST'}),403,'TRANSFER_FORBIDDEN');
  const accepted=ok(await request(`/v1/transfers/${transfer.id}/accept`,{session:second,method:'POST'})); assert.equal(accepted.state,'accepted');
  const repeated=ok(await request(`/v1/transfers/${transfer.id}/accept`,{session:second,method:'POST'})); assert.equal(repeated.state,'accepted');
  failure(await request(`/v1/tickets/${ticket.id}/credential`,{session:first,body:{holderPublicKey:old.material.credential.payload.holderPublicKey}}),404);
  const delta=ok(await request(`/v1/scanner/revocations?deviceId=${device.deviceId}&cursor=${device.bootstrap.revocationCursor}`,{session:actors.staff}));
  assert.ok(delta.revocations.some((r:any)=>r.ticketId===ticket.id && r.version>=ticket.version));
  assert.equal(verifyRotatingCode(old.token,device.bootstrap.publicKeys,Date.now()/1000,{eventId:fixture.eventId,revocations:delta.revocations}).reason,'revoked');
  const stale=await sync(actors.staff,device,[scanAttempt(device,fixture,ticket,old.token)]); assert.equal(stale.results[0].serverResult,'revoked');
  const next=await material(second,ticket.id); assert.ok(next.material.credential.payload.version>ticket.version);
});

scenario('Dos puertas offline conservan doble ingreso como incidente; reenviar lote no duplica', async () => {
  const paid=await buy(first,fixture.zoneIds[0]!); const ticket=paid.tickets[0]; const code=await material(first,ticket.id);
  // Two unrestricted gates model separate offline doors for the same zone.
  const extraGate=ok(await request(`/v1/admin/events/${fixture.eventId}/gates`,{session:actors.admin,body:{name:`${runId}-extra-door`,zoneId:fixture.zoneIds[0]}}));
  const doorA=await scanner(actors.admin,actors.staff,fixture,fixture.gateIds[0]!);
  const doorB=await scanner(actors.admin,actors.staff,fixture,extraGate.id);
  const attemptA=scanAttempt(doorA,fixture,ticket,code.token); const attemptB=scanAttempt(doorB,fixture,ticket,code.token);
  // Device-local accepted sets are separate; both proofs verify without HTTP.
  for(const door of [doorA,doorB]) assert.equal(verifyRotatingCode(code.token,door.bootstrap.publicKeys,Date.parse(attemptA.scannedAt)/1000,{eventId:fixture.eventId,zoneIds:door.bootstrap.gate.zoneIds}).reason,'valid');
  const firstSync=await sync(actors.staff,doorA,[attemptA]); assert.equal(firstSync.results[0].serverResult,'valid');
  const secondSync=await sync(actors.staff,doorB,[attemptB]); assert.equal(secondSync.results[0].serverResult,'double_ingress');
  const replay=await sync(actors.staff,doorB,[attemptB]); assert.equal(replay.results[0].replayed,true); assert.equal(replay.results[0].serverResult,'double_ingress');
  assert.equal(sql(`SELECT count(*) FROM scanner_admissions WHERE ticket_id=${literal(ticket.id)}`),'1');
  assert.equal(sql(`SELECT count(*) FROM scanner_attempts WHERE ticket_id=${literal(ticket.id)}`),'2');
  assert.equal(sql(`SELECT count(*) FROM scanner_incidents WHERE client_scan_id=${literal(attemptB.clientScanId)} AND type='double_ingress'`),'1');
  const incidents=ok(await request(`/v1/admin/events/${fixture.eventId}/incidents`,{session:actors.organizer}));
  assert.ok(incidents.items.some((i:any)=>i.type==='double_ingress' && i.clientScanId===attemptB.clientScanId));
  const reused=await sync(actors.staff,doorA,[{...attemptA,scannedAt:new Date(Date.parse(attemptA.scannedAt)+1).toISOString()}]); assert.equal(reused.results[0].serverResult,'id_conflict');
  failure(await request(`/v1/tickets/${ticket.id}/refund`,{session:first,key:randomUUID(),body:{reason:'Used ticket'}}),409,'TICKET_USED');
  failure(await request(`/v1/tickets/${ticket.id}/transfers`,{session:first,body:{email:second.user.email}}),409,'TRANSFER_NOT_ALLOWED');
});

scenario('Servidor rechaza QR expirado o alterado en lotes sin crear admisión', async () => {
  const paid=await buy(first,fixture.zoneIds[0]!); const ticket=paid.tickets[0]; const code=await material(first,ticket.id);
  const door=await scanner(actors.admin,actors.staff,fixture,fixture.gateIds[0]!);
  const oldToken=signRotatingCode(code.material.credential,code.seed,Date.now()/1000-60);
  const old=scanAttempt(door,fixture,ticket,oldToken);
  const forged=JSON.parse(code.token); forged.proofSignature='0'.repeat(128);
  const fake=scanAttempt(door,fixture,ticket,JSON.stringify(forged));
  const result=await sync(actors.staff,door,[old,fake]); assert.deepEqual(result.results.map((r:any)=>r.serverResult),['expired','invalid_signature']);
  assert.equal(sql(`SELECT count(*) FROM scanner_admissions WHERE ticket_id=${literal(ticket.id)}`),'0');
});

scenario('Reembolso idempotente libera cupo, revoca credencial y registra motivo/autor', async () => {
  const paid=await buy(first,fixture.zoneIds[0]!); const ticket=paid.tickets[0]; const code=await material(first,ticket.id);
  const key=randomUUID(); const body={reason:`${runId}-refund`};
  const refunds=(await Promise.all(Array.from({length:4},()=>request(`/v1/tickets/${ticket.id}/refund`,{session:first,key,body})))).map(ok);
  assert.ok(refunds.every(r=>r.state==='refunded' && r.amountCents===12345));
  assert.equal(sql(`SELECT count(*) FROM payment_ledger WHERE ticket_id=${literal(ticket.id)} AND kind='refund'`),'1');
  assert.equal(sql(`SELECT count(*) FROM revocations WHERE ticket_id=${literal(ticket.id)}`),'1');
  assert.equal(sql(`SELECT count(*) FROM audit_log WHERE resource=${literal(ticket.id)} AND actor_id=${literal(first.user.id)} AND reason=${literal(body.reason)} AND action='ticket.refund'`),'1');
  failure(await request(`/v1/tickets/${ticket.id}/credential`,{session:first,body:{holderPublicKey:code.material.credential.payload.holderPublicKey}}),409,'TICKET_NOT_VALID');
  assert.equal(sql(`SELECT count(*) FROM zones WHERE sold_count+reserved_count>capacity OR reserved_count<0 OR sold_count<0`),'0');
});

scenario('Auditoría y evidencia de accesos no son editables por el rol de aplicación', async () => {
  assert.equal(sql("SELECT has_table_privilege('hypernova_app','audit_log','UPDATE')||','||has_table_privilege('hypernova_app','audit_log','DELETE')||','||has_table_privilege('hypernova_app','scanner_attempts','DELETE')"),'false,false,false');
  let blocked=false;
  try { sql(`BEGIN; SET LOCAL ROLE hypernova_app; UPDATE audit_log SET reason='changed' WHERE resource=${literal(String(fixture.eventId))}; ROLLBACK;`); }
  catch(error) { blocked=String((error as any).stderr).includes('permission denied'); }
  assert.equal(blocked,true,'actual mutation must be rejected by PostgreSQL');
  assert.equal(sql(`SELECT count(*) FROM audit_log WHERE resource=${literal(String(fixture.eventId))} AND action='event.create'`),'1');
});

scenario('Worker expira reservas sin tráfico de compra y recupera inventario una sola vez', async () => {
  const isolated=await createFixture(actors.admin,actors.organizer.user.id,{capacity:1,label:'worker-expiry'});
  const hold=await reserve(second,isolated.zoneIds[0]!);
  sql(`UPDATE reservations SET expires_at=now()-interval '1 second' WHERE id=${literal(hold.id)}`);
  const deadline=Date.now()+10000;
  while(Date.now()<deadline && sql(`SELECT state FROM reservations WHERE id=${literal(hold.id)}`)==='active') await new Promise(resolve=>setTimeout(resolve,350));
  assert.equal(sql(`SELECT state FROM reservations WHERE id=${literal(hold.id)}`),'expired');
  assert.equal(sql(`SELECT sold_count||','||reserved_count FROM zones WHERE id=${isolated.zoneIds[0]}`),'0,0');
  assert.equal(sql(`SELECT reserved_count FROM account_inventory WHERE user_id=${literal(second.user.id)} AND event_id=${isolated.eventId}`),'0');
});

scenario('Carrera reembolso/ingreso nunca admite una entrada reembolsada ni reembolsa una usada', async () => {
  const door=await scanner(actors.admin,actors.staff,fixture,fixture.gateIds[0]!);
  for(let i=0;i<3;i++){
    const paid=await buy(first,fixture.zoneIds[0]!); const ticket=paid.tickets[0]; const code=await material(first,ticket.id);
    const [refunded, scanned]=await Promise.all([
      request(`/v1/tickets/${ticket.id}/refund`,{session:first,key:randomUUID(),body:{reason:`${runId}-race-${i}`}}),
      sync(actors.staff,door,[scanAttempt(door,fixture,ticket,code.token)]),
    ]);
    const state=sql(`SELECT state FROM tickets WHERE id=${literal(ticket.id)}`);
    if(refunded.status===201){
      assert.equal(state,'refunded'); assert.equal(scanned.results[0].serverResult,'revoked');
      assert.equal(sql(`SELECT count(*) FROM scanner_admissions WHERE ticket_id=${literal(ticket.id)}`),'0');
    }else{
      failure(refunded,409,'TICKET_USED'); assert.equal(state,'used'); assert.equal(scanned.results[0].serverResult,'valid');
      assert.equal(sql(`SELECT count(*) FROM payment_ledger WHERE ticket_id=${literal(ticket.id)} AND kind='refund'`),'0');
    }
  }
});

scenario('Precio queda congelado al reservar aunque cambie la fase antes de pagar', async () => {
  const isolated=await createFixture(actors.admin,actors.organizer.user.id,{label:'price-snapshot'});
  const hold=await reserve(second,isolated.zoneIds[0]!);
  sql(`UPDATE price_phases SET price_cents=54321 WHERE zone_id=${isolated.zoneIds[0]}`);
  const payment=ok(await request(`/v1/reservations/${hold.id}/pay`,{session:second,key:randomUUID(),method:'POST',body:{amountCents:7}}));
  assert.equal(payment.amountCents,12345);
  assert.equal(ok(await request(`/v1/events/${isolated.eventId}`)).zones[0].priceCents,54321);
});

scenario('Restricción de PostgreSQL bloquea sobreaforo aun ante escritura directa incorrecta', async () => {
  let rejected=false;
  try { sql(`UPDATE zones SET reserved_count=capacity+1 WHERE id=${fixture.zoneIds[0]}`); }
  catch(error) { rejected=String((error as any).stderr).includes('violates check constraint'); }
  assert.equal(rejected,true,'capacity CHECK must reject invalid inventory');
  assert.equal(sql(`SELECT count(*) FROM zones WHERE id=${fixture.zoneIds[0]} AND sold_count+reserved_count>capacity`),'0');
});

scenario('Pago bloqueado por otra transacción cruza vencimiento: reembolsa sin emitir', async () => {
  const isolated=await createFixture(actors.admin,actors.organizer.user.id,{capacity:1,label:'blocked-late-pay'});
  const hold=await reserve(second,isolated.zoneIds[0]!);
  const query=`BEGIN; SELECT id FROM zones WHERE id=${isolated.zoneIds[0]} FOR UPDATE; UPDATE reservations SET expires_at=clock_timestamp()+interval '1 second' WHERE id=${literal(hold.id)}; SELECT 'qa-lock-held'; SELECT pg_sleep(2); COMMIT;`;
  const child=spawn('docker',['compose','exec','-T','postgres','psql','-X','-v','ON_ERROR_STOP=1','-U','hypernova_owner','-d','hypernova','-At'],{stdio:['pipe','pipe','pipe']});
  child.stdin.end(query.replace(/; /g,';\n')+'\n');
  let output='';
  let signalHeld:()=>void=()=>{};
  const held=new Promise<void>(resolve=>{signalHeld=resolve;});
  child.stdout.on('data',chunk=>{output+=chunk.toString();if(output.includes('qa-lock-held'))signalHeld();});
  const ended=new Promise<void>((resolve,reject)=>{
    child.on('error',()=>reject(new Error('Could not start PostgreSQL blocker')));
    child.on('exit',code=>code===0?resolve():reject(new Error(`PostgreSQL blocker exited ${code}`)));
  });
  await Promise.race([held,ended.then(()=>{throw new Error('Blocker finished without acquiring lock');})]);
  // The API starts its payment transaction while the hold is still active.
  const paying=request(`/v1/reservations/${hold.id}/pay`,{session:second,key:randomUUID(),method:'POST'});
  await ended;
  const result=ok(await paying);
  assert.equal(result.state,'late_refunded'); assert.deepEqual(result.tickets,[]);
  assert.equal(sql(`SELECT count(*) FROM tickets WHERE zone_id=${isolated.zoneIds[0]}`),'0');
  assert.equal(sql(`SELECT sold_count||','||reserved_count FROM zones WHERE id=${isolated.zoneIds[0]}`),'0,0');
});
