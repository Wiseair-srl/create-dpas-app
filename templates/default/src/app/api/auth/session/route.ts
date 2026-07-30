import { NextResponse } from "next/server";
import { permissionsFor, resolveSession } from "@/server/auth/session";

/** The browser's only read of identity: the server-resolved session. */
export async function GET(request: Request) {
  const session = resolveSession(request.headers.get("cookie"));
  return NextResponse.json({
    userId: session.userId,
    name: session.name,
    role: session.role,
    permissions: permissionsFor(session),
  });
}
