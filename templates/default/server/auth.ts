import { createHmac, timingSafeEqual } from "node:crypto";
import * as z from "zod";

import { env } from "./env";

/**
 * Demo identity: a server-signed cookie, re-derived on every request.
 *
 * This file is the ONLY authority on who the caller is. Role claims in request
 * bodies, tool-call inputs and chat messages are never read — the browser
 * reads the resolved session to shape its UI, it never asserts one.
 *
 * Replace this module with your real provider (better-auth, Auth.js, an
 * upstream proxy header) and everything else keeps working: the rest of the
 * app consumes only `SessionUser` and `sessionFromRequest`.
 */

export const SESSION_COOKIE = "dpas_session";

export const RoleSchema = z.enum(["analyst", "controller"]);
export type Role = z.infer<typeof RoleSchema>;

const SessionSchema = z.object({
  email: z.string(),
  name: z.string(),
  role: RoleSchema,
});

export type SessionUser = z.infer<typeof SessionSchema>;

export const DEMO_USERS: Record<Role, SessionUser> = {
  controller: { email: "carla@example.com", name: "Carla Controller", role: "controller" },
  analyst: { email: "ada@example.com", name: "Ada Analyst", role: "analyst" },
};

function sign(payload: string): string {
  return createHmac("sha256", env.AUTH_SECRET).update(payload).digest("base64url");
}

export function encodeSessionCookie(user: SessionUser): string {
  const payload = Buffer.from(JSON.stringify(user), "utf8").toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function decodeSessionCookie(value: string | undefined): SessionUser | null {
  if (!value) return null;
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return null;
  const expected = sign(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  // Length check first: timingSafeEqual throws on a mismatch rather than
  // returning false, and a thrown auth check is a 500 where a 401 belongs.
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    return SessionSchema.parse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
  } catch {
    return null;
  }
}

/**
 * Cookie header → session. A missing or invalid cookie falls back to the
 * controller demo user, so a freshly generated app works on first load with no
 * sign-in step at all.
 */
export function sessionFromRequest(request: Request): SessionUser {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.split(/;\s*/).find((part) => part.startsWith(`${SESSION_COOKIE}=`));
  return decodeSessionCookie(match?.slice(SESSION_COOKIE.length + 1)) ?? DEMO_USERS.controller;
}
