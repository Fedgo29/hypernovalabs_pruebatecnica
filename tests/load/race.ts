/** Real HTTP load harness equivalent to the required buyer race: 200 distinct
 * authenticated accounts simultaneously compete for 50 remaining tickets.
 * It creates only an isolated QA event; delivered seed inventory is untouched.
 */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { baseUrl, runId, login, request, ok, createFixture, sql, literal } from '../helpers/runtime';

const buyers = 200;
const remainingTickets = 50;
const report: any = { runId, startedAt: new Date().toISOString(), runtime: 'Node fetch against actual NestJS HTTP API and PostgreSQL Docker Compose', baseUrl, concurrentBuyers: buyers, initialRemainingTickets: remainingTickets, passed: false };
const percentile = (values: number[], quantile: number) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a,b)=>a-b);
  return Math.round(sorted[Math.max(0,Math.ceil(sorted.length*quantile)-1)]!*100)/100;
};
const metrics = (values: number[]) => ({ samples: values.length, p50Ms: percentile(values,.50), p95Ms: percentile(values,.95) });
const reserveTimes: number[] = [], paymentTimes: number[] = [];
let soldOut = 0, unexpected: {stage:string; status?:number; code:string}[] = [], successfulPayments = 0;

async function main(): Promise<void> {
try {
  ok(await request('/v1/readiness'));
  const admin = await login('admin.101@example.test');
  const fixture = await createFixture(admin,'organizador-201',{capacity:remainingTickets,limit:1,label:'200-buyers-50-tickets'});
  report.fixture = {eventId:fixture.eventId,zoneId:fixture.zoneIds[0],initialCapacity:remainingTickets,initialSold:0};
  const emails = sql("SELECT email FROM users WHERE role='asistente' AND active=true ORDER BY id LIMIT 200").split('\n');
  assert.equal(emails.length,buyers);
  // Login is setup, outside measured sale. Sequential authentication avoids
  // benchmarking scrypt instead of purchase inventory concurrency.
  const sessions = [];
  for (const email of emails) sessions.push(await login(email));
  const saleStart = performance.now();
  // Promise.all dispatches all 200 buyer requests without a worker pool limit.
  await Promise.all(sessions.map(async session => {
    try {
      const reservation = await request('/v1/reservations',{session,key:randomUUID(),body:{zoneId:fixture.zoneIds[0],quantity:1,amountCents:1}});
      reserveTimes.push(reservation.durationMs);
      if (reservation.status===409 && reservation.body?.error?.code==='SOLD_OUT') { soldOut++; return; }
      if (reservation.status!==201) { unexpected.push({stage:'reserve',status:reservation.status,code:reservation.body?.error?.code??'UNKNOWN'}); return; }
      assert.equal(reservation.body.amountCents,12345);
      const payment = await request(`/v1/reservations/${reservation.body.id}/pay`,{session,key:randomUUID(),method:'POST',body:{amountCents:1}});
      paymentTimes.push(payment.durationMs);
      if (payment.status!==201 || payment.body.state!=='paid') { unexpected.push({stage:'pay',status:payment.status,code:payment.body?.error?.code??payment.body?.state??'UNKNOWN'}); return; }
      assert.equal(payment.body.amountCents,12345); assert.equal(payment.body.tickets.length,1); successfulPayments++;
    } catch (error) {
      // Token/password/QR response bodies are never persisted.
      unexpected.push({stage:'transport_or_assertion',code:error instanceof Error ? error.name : 'UNKNOWN'});
    }
  }));
  report.saleDurationMs=Math.round((performance.now()-saleStart)*100)/100;
  report.reservation=metrics(reserveTimes); report.payment=metrics(paymentTimes);
  report.expectedSoldOutResponses=soldOut; report.unexpectedErrors=unexpected; report.successfulPayments=successfulPayments;
  report.database=JSON.parse(sql(`SELECT json_build_object('capacity',z.capacity,'sold',z.sold_count,'reserved',z.reserved_count,'available',z.capacity-z.sold_count-z.reserved_count,'tickets',(SELECT count(*) FROM tickets WHERE zone_id=z.id),'charges',(SELECT count(*) FROM payment_ledger l JOIN reservations r ON r.id=l.reservation_id WHERE r.zone_id=z.id AND l.kind='charge'),'activeReservations',(SELECT count(*) FROM reservations WHERE zone_id=z.id AND state='active'),'inventoryViolations',(SELECT count(*) FROM zones WHERE sold_count+reserved_count>capacity OR sold_count<0 OR reserved_count<0)) FROM zones z WHERE z.id=${fixture.zoneIds[0]}`));
  assert.equal(successfulPayments,50,'exactly 50 buyers must pay'); assert.equal(soldOut,150,'remaining buyers receive actionable sold-out errors'); assert.equal(unexpected.length,0,'unexpected HTTP/transport errors must be zero');
  assert.equal(report.database.sold,50); assert.equal(report.database.reserved,0); assert.equal(report.database.available,0); assert.equal(report.database.tickets,50); assert.equal(report.database.charges,50); assert.equal(report.database.activeReservations,0); assert.equal(report.database.inventoryViolations,0);
  const readTimes: number[]=[]; const readStart=performance.now();
  // Read-only burst is separate from the sale and uses bounded concurrency.
  await Promise.all(Array.from({length:50},async()=>{
    for(let i=0;i<10;i++){
      const result=await request(`/v1/events/${fixture.eventId}`); readTimes.push(result.durationMs);
      const detail=ok(result); assert.equal(detail.zones[0].available,0);
    }
  }));
  report.availability={...metrics(readTimes),requests:500,concurrency:50,durationMs:Math.round((performance.now()-readStart)*100)/100};
  report.passed=true;
} catch(error) {
  report.failure=error instanceof Error ? error.message : 'Unknown failure';
  process.exitCode=1;
} finally {
  report.finishedAt=new Date().toISOString();
  mkdirSync('docs/qa',{recursive:true});
  writeFileSync('docs/qa/load-results.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({passed:report.passed,sold:report.database?.sold,soldOut,unexpectedErrors:unexpected.length,reservation:report.reservation,payment:report.payment,report:'docs/qa/load-results.json'}));
}

}
void main();
