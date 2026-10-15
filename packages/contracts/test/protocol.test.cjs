const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const protocol = require('../dist');

function fixture() {
  const issuer = randomBytes(32).toString('hex');
  const holder = randomBytes(32).toString('hex');
  const now = 1_800_000_010;
  const payload = { v: 1, kid: 'issuer-1', ticketId: 'ticket-1', eventId: 1, zoneId: 2, version: 1,
    holderPublicKey: protocol.publicKeyFromSeed(holder), notBefore: now - 300, expiresAt: now + 3600 };
  const credential = protocol.signCredential(payload, issuer);
  const keys = { 'issuer-1': protocol.publicKeyFromSeed(issuer) };
  const raw = protocol.signRotatingCode(credential, holder, now);
  return { issuer, holder, now, payload, credential, keys, raw };
}
test('issuer signature and holder possession verify offline', () => {
  const f = fixture();
  assert.equal(protocol.verifyCredential(f.credential, f.keys), true);
  assert.deepEqual(protocol.verifyRotatingCode(f.raw, f.keys, f.now, { eventId: 1, zoneIds: [2] }), { valid: true, reason: 'valid', payload: f.payload });
});
test('one-minute screenshots and future slots are rejected', () => {
  const f = fixture();
  assert.equal(protocol.verifyRotatingCode(f.raw, f.keys, f.now + 60, { eventId: 1 }).reason, 'expired');
  assert.equal(protocol.verifyRotatingCode(f.raw, f.keys, f.now - 30, { eventId: 1 }).reason, 'expired');
  assert.equal(protocol.verifyRotatingCode(f.raw, f.keys, f.now + 15, { eventId: 1 }).valid, true);
});
test('wrong event, wrong zone, and revoked credential are explicit', () => {
  const f = fixture();
  assert.equal(protocol.verifyRotatingCode(f.raw, f.keys, f.now, { eventId: 9 }).reason, 'wrong_event');
  assert.equal(protocol.verifyRotatingCode(f.raw, f.keys, f.now, { eventId: 1, zoneIds: [9] }).reason, 'wrong_zone');
  assert.equal(protocol.verifyRotatingCode(f.raw, f.keys, f.now, { eventId: 1, revocations: [{ ticketId: 'ticket-1', version: 1 }] }).reason, 'revoked');
  assert.equal(protocol.verifyRotatingCode(f.raw, f.keys, f.now, { eventId: 1, revocations: [{ ticketId: 'ticket-1', version: 0 }] }).valid, true);
});
test('credential tampering, untrusted issuer and forged possession fail', () => {
  const f = fixture();
  const code = JSON.parse(f.raw);
  code.credential.payload.zoneId = 8;
  assert.equal(protocol.verifyRotatingCode(JSON.stringify(code), f.keys, f.now, { eventId: 1 }).reason, 'invalid_signature');
  assert.equal(protocol.verifyRotatingCode(f.raw, {}, f.now, { eventId: 1 }).reason, 'invalid_signature');
  code.credential = f.credential;
  code.proofSignature = randomBytes(64).toString('hex');
  assert.equal(protocol.verifyRotatingCode(JSON.stringify(code), f.keys, f.now, { eventId: 1 }).reason, 'invalid_signature');
});
test('noncanonical extra fields, malformed values and oversized tokens fail closed', () => {
  const f = fixture();
  const code = JSON.parse(f.raw);
  code.credential.payload.extra = true;
  assert.equal(protocol.verifyRotatingCode(JSON.stringify(code), f.keys, f.now, { eventId: 1 }).valid, false);
  assert.throws(() => protocol.signCredential({ ...f.payload, extra: true }, f.issuer));
  assert.equal(protocol.parseRotatingCode('{'), null);
  assert.equal(protocol.parseRotatingCode('x'.repeat(9000)), null);
  assert.equal(protocol.verifyRotatingCode(f.raw, f.keys, NaN, { eventId: 1 }).valid, false);
});
test('credential validity dates are enforced and wrong holder cannot sign', () => {
  const f = fixture();
  assert.equal(protocol.verifyRotatingCode(f.raw, f.keys, f.payload.expiresAt, { eventId: 1 }).reason, 'expired');
  assert.throws(() => protocol.signRotatingCode(f.credential, randomBytes(32).toString('hex'), f.now));
});
test('transfer revokes old possession and binds the next version to a new holder', () => {
  const f = fixture();
  const recipient = randomBytes(32).toString('hex');
  const next = protocol.signCredential({ ...f.payload, version: 2, holderPublicKey: protocol.publicKeyFromSeed(recipient) }, f.issuer);
  const transferred = protocol.signRotatingCode(next, recipient, f.now);
  const context = { eventId: 1, revocations: [{ ticketId: f.payload.ticketId, version: 1 }] };
  assert.equal(protocol.verifyRotatingCode(f.raw, f.keys, f.now, context).reason, 'revoked');
  assert.equal(protocol.verifyRotatingCode(transferred, f.keys, f.now, context).valid, true);
  assert.throws(() => protocol.signRotatingCode(next, f.holder, f.now));
});
