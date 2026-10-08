// acp-sandbox as a hosted MCP server: any MCP-capable agent (Claude,
// Cursor, ...) can shop the demo store and pay with PayPal (sandbox) by
// calling these tools — no client code, just the URL
// https://acp-sandbox.flo-voice1.com/mcp.
//
// The tools call the same checkout functions as the REST API and write to
// the same request log, so every step shows up on /dashboard.
//
// A sandbox key ties sessions to one caller. It can come from the
// connection (Authorization: Bearer <key>, or ?key=<key> on the URL for
// clients that can't set headers) or from the tools' api_key argument;
// create_checkout issues a fresh key when none is given.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
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
import { logRequest } from "./log.js";
import { getOrder, paypalConfigured } from "./paypal.js";
import type { ApiError, CheckoutSession } from "./types.js";

const VERSION = "0.2.0";
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL ?? "https://acp-sandbox.flo-voice1.com";
// nginx gives this route 60s; leave room for the response.
const MAX_WAIT_SECONDS = 45;
const POLL_INTERVAL_MS = 3_000;

const money = (minor: number, currency: string) => `${(minor / 100).toFixed(2)} ${currency.toUpperCase()}`;

// What an agent needs to reason about a session, without the full ACP
// payload (line-item totals arrays, empty capability maps, ...).
function summarize(session: CheckoutSession) {
  const total = session.totals.find((t) => t.type === "total")?.amount ?? 0;
  return {
    session_id: session.id,
    status: session.status,
    items: session.line_items.map((li) => ({
      product_id: li.item.id,
      name: li.name,
      quantity: li.quantity,
      unit_price: money(li.unit_amount ?? 0, session.currency),
    })),
    total: money(total, session.currency),
    payment: session.payment
      ? {
          provider: session.payment.provider,
          status: session.payment.status,
          ...(session.payment.status === "awaiting_approval" ? { approve_url: session.payment.approve_url } : {}),
          ...(session.payment.capture_id ? { paypal_capture_id: session.payment.capture_id } : {}),
        }
      : null,
    order: session.order
      ? { order_number: session.order.order_number, receipt_url: session.order.permalink_url }
      : null,
  };
}

const ok = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });
const fail = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true });
const apiFail = (error: ApiError) => fail(`${error.code}: ${error.message}`);

const apiKeyArg = z
  .string()
  .optional()
  .describe("Sandbox key from create_checkout (not needed if the connection already carries one).");

export function buildMcpServer(connectionKey: string | undefined): McpServer {
  const server = new McpServer({ name: "acp-sandbox", version: VERSION });

  function keyOrFail(argKey: string | undefined): string | { error: ReturnType<typeof fail> } {
    const key = argKey ?? connectionKey;
    if (!key) return { error: fail("No sandbox key. Start with create_checkout (it returns an api_key), then pass that api_key to the other tools.") };
    if (!isValidApiKey(key)) return { error: fail("Unknown sandbox key. Call create_checkout without api_key to get a new one.") };
    return key;
  }

  function log(apiKey: string, tool: string, args: unknown, status: number, result: unknown, sessionId?: string) {
    logRequest({ apiKey, checkoutSessionId: sessionId, method: "MCP", path: tool, requestBody: args, responseStatus: status, responseBody: result });
  }

  server.registerTool(
    "list_products",
    {
      title: "List products",
      description: "List everything the demo store sells, with product ids and prices. Prices are in USD.",
      inputSchema: {},
    },
    async () => ok({ products: CATALOG.map((p) => ({ product_id: p.id, name: p.name, price: money(p.unit_amount, "usd") })) }),
  );

  server.registerTool(
    "create_checkout",
    {
      title: "Create a checkout",
      description:
        "Start a checkout (an Agentic Commerce Protocol checkout session) with the products and quantities the user wants. Returns the session id, the cart and its total. If you have no api_key yet, leave it out: a sandbox key is created and returned — reuse it in every later call.",
      inputSchema: {
        items: z
          .array(z.object({ product_id: z.string(), quantity: z.number().int().positive().max(99) }))
          .min(1)
          .describe("Products to buy, by product_id from list_products."),
        buyer_email: z.string().email().optional().describe("The buyer's email, if the user gave one."),
        api_key: apiKeyArg,
      },
    },
    async ({ items, buyer_email, api_key }) => {
      let key = api_key ?? connectionKey;
      let issued = false;
      if (!key) {
        key = issueApiKey(buyer_email ?? "mcp-agent@example.com");
        issued = true;
      } else if (!isValidApiKey(key)) {
        return fail("Unknown sandbox key. Leave api_key out to get a new one.");
      }
      const args = { line_items: items.map((i) => ({ id: i.product_id, quantity: i.quantity })), buyer: buyer_email ? { email: buyer_email } : undefined };
      const result = createSession(key, args);
      if ("error" in result) {
        log(key, "create_checkout", args, 400, result.error);
        return apiFail(result.error);
      }
      log(key, "create_checkout", args, 201, result.session, result.session.id);
      return ok({
        ...summarize(result.session),
        ...(issued ? { api_key: key, note: "New sandbox key — pass this api_key to every later call." } : {}),
        dashboard_url: `${PUBLIC_BASE_URL}/dashboard`,
      });
    },
  );

  server.registerTool(
    "update_checkout",
    {
      title: "Change the cart",
      description: "Replace the items in an open checkout (e.g. the user changed their mind). Any PayPal payment created for the old total is dropped — request a new one.",
      inputSchema: {
        session_id: z.string(),
        items: z.array(z.object({ product_id: z.string(), quantity: z.number().int().positive().max(99) })).min(1),
        api_key: apiKeyArg,
      },
    },
    async ({ session_id, items, api_key }) => {
      const key = keyOrFail(api_key);
      if (typeof key !== "string") return key.error;
      const args = { line_items: items.map((i) => ({ id: i.product_id, quantity: i.quantity })) };
      const result = updateSession(key, session_id, args);
      if ("error" in result) {
        log(key, "update_checkout", args, result.status ?? 400, result.error, session_id);
        return apiFail(result.error);
      }
      log(key, "update_checkout", args, 200, result.session, session_id);
      return ok(summarize(result.session));
    },
  );

  server.registerTool(
    "get_checkout",
    {
      title: "Get a checkout",
      description: "Read the current cart, total, payment status and order of a checkout.",
      inputSchema: { session_id: z.string(), api_key: apiKeyArg },
    },
    async ({ session_id, api_key }) => {
      const key = keyOrFail(api_key);
      if (typeof key !== "string") return key.error;
      const session = loadSession(key, session_id);
      if (!session) return fail("session_not_found: No such checkout session");
      return ok(summarize(session));
    },
  );

  server.registerTool(
    "request_paypal_payment",
    {
      title: "Ask the user to pay with PayPal",
      description:
        "Create a PayPal (sandbox) payment for the checkout's exact total. Returns approve_url: give that link to the user and ask them to approve the payment on PayPal — you cannot approve it yourself. Then call wait_for_payment_approval.",
      inputSchema: { session_id: z.string(), api_key: apiKeyArg },
    },
    async ({ session_id, api_key }) => {
      const key = keyOrFail(api_key);
      if (typeof key !== "string") return key.error;
      if (!paypalConfigured()) return fail("paypal_not_configured: PayPal is not set up on this server.");
      const result = await createPayPalOrderForSession(key, session_id);
      if ("error" in result) {
        log(key, "request_paypal_payment", { session_id }, result.status ?? 400, result.error, session_id);
        return apiFail(result.error);
      }
      log(key, "request_paypal_payment", { session_id }, 200, result.session, session_id);
      return ok({
        ...summarize(result.session),
        next_step: "Show approve_url to the user. Tell them it's a PayPal sandbox (test) payment and to log in with a PayPal sandbox buyer account. Then call wait_for_payment_approval.",
      });
    },
  );

  server.registerTool(
    "wait_for_payment_approval",
    {
      title: "Wait for the user to approve the PayPal payment",
      description: `Wait (up to ${MAX_WAIT_SECONDS}s per call) until PayPal reports the user approved the payment. If it returns still_waiting, the user hasn't approved yet — ask them, then call again.`,
      inputSchema: {
        session_id: z.string(),
        timeout_seconds: z.number().int().min(1).max(MAX_WAIT_SECONDS).default(MAX_WAIT_SECONDS),
        api_key: apiKeyArg,
      },
    },
    async ({ session_id, timeout_seconds, api_key }) => {
      const key = keyOrFail(api_key);
      if (typeof key !== "string") return key.error;
      const deadline = Date.now() + timeout_seconds * 1000;
      for (;;) {
        const session = loadSession(key, session_id);
        if (!session) return fail("session_not_found: No such checkout session");
        const payment = session.payment;
        if (!payment) return fail("no_payment: Call request_paypal_payment first.");
        if (payment.status !== "awaiting_approval") {
          return ok({ approved: true, ...summarize(session), next_step: "Call complete_checkout with payment: \"paypal\"." });
        }
        // Ask PayPal directly — the buyer may approve without ever reaching
        // our return page (closed tab, blocked redirect).
        const order = await getOrder(payment.paypal_order_id).catch(() => undefined);
        if (order?.status === "APPROVED") {
          await recordPayPalApproval(payment.paypal_order_id);
          continue;
        }
        if (Date.now() + POLL_INTERVAL_MS > deadline) {
          return ok({ approved: false, still_waiting: true, approve_url: payment.approve_url, next_step: "Remind the user to approve the payment at approve_url, then call wait_for_payment_approval again." });
        }
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      }
    },
  );

  server.registerTool(
    "complete_checkout",
    {
      title: "Complete the checkout",
      description:
        "Place the order. With payment \"paypal\" the approved PayPal payment is captured first, and the order only goes through if PayPal confirms the money for the exact total. \"mock\" skips real payment (testing only).",
      inputSchema: {
        session_id: z.string(),
        payment: z.enum(["paypal", "mock"]).default("paypal"),
        api_key: apiKeyArg,
      },
    },
    async ({ session_id, payment, api_key }) => {
      const key = keyOrFail(api_key);
      if (typeof key !== "string") return key.error;
      const session = loadSession(key, session_id);
      const body =
        payment === "paypal"
          ? { payment_data: { provider: "paypal", order_id: session?.payment?.paypal_order_id } }
          : { payment_data: { token: "mock" } };
      const result = await completeSession(key, session_id, body);
      if ("error" in result) {
        log(key, "complete_checkout", body, result.status ?? 400, result.error, session_id);
        return apiFail(result.error);
      }
      log(key, "complete_checkout", body, 200, result.session, session_id);
      return ok(summarize(result.session));
    },
  );

  server.registerTool(
    "cancel_checkout",
    {
      title: "Cancel a checkout",
      description: "Cancel an open checkout. Nothing is charged.",
      inputSchema: { session_id: z.string(), api_key: apiKeyArg },
    },
    async ({ session_id, api_key }) => {
      const key = keyOrFail(api_key);
      if (typeof key !== "string") return key.error;
      const result = cancelSession(key, session_id);
      if ("error" in result) {
        log(key, "cancel_checkout", { session_id }, result.status ?? 400, result.error, session_id);
        return apiFail(result.error);
      }
      log(key, "cancel_checkout", { session_id }, 200, result.session, session_id);
      return ok(summarize(result.session));
    },
  );

  return server;
}
