/**
 * Freebuff — the free, ad-supported coding agent by Codebuff (freebuff.com).
 *
 * The Freebuff CLI (github.com/CodebuffAI/freebuff) is an interactive TUI that
 * talks to the Codebuff/Freebuff backend. Two hosts are involved:
 *   - login flow (freebuff mode) runs on  https://freebuff.com
 *       POST /api/auth/cli/code {fingerprintId} → { loginUrl, fingerprintHash, expiresAt }
 *       open loginUrl in browser, then GET /api/auth/cli/status until {user}.
 *       (The server echoes the request host into loginUrl, so calling
 *       freebuff.com yields freebuff.com/login?auth_code=… exactly like the
 *       official CLI — www.codebuff.com would yield the wrong link.)
 *   - LLM traffic goes to the OpenAI-compatible endpoint on
 *       https://www.codebuff.com/api/v1/chat/completions
 *     (freebuff.com does NOT serve /api/v1/* — it 404s with the SPA shell.)
 *
 * Both hosts share one backend: the authToken obtained via the freebuff.com
 * login validates against www.codebuff.com (Bearer auth). The request body
 * must carry the CLI's `codebuff` provider block
 * (`codebuff_metadata.run_id/client_id/cost_mode`) — injected by
 * executors/freebuff.js. cost_mode:"free" is what admits a session on the free
 * (country-gated, session-limited) tier instead of billing credits.
 */
export default {
  id: "freebuff",
  priority: 45,
  hasFree: true,
  alias: "fb",
  uiAlias: "fb",
  display: {
    name: "Freebuff",
    icon: "bolt",
    color: "#84CC16",
    textIcon: "FB",
    website: "https://freebuff.com",
    notice: {
      signupUrl: "https://freebuff.com",
      text: "Free ad-supported coding agent by Codebuff. Sign in with your Freebuff/Codebuff account via browser login. Sessions are paid with Freebucks — one shared daily pool per account (25/day, resets ~14:00 WIB) and each model costs Freebucks per hour (GLM 5.3 Flash / Kimi K3 Eco 5, MiMo 2.5 / Solar Pro4 10, DeepSeek V4 Flash 15, Muse Spark 15, GPT-5.6 Luna 20). A session is locked to ONE model for its hour, and an account recently used from a region without full access stays on the limited tier for a while — Luna and the premium models need the full tier.",
    },
  },
  category: "free",
  authType: "oauth",
  authModes: ["oauth"],
  hasOAuth: true,
  transport: {
    baseUrl: "https://www.codebuff.com/api/v1/chat/completions",
    format: "openai",
    headers: {
      "User-Agent": "ai-sdk/openai-compatible/1.0/codebuff",
    },
    retry: {
      429: { attempts: 2, delayMs: 2000 },
      503: { attempts: 2, delayMs: 1500 },
    },
    // Session endpoint doubles as the quota API: GET /api/v1/freebuff/session
    // returns the Freebucks pool (balance / daily limit-spent / resetAt) plus
    // the per-model hourly prices without claiming anything — POST would spend
    // Freebucks, so quota reads are GET only (see services/usage/freebuff.js).
    usage: {
      url: "https://www.codebuff.com/api/v1/freebuff/session",
    },
  },
  features: {
    usage: true,
  },
  // Mirrors the CLI's free picker (FREEBUFF_ROOT_AGENT_ID_BY_MODEL).
  // mimo/mimo-v2.5-pro is intentionally absent — it is not a free-tier model
  // and would bill credits or be rejected under the base2-free agent.
  models: [
    { id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash" },
    { id: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro" },
    { id: "mimo/mimo-v2.5", name: "MiMo 2.5" },
    { id: "mimo/mimo-v2.6-pro", name: "MiMo 2.6 Pro" },
    { id: "minimax/minimax-m3", name: "MiniMax M3" },
    { id: "openai/gpt-5.6-luna", name: "GPT-5.6 Luna" },
    { id: "openai/gpt-5.6-luna-es", name: "GPT-5.6 Luna ES" },
    { id: "upstage/solar-pro4", name: "Upstage Solar Pro 4" },
    { id: "crof/kimi-k3-eco", name: "Kimi K3 Eco" },
    { id: "meta/muse-spark-1.2-contributor", name: "Muse Spark 1.2 Contributor" },
    { id: "meta/muse-spark-1.3-contributor", name: "Muse Spark 1.3 Contributor" },
    { id: "google/gemini-3.8-flash", name: "Gemini 3.8 Flash" },
    { id: "z-ai/glm-5.3-flash", name: "GLM 5.3 Flash" },
  ],
  // Login-flow host — the CLI in freebuff mode logs in via freebuff.com, and
  // the server builds loginUrl from the host it was called on, so the link the
  // user opens must come from freebuff.com to match the official CLI.
  oauth: {
    baseUrl: "https://freebuff.com",
    loginCodePath: "/api/auth/cli/code",
    loginStatusPath: "/api/auth/cli/status",
    oauthTimeoutMs: 300000,
  },
};
