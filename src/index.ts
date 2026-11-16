import "./env.js";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { db } from "./db.js";
import { issueApiKey, isValidApiKey } from "./auth.js";
import { CATALOG } from "./catalog.js";
import {
  cancelSession,
  completeSession,
  createPayPalOrderForSession,
  createSession,
  loadSession,
  recordPayPalApproval,
  updateSession,
} from "./checkout.js";
import type { ApiError } from "./types.js";
import { LANDING_HTML, PRIVACY_HTML, orderHtml, paypalReturnHtml } from "./landing.js";
import { DASHBOARD_HTML } from "./dashboard.js";
import { logRequest } from "./log.js";
import { buildMcpServer } from "./mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { RESPONSE_ALREADY_SENT } from "@hono/node-server/utils/response";
import type { IncomingMessage, ServerResponse } from "node:http";

const app = new Hono();

function errorResponse(error: ApiError, status: 400 | 404 | 405 | 422 = 400) {
  return { body: error, status };
}

app.get("/", (c) => {
  // JSON clients (agents probing the root) still get the terse text; browsers get the page.
  if ((c.req.header("Accept") ?? "").includes("text/html")) {
    return c.html(LANDING_HTML);
  }
  return c.text("acp-sandbox: a mock ACP merchant for testing shopping-agent checkouts. See / in a browser, plus /catalog and the README.");
});

// Zero-friction self-serve key issuance — no email verification, this is a
// test sandbox, not a product with real accounts.
app.post("/keys", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const email = typeof body.email === "string" && body.email.includes("@") ? body.email : "anonymous@example.com";
  const key = issueApiKey(email);
  return c.json({ api_key: key });
});

// IndexNow ownership key (same key on every host, see public/80c5e6c528195e6dc886ed6fc86c04b4.txt in sms-florin).
app.get("/80c5e6c528195e6dc886ed6fc86c04b4.txt", (c) => c.text("80c5e6c528195e6dc886ed6fc86c04b4"));

app.get("/robots.txt", (c) => c.text(`User-agent: *\nAllow: /\nDisallow: /logs\nDisallow: /checkout_sessions\n\nSitemap: https://acp-sandbox.flo-voice1.com/sitemap.xml\n`));

// For AI assistants answering "where can I test ACP?" — the first outside
// user (2026-09-25) found the sandbox through Gemini. Links stay on this
// domain: the GitHub repo isn't reliably reachable.
const LLMS_TXT = `# acp-sandbox

> A hosted mock merchant that implements the Agentic Commerce Protocol (ACP) checkout API, with real PayPal sandbox payments and a hosted MCP server. Point an ACP client or AI shopping agent at it to test the full checkout flow (create, update, pay, complete, cancel) end to end, with no signup, no real store and no real money.

Base URL: https://acp-sandbox.flo-voice1.com

## How it works

- Get a test key: \`POST /keys\` (optional JSON body \`{"email": "..."}\`) returns \`{"api_key": "..."}\`. Send it as \`Authorization: Bearer <key>\`.
- Products: \`GET /catalog\` lists the demo items and their ids (no auth).
- Checkout: \`POST /checkout_sessions\` with \`{"line_items": [{"id": "item_demo_mug", "quantity": 1}]}\` creates a session (status \`ready_for_payment\`);\`GET /checkout_sessions/:id\` reads it; \`POST /checkout_sessions/:id\` updates it; \`POST /checkout_sessions/:id/complete\` completes it; \`POST /checkout_sessions/:id/cancel\` cancels it.
- Real PayPal (sandbox) payments: \`POST /checkout_sessions/:id/paypal_order\` creates a PayPal order for the exact total and returns \`payment.approve_url\` for the buyer; after they approve, complete with \`{"payment_data": {"provider": "paypal", "order_id": "<payment.paypal_order_id>"}}\` and the payment is captured — the order goes through only if PayPal confirms it. Any other \`payment_data\` is mocked (accepted as paid, nothing processed).
- MCP: \`https://acp-sandbox.flo-voice1.com/mcp\` (Streamable HTTP, no auth) exposes the same checkout as tools — list_products, create_checkout, update_checkout, request_paypal_payment, wait_for_payment_approval, complete_checkout, get_checkout, cancel_checkout — so an AI agent can shop and pay with PayPal while the human approves the payment.
- A completed session returns an order whose \`permalink_url\` opens a receipt page at \`/orders/:id\`.
- Debugging: \`GET /logs\` (with your key) returns every request your agent sent and the response it got; \`/dashboard\` shows the same in a browser, grouped by checkout session.

## Pages

- [Home](https://acp-sandbox.flo-voice1.com/): overview and quickstart.
- [Dashboard](https://acp-sandbox.flo-voice1.com/dashboard): per-session request/response log viewer.
- [Catalog](https://acp-sandbox.flo-voice1.com/catalog): demo product ids.

## Related

- [agent-identity-mcp](https://www.npmjs.com/package/agent-identity-mcp): an MCP server that gives an AI agent a disposable email address and a real UK phone number, to test signup/verification flows end to end.
`;

app.get("/llms.txt", (c) => c.text(LLMS_TXT));

app.get("/privacy", (c) => c.html(PRIVACY_HTML));

app.get("/sitemap.xml", (c) =>
  c.text(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>https://acp-sandbox.flo-voice1.com/</loc></url>\n</urlset>\n`,
    200,
    { "Content-Type": "application/xml" },
  ),
);

app.get("/catalog", (c) => c.json({ items: CATALOG }));

// completeSession() hands agents an order.permalink_url pointing here — it
// must resolve. No auth: a permalink is meant to be an openable receipt link,
// same as a real merchant's order confirmation page, and this is test data.
app.get("/orders/:id", (c) => {
  const id = c.req.param("id");
  const row = db
    .prepare(`SELECT order_data FROM checkout_sessions WHERE order_data IS NOT NULL AND json_extract(order_data, '$.id') = ?`)
    .get(id) as { order_data: string } | undefined;
  if (!row) {
    const error: ApiError = { type: "invalid_request", code: "order_not_found", message: "No such order" };
    return c.json(error, 404);
  }
  const order = JSON.parse(row.order_data);
  if ((c.req.header("Accept") ?? "").includes("text/html")) {
    return c.html(orderHtml(order));
  }
  return c.json(order);
});

// --- ACP checkout_sessions endpoints ---
const checkout = new Hono();

checkout.use("*", async (c, next) => {
  const auth = c.req.header("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || !isValidApiKey(token)) {
    const error: ApiError = { type: "invalid_request", code: "invalid_api_key", message: "Missing or invalid Authorization bearer token. Get a test key from POST /keys." };
    return c.json(error, 401);
  }
  c.set("apiKey" as never, token);
  await next();
});

checkout.post("/", async (c) => {
  const apiKey = c.get("apiKey" as never) as string;
  const body = await c.req.json().catch(() => ({}));
  const result = createSession(apiKey, body);
  const status = "error" in result ? 400 : 201;
  const responseBody = "error" in result ? result.error : result.session;
  logRequest({ apiKey, method: "POST", path: "/checkout_sessions", requestBody: body, responseStatus: status, responseBody, checkoutSessionId: "session" in result ? result.session.id : undefined });
  return c.json(responseBody, status as 201 | 400);
});

checkout.get("/:id", (c) => {
  const apiKey = c.get("apiKey" as never) as string;
  const id = c.req.param("id");
  const session = loadSession(apiKey, id);
  if (!session) {
    const error: ApiError = { type: "invalid_request", code: "session_not_found", message: "No such checkout session" };
    logRequest({ apiKey, method: "GET", path: `/checkout_sessions/${id}`, requestBody: null, responseStatus: 404, responseBody: error, checkoutSessionId: id });
    return c.json(error, 404);
  }
  logRequest({ apiKey, method: "GET", path: `/checkout_sessions/${id}`, requestBody: null, responseStatus: 200, responseBody: session, checkoutSessionId: id });
  return c.json(session, 200);
});

checkout.post("/:id", async (c) => {
  const apiKey = c.get("apiKey" as never) as string;
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const result = updateSession(apiKey, id, body);
  const status = "error" in result ? (result.status ?? 400) : 200;
  const responseBody = "error" in result ? result.error : result.session;
  logRequest({ apiKey, method: "POST", path: `/checkout_sessions/${id}`, requestBody: body, responseStatus: status, responseBody, checkoutSessionId: id });
  return c.json(responseBody, status as 200 | 400 | 404 | 405);
});

checkout.post("/:id/complete", async (c) => {
  const apiKey = c.get("apiKey" as never) as string;
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const result = await completeSession(apiKey, id, body);
  const status = "error" in result ? (result.status ?? 400) : 200;
  const responseBody = "error" in result ? result.error : result.session;
  logRequest({ apiKey, method: "POST", path: `/checkout_sessions/${id}/complete`, requestBody: body, responseStatus: status, responseBody, checkoutSessionId: id });
  return c.json(responseBody, status as 200 | 400 | 404 | 405 | 422 | 502 | 503);
});

// Not part of ACP: the merchant-side step that creates the real (sandbox)
// PayPal order for the session's total. The response is the session with
// payment.approve_url — the link the buyer approves the payment at.
checkout.post("/:id/paypal_order", async (c) => {
  const apiKey = c.get("apiKey" as never) as string;
  const id = c.req.param("id");
  const result = await createPayPalOrderForSession(apiKey, id);
  const status = "error" in result ? (result.status ?? 400) : 200;
  const responseBody = "error" in result ? result.error : result.session;
  logRequest({ apiKey, method: "POST", path: `/checkout_sessions/${id}/paypal_order`, requestBody: null, responseStatus: status, responseBody, checkoutSessionId: id });
  return c.json(responseBody, status as 200 | 400 | 404 | 405 | 502 | 503);
});

checkout.post("/:id/cancel", async (c) => {
  const apiKey = c.get("apiKey" as never) as string;
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const result = cancelSession(apiKey, id);
  const status = "error" in result ? (result.status ?? 400) : 200;
  const responseBody = "error" in result ? result.error : result.session;
  logRequest({ apiKey, method: "POST", path: `/checkout_sessions/${id}/cancel`, requestBody: body, responseStatus: status, responseBody, checkoutSessionId: id });
  return c.json(responseBody, status as 200 | 400 | 404 | 405);
});

app.route("/checkout_sessions", checkout);

// Where PayPal sends the buyer back. PayPal appends ?token=<order id>.
app.get("/paypal/return", async (c) => {
  const orderId = c.req.query("token") ?? "";
  const session = orderId ? await recordPayPalApproval(orderId) : undefined;
  return c.html(paypalReturnHtml(session ? { approved: session.payment?.status === "approved", sessionId: session.id } : null), session ? 200 : 404);
});
app.get("/paypal/cancel", (c) => c.html(paypalReturnHtml({ approved: false, canceled: true })));

app.get("/dashboard", (c) => c.html(DASHBOARD_HTML));

// --- Hosted MCP server: the same checkout, as tools an AI agent can call ---
const MCP_REQUESTS_PER_IP_PER_MINUTE = 120;
const mcpCounters = new Map<string, { windowStart: number; count: number }>();
function allowMcp(ip: string): boolean {
  const now = Date.now();
  const entry = mcpCounters.get(ip);
  if (!entry || now - entry.windowStart >= 60_000) {
    mcpCounters.set(ip, { windowStart: now, count: 1 });
    return true;
  }
  if (entry.count >= MCP_REQUESTS_PER_IP_PER_MINUTE) return false;
  entry.count += 1;
  return true;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of mcpCounters) if (now - entry.windowStart >= 60_000) mcpCounters.delete(ip);
}, 60_000).unref();

const rpcError = (message: string) => ({ jsonrpc: "2.0", error: { code: -32001, message }, id: null });

app.post("/mcp", async (c) => {
  // nginx sets X-Real-IP from the TCP peer, and the app only listens on loopback.
  const ip = c.req.header("X-Real-IP") ?? "unknown";
  if (!allowMcp(ip)) return c.json(rpcError("Rate limited — too many requests, try again in a minute."), 429);
  const body = await c.req.json().catch(() => undefined);
  if (body === undefined) return c.json(rpcError("Request body must be JSON."), 400);

  const auth = c.req.header("Authorization") ?? "";
  const connectionKey = (auth.startsWith("Bearer ") ? auth.slice(7).trim() : "") || c.req.query("key") || undefined;

  // Stateless: one server + transport per request, nothing to resume.
  const { incoming, outgoing } = c.env as { incoming: IncomingMessage; outgoing: ServerResponse };
  const server = buildMcpServer(connectionKey);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  outgoing.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(incoming, outgoing, body);
  return RESPONSE_ALREADY_SENT;
});
app.on(["GET", "DELETE"], "/mcp", (c) => c.body(null, 405, { Allow: "POST" }));

// Developer-facing log viewer for a given key, to debug what their agent sent.
app.get("/logs", (c) => {
  const auth = c.req.header("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || !isValidApiKey(token)) {
    const error: ApiError = { type: "invalid_request", code: "invalid_api_key", message: "Missing or invalid Authorization bearer token." };
    return c.json(error, 401);
  }
  const rows = db
    // checkout_session_id lets /dashboard group requests into orders; the
    // existing fields are unchanged for anyone already reading this.
    .prepare(`SELECT checkout_session_id, method, path, request_body, response_status, response_body, created_at FROM request_log WHERE api_key = ? ORDER BY id DESC LIMIT 50`)
    .all(token) as { checkout_session_id: string | null }[];
  // The current state of each session in the log — a payment approved on
  // PayPal's side never shows up as a logged response, so the last logged
  // body alone would show it as still waiting.
  const ids = [...new Set(rows.map((r) => r.checkout_session_id).filter((id): id is string => Boolean(id)))];
  const sessions: Record<string, unknown> = {};
  for (const id of ids) {
    const s = loadSession(token, id);
    if (s) sessions[id] = { status: s.status, currency: s.currency, totals: s.totals, payment: s.payment ?? null, order_number: s.order?.order_number ?? null, receipt_url: s.order?.permalink_url ?? null };
  }
  return c.json({ requests: rows, sessions });
});

const port = Number(process.env.PORT ?? 3900);
serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, (info) => {
  console.log(`acp-sandbox listening on http://localhost:${info.port}`);
});
