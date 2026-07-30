import { NextResponse } from "next/server";
import { getAuditLog } from "@/server/audit/log";
import { resolveSession } from "@/server/auth/session";

/**
 * Recent server-side audit records for the Agent Inspector.
 *
 * The chat route streams these as protocol frames during a live turn; the
 * guided demo has no server stream, so the browser pulls them here after a
 * contextual domain call settles. Diagnostics only — the authoritative
 * record is the server-side log itself.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // Reading the audit trail requires a resolved session, like everything else.
  resolveSession(request.headers.get("cookie"));
  const url = new URL(request.url);
  const since = url.searchParams.get("since");
  const entries = getAuditLog().entries();
  const startIndex = since ? entries.findIndex((entry) => entry.id === since) + 1 : 0;
  return NextResponse.json({ entries: entries.slice(Math.max(0, startIndex)).slice(-25) });
}
