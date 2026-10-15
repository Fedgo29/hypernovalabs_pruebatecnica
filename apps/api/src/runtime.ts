import {
  randomBytes,
  generateKeyPairSync,
  createPrivateKey,
  createPublicKey,
} from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  chmodSync,
} from "node:fs";
import { join } from "node:path";

export interface RuntimeSecrets {
  jwtSecret: string;
  issuerPrivateKey: string;
  issuerPublicKey: string;
  demoPassword: string;
}
let cached: RuntimeSecrets | undefined;
export function secrets(): RuntimeSecrets {
  if (cached) return cached;
  const directory = process.env.RUNTIME_DIR ?? "/tmp/hypernova-runtime";
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, "secrets.json");
  const existing = existsSync(path)
    ? (JSON.parse(readFileSync(path, "utf8")) as Partial<RuntimeSecrets>)
    : {};
  let issuerPrivateKey =
    process.env.ISSUER_PRIVATE_KEY ?? existing.issuerPrivateKey;
  if (!issuerPrivateKey)
    issuerPrivateKey = generateKeyPairSync("ed25519")
      .privateKey.export({ format: "pem", type: "pkcs8" })
      .toString();
  if (/^[a-f0-9]{64}$/i.test(issuerPrivateKey))
    issuerPrivateKey = createPrivateKey({
      key: Buffer.from(
        `302e020100300506032b657004220420${issuerPrivateKey}`,
        "hex",
      ),
      format: "der",
      type: "pkcs8",
    })
      .export({ format: "pem", type: "pkcs8" })
      .toString();
  const issuerPublicKey = createPublicKey(createPrivateKey(issuerPrivateKey))
    .export({ format: "pem", type: "spki" })
    .toString();
  const jwtSecret =
    process.env.JWT_SECRET ??
    existing.jwtSecret ??
    randomBytes(48).toString("base64url");
  if (jwtSecret.length < 32)
    throw new Error("JWT_SECRET must contain at least 32 characters");
  cached = {
    jwtSecret,
    issuerPrivateKey,
    issuerPublicKey,
    demoPassword:
      process.env.DEMO_PASSWORD ??
      existing.demoPassword ??
      randomBytes(18).toString("base64url"),
  };
  writeFileSync(path, JSON.stringify(cached), { mode: 0o600 });
  chmodSync(path, 0o600);
  writeFileSync(
    join(directory, "demo-credentials.json"),
    JSON.stringify(
      {
        password: cached.demoPassword,
        source: "runtime-generated; see seed accounts in README",
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  return cached;
}
