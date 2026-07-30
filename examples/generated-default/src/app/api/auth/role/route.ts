import { NextResponse } from "next/server";
import { z } from "zod";
import {
  DEMO_USERS,
  RoleSchema,
  SESSION_COOKIE,
  encodeSessionCookie,
  permissionsFor,
} from "@/server/auth/session";

const BodySchema = z.object({ role: RoleSchema });

/**
 * Development role switcher (ADR-0007). The server signs a fresh session
 * cookie — the browser never asserts a role directly, and tool-call bodies
 * are never consulted for identity.
 */
export async function POST(request: Request) {
  const body = BodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ error: "Invalid role." }, { status: 400 });
  }
  const session = DEMO_USERS[body.data.role];
  const response = NextResponse.json({
    userId: session.userId,
    name: session.name,
    role: session.role,
    permissions: permissionsFor(session),
  });
  response.cookies.set(SESSION_COOKIE, encodeSessionCookie(session), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}
