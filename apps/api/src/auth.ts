import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Inject,
  Injectable,
  Module,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import type { PoolClient } from "pg";
import { Db } from "./db";
import { secrets } from "./runtime";
import {
  AuthGuard,
  AuthRequest,
  TOKEN_AUDIENCE,
  TOKEN_ISSUER,
  UserRole,
} from "./auth.guard";

const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const ACCESS_SECONDS = 15 * 60;
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  role: UserRole;
  name: string;
  active: boolean;
}

interface SessionRow {
  id: string;
  user_id: string;
  refresh_hash: string;
  family_id: string;
  expires_at: Date;
  revoked_at: Date | null;
}

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; role: UserRole; name: string };
}

function derivePassword(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      64,
      {
        N: SCRYPT_N,
        r: SCRYPT_R,
        p: SCRYPT_P,
        maxmem: 64 * 1024 * 1024,
      },
      (error, key) => {
        if (error) reject(error);
        else resolve(key);
      },
    );
  });
}

/** Shared with the seed: only a salted, memory-hard verifier is persisted. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(24);
  const key = await derivePassword(password, salt);
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(
  password: string,
  encoded: string,
): Promise<boolean> {
  const parts = encoded.split("$");
  if (
    parts.length !== 6 ||
    parts[0] !== "scrypt" ||
    parts[1] !== String(SCRYPT_N) ||
    parts[2] !== String(SCRYPT_R) ||
    parts[3] !== String(SCRYPT_P)
  )
    return false;
  const salt = Buffer.from(parts[4] ?? "", "base64url");
  const expected = Buffer.from(parts[5] ?? "", "base64url");
  if (salt.length !== 24 || expected.length !== 64) return false;
  const actual = await derivePassword(password, salt);
  return timingSafeEqual(expected, actual);
}

function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException({
      code: "VALIDATION_ERROR",
      message: "Se espera un objeto JSON.",
    });
  }
  return value as Record<string, unknown>;
}

function textField(
  body: Record<string, unknown>,
  field: string,
  min: number,
  max: number,
  trim = true,
): string {
  const raw = body[field];
  const value = typeof raw === "string" ? (trim ? raw.trim() : raw) : "";
  if (value.length < min || value.length > max) {
    throw new BadRequestException({
      code: "VALIDATION_ERROR",
      message: `${field} debe tener entre ${min} y ${max} caracteres.`,
    });
  }
  return value;
}

function emailField(body: Record<string, unknown>): string {
  const email = textField(body, "email", 3, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new BadRequestException({
      code: "VALIDATION_ERROR",
      message: "El correo no es válido.",
    });
  }
  return email;
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function refreshId(token: string): string {
  const parts = token.split(".");
  if (
    parts.length !== 2 ||
    !UUID.test(parts[0] ?? "") ||
    !/^[A-Za-z0-9_-]{64}$/.test(parts[1] ?? "")
  ) {
    throw new UnauthorizedException({
      code: "AUTH_INVALID_REFRESH",
      message: "La sesión es inválida o expiró.",
    });
  }
  return parts[0]!;
}

function hashMatches(token: string, hash: string): boolean {
  const actual = Buffer.from(tokenHash(token), "hex");
  const expected = Buffer.from(hash, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function invalidRefresh(): UnauthorizedException {
  return new UnauthorizedException({
    code: "AUTH_INVALID_REFRESH",
    message: "La sesión es inválida o expiró.",
  });
}

@Injectable()
export class AuthService {
  private readonly rates = new Map<
    string,
    { count: number; expires: number }
  >();
  private dummyHash: Promise<string> | undefined;

  constructor(@Inject(Db) private readonly db: Db) {}

  private async lockedSession(
    client: PoolClient,
    id: string,
  ): Promise<SessionRow | undefined> {
    const candidate = await client.query<SessionRow>(
      "SELECT * FROM sessions WHERE id = $1",
      [id],
    );
    const session = candidate.rows[0];
    if (!session) return undefined;
    // Lock the family before individual rows: simultaneous replay/logout on
    // different historical tokens cannot deadlock while revoking the family.
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('auth-family:' || $1::text, 0))",
      [session.family_id],
    );
    const locked = await client.query<SessionRow>(
      "SELECT * FROM sessions WHERE id = $1 FOR UPDATE",
      [id],
    );
    return locked.rows[0];
  }

  limit(request: AuthRequest, route: string): void {
    const limits: Record<string, number> = {
      register: 10,
      login: 300,
      refresh: 120,
      logout: 60,
    };
    const now = Date.now();
    const ip = request.ip || request.socket?.remoteAddress || "unknown";
    const key = `${route}:${ip}`;
    if (this.rates.size > 10000) {
      for (const [candidate, value] of this.rates) {
        if (value.expires <= now) this.rates.delete(candidate);
      }
    }
    let entry = this.rates.get(key);
    if (!entry || entry.expires <= now) {
      entry = { count: 0, expires: now + 60000 };
      this.rates.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > (limits[route] ?? 20)) {
      throw new HttpException(
        {
          code: "AUTH_RATE_LIMITED",
          message: "Demasiados intentos. Intenta de nuevo en un minuto.",
          retryAfterSeconds: Math.max(
            1,
            Math.ceil((entry.expires - now) / 1000),
          ),
        },
        429,
      );
    }
  }

  private async issueSession(
    client: PoolClient,
    user: UserRow,
    familyId?: string,
    expiry?: Date,
  ): Promise<AuthResult> {
    const sessionId = randomUUID();
    const refreshToken = `${sessionId}.${randomBytes(48).toString("base64url")}`;
    const expiresAt = expiry ?? new Date(Date.now() + SESSION_SECONDS * 1000);
    await client.query(
      `INSERT INTO sessions (id, user_id, refresh_hash, expires_at, family_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        sessionId,
        user.id,
        tokenHash(refreshToken),
        expiresAt,
        familyId ?? randomUUID(),
      ],
    );
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(
      JSON.stringify({ alg: "HS256", typ: "JWT" }),
    ).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({
        sub: user.id,
        sid: sessionId,
        iss: TOKEN_ISSUER,
        aud: TOKEN_AUDIENCE,
        iat: now,
        exp: Math.min(
          now + ACCESS_SECONDS,
          Math.floor(expiresAt.getTime() / 1000),
        ),
      }),
    ).toString("base64url");
    const signature = createHmac("sha256", secrets().jwtSecret)
      .update(`${header}.${payload}`)
      .digest("base64url");
    return {
      accessToken: `${header}.${payload}.${signature}`,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
      },
    };
  }

  async register(value: unknown): Promise<AuthResult> {
    const body = objectBody(value);
    const email = emailField(body);
    const name = textField(body, "name", 2, 100);
    const password = textField(body, "password", 10, 128, false);
    const passwordHash = await hashPassword(password);
    try {
      return await this.db.tx(async (client) => {
        const result = await client.query<UserRow>(
          `INSERT INTO users (id, email, password_hash, role, name)
           VALUES ($1, $2, $3, 'asistente', $4) RETURNING *`,
          [randomUUID(), email, passwordHash, name],
        );
        return this.issueSession(client, result.rows[0]!);
      });
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new ConflictException({
          code: "EMAIL_EXISTS",
          message: "El correo ya está registrado.",
        });
      }
      throw error;
    }
  }

  async login(value: unknown): Promise<AuthResult> {
    const body = objectBody(value);
    const email = emailField(body);
    const password = textField(body, "password", 1, 128, false);
    const result = await this.db.query<UserRow>(
      "SELECT * FROM users WHERE email = $1",
      [email],
    );
    const user = result.rows[0];
    // Unknown emails still perform scrypt, reducing an account-enumeration signal.
    if (!this.dummyHash)
      this.dummyHash = hashPassword(randomBytes(32).toString("base64url"));
    const valid = await verifyPassword(
      password,
      user?.password_hash ?? (await this.dummyHash),
    );
    if (!user || !user.active || !valid) {
      throw new UnauthorizedException({
        code: "AUTH_INVALID_CREDENTIALS",
        message: "Correo o contraseña incorrectos.",
      });
    }
    return this.db.tx((client) => this.issueSession(client, user));
  }

  async refresh(value: unknown): Promise<AuthResult> {
    const body = objectBody(value);
    const token = textField(body, "refreshToken", 1, 512, false);
    const id = refreshId(token);
    // Revocations must COMMIT before throwing. Throwing in tx would roll them back.
    const outcome = await this.db.tx(
      async (client): Promise<AuthResult | null> => {
        const session = await this.lockedSession(client, id);
        if (!session || !hashMatches(token, session.refresh_hash)) return null;
        if (session.revoked_at) {
          await client.query(
            "UPDATE sessions SET revoked_at = COALESCE(revoked_at, clock_timestamp()) WHERE family_id = $1",
            [session.family_id],
          );
          return null;
        }
        if (session.expires_at.getTime() <= Date.now()) {
          await client.query(
            "UPDATE sessions SET revoked_at = clock_timestamp() WHERE id = $1",
            [id],
          );
          return null;
        }
        const users = await client.query<UserRow>(
          "SELECT * FROM users WHERE id = $1",
          [session.user_id],
        );
        const user = users.rows[0];
        if (!user || !user.active) return null;
        await client.query(
          "UPDATE sessions SET revoked_at = clock_timestamp() WHERE id = $1",
          [id],
        );
        return this.issueSession(
          client,
          user,
          session.family_id,
          session.expires_at,
        );
      },
    );
    if (!outcome) throw invalidRefresh();
    return outcome;
  }

  async logout(value: unknown): Promise<{ ok: true }> {
    const body = objectBody(value);
    const token = textField(body, "refreshToken", 1, 512, false);
    const id = refreshId(token);
    await this.db.tx(async (client) => {
      const session = await this.lockedSession(client, id);
      if (session && hashMatches(token, session.refresh_hash)) {
        await client.query(
          "UPDATE sessions SET revoked_at = COALESCE(revoked_at, clock_timestamp()) WHERE family_id = $1",
          [session.family_id],
        );
      }
    });
    return { ok: true };
  }
}

@Controller("v1/auth")
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Post("register")
  register(
    @Body() body: unknown,
    @Req() request: AuthRequest,
  ): Promise<AuthResult> {
    this.auth.limit(request, "register");
    return this.auth.register(body);
  }

  @Post("login")
  @HttpCode(200)
  login(
    @Body() body: unknown,
    @Req() request: AuthRequest,
  ): Promise<AuthResult> {
    this.auth.limit(request, "login");
    return this.auth.login(body);
  }

  @Post("refresh")
  @HttpCode(200)
  refresh(
    @Body() body: unknown,
    @Req() request: AuthRequest,
  ): Promise<AuthResult> {
    this.auth.limit(request, "refresh");
    return this.auth.refresh(body);
  }

  @Post("logout")
  @HttpCode(200)
  logout(
    @Body() body: unknown,
    @Req() request: AuthRequest,
  ): Promise<{ ok: true }> {
    this.auth.limit(request, "logout");
    return this.auth.logout(body);
  }

  @Get("me")
  @UseGuards(AuthGuard)
  me(@Req() request: AuthRequest): AuthResult["user"] {
    const user = request.user!;
    return { id: user.id, email: user.email, role: user.role, name: user.name };
  }
}

@Module({
  controllers: [AuthController],
  providers: [AuthService, AuthGuard],
  exports: [AuthService, AuthGuard],
})
export class AuthModule {}
