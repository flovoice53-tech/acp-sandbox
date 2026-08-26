import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { db } from "./db.js";
import { issueApiKey, isValidApiKey } from "./auth.js";
import { CATALOG } from "./catalog.js";
import { cancelSession, completeSession, createSession, loadSession, updateSession } from "./checkout.js";
import type { ApiError } from "./types.js";

const app = new Hono();

function errorResponse(error: ApiError, status: 400 | 404 | 405 | 422 = 400) {
  return { body: error, status };
}

function logRequest(opts: {
  apiKey?: string;
  checkoutSessionId?: string;
  method: string;
  path: string;
  requestBody: unknown;
  responseStatus: number;
  responseBody: unknown;
}) {
  db.prepare(
    `INSERT INTO request_log (api_key, checkout_session_id, method, path, request_body, response_status, response_body)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    opts.apiKey ?? null,
    opts.checkoutSessionId ?? null,
    opts.method,
    opts.path,
    JSON.stringify(opts.requestBody ?? null),
    opts.responseStatus,
    JSON.stringify(opts.responseBody ?? null),
  );
}

app.get("/", (c) => c.text("acp-sandbox: a mock ACP merchant for testing shopping-agent checkouts. See /catalog and README."));

// Zero-friction self-serve key issuance — no email verification, this is a
// test sandbox, not a product with real accounts.
app.post("/keys", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const email = typeof body.email === "string" && body.email.includes("@") ? body.email : "anonymous@example.com";
  const key = issueApiKey(email);
  return c.json({ api_key: key });
});

app.get("/catalog", (c) => c.json({ items: CATALOG }));

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
  const result = completeSession(apiKey, id, body);
  const status = "error" in result ? (result.status ?? 400) : 200;
  const responseBody = "error" in result ? result.error : result.session;
  logRequest({ apiKey, method: "POST", path: `/checkout_sessions/${id}/complete`, requestBody: body, responseStatus: status, responseBody, checkoutSessionId: id });
  return c.json(responseBody, status as 200 | 400 | 404 | 405);
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

// Developer-facing log viewer for a given key, to debug what their agent sent.
app.get("/logs", (c) => {
  const auth = c.req.header("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || !isValidApiKey(token)) {
    const error: ApiError = { type: "invalid_request", code: "invalid_api_key", message: "Missing or invalid Authorization bearer token." };
    return c.json(error, 401);
  }
  const rows = db
    .prepare(`SELECT method, path, request_body, response_status, response_body, created_at FROM request_log WHERE api_key = ? ORDER BY id DESC LIMIT 50`)
    .all(token);
  return c.json({ requests: rows });
});

const port = Number(process.env.PORT ?? 3900);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`acp-sandbox listening on http://localhost:${info.port}`);
});
