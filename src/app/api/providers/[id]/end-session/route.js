import { NextResponse } from "next/server";
import { getProviderConnectionById, updateProviderConnection } from "@/lib/localDb";
import { endSession } from "open-sse/executors/freebuff.js";
import { buildClearModelLocksUpdate } from "open-sse/services/accountFallback.js";

// POST /api/providers/[id]/end-session — force-end Freebuff session (DELETE upstream)
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const conn = await getProviderConnectionById(id);
    if (!conn) return NextResponse.json({ error: "Connection not found" }, { status: 404 });

    const token = conn.accessToken;
    if (!token) return NextResponse.json({ error: "No access token on this connection" }, { status: 400 });

    const relayUrl = conn.providerSpecificData?.vercelRelayUrl || null;

    // endSession reads the live instance id, then DELETEs with
    // `x-freebuff-instance-id` (upstream 400s with instance_required without it).
    let result;
    try {
      result = await endSession(token, relayUrl ? { vercelRelayUrl: relayUrl } : null);
    } catch (error) {
      return NextResponse.json(
        { error: `Upstream end-session failed: ${error.status || 502} ${error.message}` },
        { status: 502 }
      );
    }

    // Clear all modelLock_* fields so local cooldown UI/db no longer blocks
    const cleared = buildClearModelLocksUpdate(conn);
    if (Object.keys(cleared).length > 0) {
      await updateProviderConnection(id, cleared);
    }

    return NextResponse.json({ ok: true, upstream: result });
  } catch (error) {
    console.log("Error ending freebuff session:", error);
    return NextResponse.json({ error: "End session failed" }, { status: 500 });
  }
}
