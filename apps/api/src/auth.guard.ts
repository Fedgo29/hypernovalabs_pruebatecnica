import { createHmac, timingSafeEqual } from "node:crypto";
import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Db } from "./db";
import { secrets } from "./runtime";

export type UserRole = "asistente" | "staff" | "organizador" | "admin";

export interface Principal {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  sessionId: string;
}

export interface AuthRequest {
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  socket?: { remoteAddress?: string };
  user?: Principal;
}

interface AccessClaims {
  sub: string;
  sid: string;
  iss: string;
  aud: string;
  iat: number;
  exp: number;
}

export const TOKEN_ISSUER = "hypernova";
export const TOKEN_AUDIENCE = "hypernova-clients";

function invalidToken(): UnauthorizedException {
  return new UnauthorizedException({
    code: "AUTH_INVALID_TOKEN",
    message: "La sesión es inválida o expiró.",
  });
}

/** Verifies a fixed algorithm and audience before any claim is trusted. */
function accessClaims(token: string): AccessClaims {
  try {
    if (token.length > 4096) throw invalidToken();
    const parts = token.split(".");
    if (
      parts.length !== 3 ||
      parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))
    ) {
      throw invalidToken();
    }
    const [headerPart, payloadPart, signaturePart] = parts as [
      string,
      string,
      string,
    ];
    const header = JSON.parse(
      Buffer.from(headerPart, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    if (header.alg !== "HS256" || header.typ !== "JWT") throw invalidToken();
    const expected = createHmac("sha256", secrets().jwtSecret)
      .update(`${headerPart}.${payloadPart}`)
      .digest();
    const actual = Buffer.from(signaturePart, "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      throw invalidToken();
    const claims = JSON.parse(
      Buffer.from(payloadPart, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    const now = Math.floor(Date.now() / 1000);
    if (
      typeof claims.sub !== "string" ||
      claims.sub.length < 1 ||
      claims.sub.length > 128 ||
      typeof claims.sid !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        claims.sid,
      ) ||
      claims.iss !== TOKEN_ISSUER ||
      claims.aud !== TOKEN_AUDIENCE ||
      typeof claims.exp !== "number" ||
      !Number.isSafeInteger(claims.exp) ||
      claims.exp <= now ||
      typeof claims.iat !== "number" ||
      !Number.isSafeInteger(claims.iat) ||
      claims.iat > now + 30 ||
      claims.exp <= claims.iat
    )
      throw invalidToken();
    return claims as unknown as AccessClaims;
  } catch {
    throw invalidToken();
  }
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(Db) private readonly db: Db) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const authorization = request.headers.authorization;
    if (
      typeof authorization !== "string" ||
      !authorization.startsWith("Bearer ")
    )
      throw invalidToken();
    const claims = accessClaims(authorization.slice(7));
    // A cryptographically valid token is insufficient after logout/refresh/reuse.
    const result = await this.db.query<{
      id: string;
      email: string;
      name: string;
      role: UserRole;
    }>(
      `SELECT u.id, u.email, u.name, u.role
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.id = $1 AND s.user_id = $2
          AND s.revoked_at IS NULL AND s.expires_at > clock_timestamp()
          AND u.active = true`,
      [claims.sid, claims.sub],
    );
    const user = result.rows[0];
    if (
      !user ||
      !["asistente", "staff", "organizador", "admin"].includes(user.role)
    )
      throw invalidToken();
    request.user = { ...user, sessionId: claims.sid };
    return true;
  }
}
