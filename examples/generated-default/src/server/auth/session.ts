import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/**
 * Demo identity (ADR-0007). A signed cookie carries the demo user; the server
 * re-derives the session on every request. Role claims in request bodies or
 * tool-call inputs are never read — this file is the only authority.
 *
 * Replace this module with your real auth provider; everything else consumes
 * only the `Session` type via `resolveSession`.
 */

export const SESSION_COOKIE = "dpas_session";

export const RoleSchema = z.enum(["viewer", "operator"]);
export type Role = z.infer<typeof RoleSchema>;

const SessionPayloadSchema = z.object({
  userId: z.string(),
  name: z.string(),
  role: RoleSchema,
});
export type Session = z.infer<typeof SessionPayloadSchema>;

export const DEMO_USERS: Record<Role, Session> = {
  operator: { userId: "u-operator", name: "Olivia Operator", role: "operator" },
  viewer: { userId: "u-viewer", name: "Vik Viewer", role: "viewer" },
};

function secret(): string {
  return process.env.AUTH_SECRET ?? "dpas-dev-secret-change-me";
}

function sign(data: string): string {
  return createHmac("sha256", secret()).update(data).digest("base64url");
}

export function encodeSessionCookie(session: Session): string {
  const payload = Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function decodeSessionCookie(value: string | undefined): Session | null {
  if (!value) return null;
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return null;
  const expected = sign(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    return SessionPayloadSchema.parse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
  } catch {
    return null;
  }
}

/**
 * Cookie header → session. A missing or invalid cookie falls back to the
 * operator demo user so a freshly generated app works on first load.
 */
export function resolveSession(cookieHeader: string | null): Session {
  const match = cookieHeader
    ?.split(/;\s*/)
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`));
  const value = match?.slice(SESSION_COOKIE.length + 1);
  return decodeSessionCookie(value) ?? DEMO_USERS.operator;
}

export function permissionsFor(session: Session): string[] {
  return session.role === "operator"
    ? ["devices:read", "devices:disable"]
    : ["devices:read"];
}
