import { NextResponse } from "next/server";
import { getProviderConnectionById, updateProviderConnection } from "@/lib/localDb";
import { proxyAwareFetch } from "open-sse/utils/proxyFetch.js";
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
    const sessionUrl = "https://www.codebuff.com/api/v1/freebuff/session";

    const response = await proxyAwareFetch(
      sessionUrl,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
          "User-Agent": "codebuff-cli/0.0.138",
          Accept: "application/json",
        },
      },
      relayUrl ? { vercelRelayUrl: relayUrl } : null
    );

    let body = {};
    try { body = await response.json(); } catch { /* non-JSON */ }

    if (response.status !== 200 && response.status !== 404) {
      return NextResponse.json(
        { error: `Upstream end-session failed: ${response.status} ${JSON.stringify(body).slice(0, 200)}` },
        { status: 502 }
      );
    }

    // Clear all modelLock_* fields so local cooldown UI/db no longer blocks
    const cleared = buildClearModelLocksUpdate(conn);
    if (Object.keys(cleared).length > 0) {
      await updateProviderConnection(id, cleared);
    }

    return NextResponse.json({ ok: true, upstream: body });
  } catch (error) {
    console.log("Error ending freebuff session:", error);
    return NextResponse.json({ error: "End session failed" }, { status: 500 });
  }
}
