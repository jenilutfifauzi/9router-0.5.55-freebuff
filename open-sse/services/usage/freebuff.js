/**
 * Freebuff usage handler
 *
 * Freebuff has no separate billing/quota API — the quota lives on the session
 * endpoint itself. Reading it MUST use GET /api/v1/freebuff/session (the CLI's
 * status poll): POST would CLAIM a session and spend Freebucks, which a quota
 * tracker must never do.
 *
 * Current shape (Freebucks, since 2026-09) — one shared daily pool per account,
 * priced per model per hour:
 *   freebucks: {
 *     balance,                                  // Freebucks left today
 *     daily: { limit, spent, remaining, resetAt, resetTimeZone },
 *     wallet: { balance, monthlyBonus },        // paid top-up (0 = not used)
 *     planId, prices: { [modelId]: perHour },
 *     priceNotices, offPeak, priceChanges,
 *   }
 * A model the account's tier does not serve comes back as
 * `accessTier: "limited"` + `countryBlockReason` instead of an error, so
 * tier/country belongs in the quota story, not a separate API.
 *
 * Older servers sent `rateLimitsByModel` ({ limit, recentCount, resetAt } per
 * model, daily/weekly Pacific allowance) — that parser is kept as a fallback.
 */

import REGISTRY from "../../providers/registry/index.js";
import { U, fetchWithTimeout } from "./shared.js";

// The Freebucks block only comes back to a current CLI; 0.0.138 is what the
// pre-Freebucks client sent.
const FREEBUFF_CLI_USER_AGENT = "codebuff-cli/0.0.183";

// Friendly labels from the registry model list (mirrors the CLI picker).
const freebuffRegistry = REGISTRY.find((r) => r.id === "freebuff") || {};
const MODEL_LABELS = Object.fromEntries(
  (freebuffRegistry.models || []).map((m) => [m.id, m.name]),
);

function sessionUrl() {
  return U("freebuff").url;
}

/**
 * Freebucks pool → one quota row (spent / daily limit) labelled with the
 * remaining balance: the budget is shared by every model, and each model's
 * hourly price decides what that balance buys.
 */
function freebucksQuotas(freebucks) {
  const daily = freebucks?.daily || {};
  const total = Number(daily.limit);
  if (!Number.isFinite(total) || total <= 0) return null;

  const spent = Number(daily.spent);
  const balance = Number(freebucks?.balance);
  const name = Number.isFinite(balance) ? `Freebucks (sisa ${balance})` : "Freebucks";

  return {
    [name]: {
      used: Number.isFinite(spent) ? spent : 0,
      total,
      resetAt: daily.resetAt || null,
      // Daily pool replenishes at resetAt → UI says "resets in".
      recurring: true,
      unlimited: false,
    },
  };
}

/** Pre-Freebucks rows (rateLimitsByModel + the active session's own row). */
function legacyQuotas(data) {
  const rateLimits = { ...(data.rateLimitsByModel || {}) };
  if (data.status === "active" && data.rateLimit && !rateLimits[data.model]) {
    rateLimits[data.model] = data.rateLimit;
  }

  const quotas = {};
  for (const [model, rl] of Object.entries(rateLimits)) {
    if (!rl || typeof rl !== "object") continue;
    const used = Number(rl.recentCount);
    const total = Number(rl.limit);
    quotas[model] = {
      used: Number.isFinite(used) ? used : 0,
      total: Number.isFinite(total) ? total : 0,
      resetAt: rl.resetAt || null,
      unlimited: false,
      recurring: true,
      ...(MODEL_LABELS[model] ? { displayName: MODEL_LABELS[model] } : {}),
    };
  }
  return quotas;
}

export async function getFreebuffUsage(accessToken, providerSpecificData, proxyOptions = null) {
  if (!accessToken) {
    return { message: "Freebuff credential not available — connect a Freebuff login first." };
  }

  try {
    const response = await fetchWithTimeout(
      sessionUrl(),
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "User-Agent": FREEBUFF_CLI_USER_AGENT,
          Accept: "application/json",
        },
      },
      15000,
      proxyOptions,
    );

    if (response.status === 401) {
      return { message: "Freebuff credential invalid or expired — re-login in the dashboard." };
    }
    if (response.status === 403) {
      // A 403 from the session endpoint is usually a server-side gate status
      // (country_blocked / banned), not a credential problem — telling the
      // user to re-login would be misleading (mirrors the CLI's
      // callFreebuffSession 403 branch).
      const body = await response.json().catch(() => ({}));
      if (body?.status === "country_blocked") {
        return { message: "Freebuff is not available in your region." };
      }
      if (body?.status === "banned") {
        return { message: "Your Freebuff account has been banned." };
      }
      return {
        message: `Freebuff quota access denied (403)${body?.message ? `: ${body.message}` : ""}.`,
      };
    }
    // 404 = no session row at all → pre-join state, no quota to report.
    if (response.status === 404) {
      return { plan: "Freebuff", message: "Freebuff connected. No session quota to report right now." };
    }
    if (!response.ok) {
      return { message: `Freebuff quota API error (${response.status}).` };
    }

    const data = await response.json().catch(() => ({}));
    const quotas = freebucksQuotas(data.freebucks) || legacyQuotas(data);

    const plan = data.accessTier === "limited" ? "Freebuff (Limited)" : "Freebuff";
    if (Object.keys(quotas).length === 0) {
      return { plan, message: "Freebuff connected. No session quota to report right now." };
    }
    return { plan, quotas };
  } catch (error) {
    return { message: `Freebuff usage error: ${error.message}` };
  }
}

export default getFreebuffUsage;
