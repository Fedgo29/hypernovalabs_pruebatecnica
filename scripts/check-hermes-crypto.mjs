import { build } from 'esbuild';
import { transformAsync } from '@babel/core';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const compiler = join(root, 'node_modules/react-native/sdks/hermesc/linux64-bin/hermesc');
const temporary = mkdtempSync(join(tmpdir(), 'hypernova-hermes-crypto-'));
const report = {
  checkedAt: new Date().toISOString(),
  reactNativeVersion: JSON.parse(readFileSync(join(root, 'node_modules/react-native/package.json'), 'utf8')).version,
  browserBundle: false,
  hermesBytecodeCompilation: false,
  hermesRuntimeExecution: false,
  nativeCameraSecureStoreSQLite: 'not_tested',
  status: 'not_tested',
};
try {
  // Ephemeral fixtures exist only in a private temporary bundle and are removed afterwards.
  const issuer = randomBytes(32).toString('hex');
  const holder = randomBytes(32).toString('hex');
  const source = `import { publicKeyFromSeed,signCredential,signRotatingCode,verifyRotatingCode } from './packages/contracts/src/index';
    const issuer=${JSON.stringify(issuer)},holder=${JSON.stringify(holder)};
    const now=1800000010,keys={'issuer':publicKeyFromSeed(issuer)};
    const credential=signCredential({v:1,kid:'issuer',ticketId:'ticket',eventId:1,zoneId:2,version:1,
      holderPublicKey:publicKeyFromSeed(holder),notBefore:now-60,expiresAt:now+3600},issuer);
    const raw=signRotatingCode(credential,holder,now);
    if(!verifyRotatingCode(raw,keys,now,{eventId:1,zoneIds:[2]}).valid)throw Error('Valid possession rejected');
    if(verifyRotatingCode(raw,keys,now+60,{eventId:1}).reason!=='expired')throw Error('Old screenshot accepted');
    if(verifyRotatingCode(raw,keys,now,{eventId:1,revocations:[{ticketId:'ticket',version:1}]}).reason!=='revoked')throw Error('Revocation ignored');
    const tampered=JSON.parse(raw);tampered.credential.payload.zoneId=9;
    if(verifyRotatingCode(JSON.stringify(tampered),keys,now,{eventId:1}).valid)throw Error('Tampering accepted');
    print('HYPERNOVA_HERMES_CRYPTO_PASS');`;
  const bundled = await build({ stdin: { contents: source, resolveDir: root, sourcefile: 'hermes-crypto-check.ts', loader: 'ts' },
    bundle: true, write: false, platform: 'browser', target: 'es2020', format: 'iife', logLevel: 'silent' });
  // Hermes expects the same class transforms used by the Expo/Metro native pipeline.
  const transformed = await transformAsync(bundled.outputFiles[0].text, {
    configFile: false, babelrc: false, filename: join(root, 'apps/mobile/hermes-crypto-check.js'),
    presets: ['babel-preset-expo'], caller: { name: 'metro', platform: 'android', isDev: false },
  });
  if (!transformed?.code) throw new Error('Expo Babel did not produce code');
  const nativeBundle = await build({ stdin: { contents: transformed.code, resolveDir: root, loader: 'js' }, bundle: true,
    write: false, platform: 'browser', target: 'es2020', format: 'iife', logLevel: 'silent' });
  const script = join(temporary, 'crypto.js');
  writeFileSync(script, nativeBundle.outputFiles[0].contents, { mode: 0o600 });
  report.browserBundle = true;
  execFileSync(compiler, ['-emit-binary', '-out', join(temporary, 'crypto.hbc'), script], { encoding: 'utf8', timeout: 60000, stdio: 'pipe' });
  report.hermesBytecodeCompilation = true;
  const runtime = process.env.HERMES_RUNTIME ?? join(dirname(compiler), 'hermes');
  if (existsSync(runtime)) {
    const result = execFileSync(runtime, ['-exec', script], { encoding: 'utf8', timeout: 60000, stdio: 'pipe' });
    if (!result.includes('HYPERNOVA_HERMES_CRYPTO_PASS')) throw new Error('Hermes did not report successful runtime verification');
    report.hermesRuntimeExecution = true;
    report.status = 'runtime_passed';
  } else {
    report.status = 'runtime_unavailable';
    report.reason = 'The React Native SDK ships hermesc as a compiler-only binary; it explicitly rejects -exec. Set HERMES_RUNTIME to a matching Hermes runtime to execute this check.';
    process.exitCode = 2;
  }
} catch (error) {
  report.status = 'failed';
  const compilerError = typeof error?.stderr === 'string' ? error.stderr.split('\n').find((line) => /error|fatal/i.test(line)) : undefined;
  report.reason = compilerError ?? (error instanceof Error ? error.message.split('\n')[0] : 'Validation failed');
  process.exitCode = 1;
} finally {
  rmSync(temporary, { recursive: true, force: true });
  mkdirSync(join(root, 'docs/qa'), { recursive: true });
  writeFileSync(join(root, 'docs/qa/hermes-crypto.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}
