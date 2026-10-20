import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db";
import { secretMatches } from "@/lib/auth";
import { today } from "@/lib/dates";
import { toUserMessage } from "@/lib/errors";
import { ingestMessage } from "@/server/domain/messages";

/**
 * POST /api/messages — a bank text from the iPhone Shortcuts automation.
 * Auth is `Authorization: Bearer $INGEST_TOKEN` (no session cookie; the proxy lets it through).
 * Body: JSON `{ text, sender? }`, or the text itself as text/plain.
 */
export async function POST(request: NextRequest) {
  const token = process.env.INGEST_TOKEN;
  if (!token) return NextResponse.json({ error: "INGEST_TOKEN is not set on the server" }, { status: 503 });
  const auth = request.headers.get("authorization") ?? "";
  const given = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!given || !secretMatches(given, token)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const raw = await request.text();
  let text = raw;
  let sender: string | null = null;
  if ((request.headers.get("content-type") ?? "").includes("json")) {
    try {
      const body = JSON.parse(raw) as { text?: unknown; sender?: unknown };
      text = typeof body.text === "string" ? body.text : "";
      sender = typeof body.sender === "string" ? body.sender : null;
    } catch {
      return NextResponse.json({ error: "Body isn't valid JSON" }, { status: 400 });
    }
  }
  if (!text.trim()) return NextResponse.json({ error: "No message text" }, { status: 400 });

  try {
    const res = await ingestMessage(await getDb(), { text, sender, receivedOn: today() });
    if (res.ignored) {
      // Shows in the Vercel logs, to see what name iOS gave a sender that was turned away.
      if (res.reason === "sender") console.info(`Ignored a text from sender ${JSON.stringify(sender)}`);
      return NextResponse.json({ ok: true, ignored: true, reason: res.reason });
    }
    return NextResponse.json({ ok: true, duplicate: res.duplicate, kind: res.parsed.kind });
  } catch (e) {
    const message = toUserMessage(e);
    if (message) return NextResponse.json({ error: message }, { status: 400 });
    console.error(e);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
