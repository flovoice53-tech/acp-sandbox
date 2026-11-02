import { customAlphabet, nanoid } from "nanoid";

// Readable order numbers: no _ or -, and no look-alikes like 0/O or 1/I.
const orderNumber = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 8);
import { db } from "./db.js";
import { findCatalogItem } from "./catalog.js";
import { PayPalError, captureOrder, createOrder, getOrder, paypalConfigured, toPayPalValue } from "./paypal.js";
import type {
  ApiError,
  Buyer,
  CheckoutSession,
  FulfillmentDetails,
  LineItem,
  Total,
} from "./types.js";

const DEFAULT_CURRENCY = "usd";

function err(type: ApiError["type"], code: string, message: string, param?: string): ApiError {
  return { type, code, message, param };
}

function buildLineItems(
  items: { id: string; quantity: number }[] | undefined,
): { lineItems: LineItem[] } | { error: ApiError } {
  if (!items || items.length === 0) {
    return { error: err("invalid_request", "missing_line_items", "line_items must contain at least one item", "$.line_items") };
  }
  const lineItems: LineItem[] = [];
  for (const requested of items) {
    const catalogItem = findCatalogItem(requested.id);
    if (!catalogItem) {
      return {
        error: err(
          "invalid_request",
          "unknown_item",
          `No catalog item with id "${requested.id}". See GET /catalog for valid demo item ids.`,
          "$.line_items",
        ),
      };
    }
    const quantity = requested.quantity ?? 1;
    const unitAmount = catalogItem.unit_amount;
    const subtotal = unitAmount * quantity;
    lineItems.push({
      id: `li_${nanoid(12)}`,
      item: { id: catalogItem.id, name: catalogItem.name, unit_amount: unitAmount },
      quantity,
      name: catalogItem.name,
      unit_amount: unitAmount,
      totals: [
        { type: "subtotal", display_text: "Subtotal", amount: subtotal },
        { type: "total", display_text: "Total", amount: subtotal },
      ],
    });
  }
  return { lineItems };
}

function computeTotals(lineItems: LineItem[]): Total[] {
  const subtotal = lineItems.reduce((sum, li) => sum + (li.unit_amount ?? 0) * li.quantity, 0);
  return [
    { type: "subtotal", display_text: "Subtotal", amount: subtotal },
    { type: "total", display_text: "Total", amount: subtotal },
  ];
}

function saveSession(apiKey: string, session: CheckoutSession) {
  db.prepare(
    `INSERT INTO checkout_sessions (id, api_key, status, currency, data, order_data, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       status = excluded.status,
       currency = excluded.currency,
       data = excluded.data,
       order_data = excluded.order_data,
       updated_at = datetime('now')`,
  ).run(
    session.id,
    apiKey,
    session.status,
    session.currency,
    JSON.stringify(session),
    session.order ? JSON.stringify(session.order) : null,
  );
}

export function loadSession(apiKey: string, id: string): CheckoutSession | undefined {
  const row = db
    .prepare(`SELECT data FROM checkout_sessions WHERE id = ? AND api_key = ?`)
    .get(id, apiKey) as { data: string } | undefined;
  return row ? (JSON.parse(row.data) as CheckoutSession) : undefined;
}

export function createSession(
  apiKey: string,
  body: {
    line_items?: { id: string; quantity: number }[];
    buyer?: Buyer;
    currency?: string;
    fulfillment_details?: FulfillmentDetails;
  },
): { session: CheckoutSession } | { error: ApiError } {
  const built = buildLineItems(body.line_items);
  if ("error" in built) return built;

  const now = new Date().toISOString();
  const session: CheckoutSession = {
    id: `cs_${nanoid(16)}`,
    status: "ready_for_payment",
    currency: body.currency ?? DEFAULT_CURRENCY,
    buyer: body.buyer,
    fulfillment_details: body.fulfillment_details,
    line_items: built.lineItems,
    fulfillment_options: [],
    selected_fulfillment_options: [],
    totals: computeTotals(built.lineItems),
    messages: [],
    links: [],
    capabilities: {},
    created_at: now,
    updated_at: now,
  };
  saveSession(apiKey, session);
  return { session };
}

export function updateSession(
  apiKey: string,
  id: string,
  body: {
    line_items?: { id: string; quantity: number }[];
    buyer?: Buyer;
    fulfillment_details?: FulfillmentDetails;
  },
): { session: CheckoutSession } | { error: ApiError; status?: number } {
  const session = loadSession(apiKey, id);
  if (!session) return { error: err("invalid_request", "session_not_found", "No such checkout session"), status: 404 };
  if (session.status === "completed" || session.status === "canceled") {
    return {
      error: err("invalid_request", "session_not_updatable", `Session is already ${session.status}`),
      status: 405,
    };
  }

  if (body.line_items) {
    const built = buildLineItems(body.line_items);
    if ("error" in built) return built;
    session.line_items = built.lineItems;
    session.totals = computeTotals(built.lineItems);
    // A PayPal order is for one exact total. If the cart changed, that order
    // can no longer pay for it — drop it so the agent asks for a new one.
    if (session.payment && session.payment.status !== "captured" && session.payment.amount !== sessionTotal(session)) {
      session.payment = undefined;
      session.links = session.links.filter((l) => l.type !== "payment_approval");
    }
  }
  if (body.buyer) session.buyer = { ...session.buyer, ...body.buyer };
  if (body.fulfillment_details) session.fulfillment_details = { ...session.fulfillment_details, ...body.fulfillment_details };
  session.updated_at = new Date().toISOString();

  saveSession(apiKey, session);
  return { session };
}

function sessionTotal(session: CheckoutSession): number {
  return session.totals.find((t) => t.type === "total")?.amount ?? 0;
}

const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL ?? "https://acp-sandbox.flo-voice1.com";

type Result = { session: CheckoutSession } | { error: ApiError; status?: number };

function openSessionOrError(apiKey: string, id: string): { session: CheckoutSession } | { error: ApiError; status: number } {
  const session = loadSession(apiKey, id);
  if (!session) return { error: err("invalid_request", "session_not_found", "No such checkout session"), status: 404 };
  if (session.status === "completed") {
    return { error: err("invalid_request", "already_completed", "Session is already completed"), status: 405 };
  }
  if (session.status === "canceled") {
    return { error: err("invalid_request", "session_canceled", "Session has been canceled"), status: 405 };
  }
  return { session };
}

// POST /checkout_sessions/:id/paypal_order — the merchant creates a PayPal
// (sandbox) order for the session's current total and hands back the link
// the buyer approves it at. Asking again for an unchanged cart returns the
// same order.
export async function createPayPalOrderForSession(apiKey: string, id: string): Promise<Result> {
  const open = openSessionOrError(apiKey, id);
  if ("error" in open) return open;
  const { session } = open;
  if (!paypalConfigured()) {
    return { error: err("service_unavailable", "paypal_not_configured", "PayPal is not configured on this server."), status: 503 };
  }

  const total = sessionTotal(session);
  if (session.payment && session.payment.amount === total && session.payment.status !== "captured") {
    return { session };
  }

  try {
    const { order, approveUrl } = await createOrder({
      sessionId: session.id,
      currency: session.currency,
      totalMinor: total,
      items: session.line_items.map((li) => ({
        name: li.name ?? li.item.id,
        quantity: li.quantity,
        unitMinor: li.unit_amount ?? 0,
      })),
      returnUrl: `${PUBLIC_BASE_URL}/paypal/return`,
      cancelUrl: `${PUBLIC_BASE_URL}/paypal/cancel`,
    });
    session.payment = {
      provider: "paypal",
      paypal_order_id: order.id,
      approve_url: approveUrl,
      amount: total,
      currency: session.currency,
      status: "awaiting_approval",
    };
    session.links = [
      ...session.links.filter((l) => l.type !== "payment_approval"),
      { type: "payment_approval", url: approveUrl },
    ];
    session.updated_at = new Date().toISOString();
    saveSession(apiKey, session);
    return { session };
  } catch (e) {
    return { error: err("processing_error", "paypal_error", e instanceof Error ? e.message : String(e)), status: 502 };
  }
}

// The buyer lands on /paypal/return after approving on PayPal. Confirm with
// PayPal that the order really is approved before recording it — the query
// string alone proves nothing.
export async function recordPayPalApproval(paypalOrderId: string): Promise<CheckoutSession | undefined> {
  const row = db
    .prepare(`SELECT api_key, data FROM checkout_sessions WHERE json_extract(data, '$.payment.paypal_order_id') = ?`)
    .get(paypalOrderId) as { api_key: string; data: string } | undefined;
  if (!row) return undefined;
  const session = JSON.parse(row.data) as CheckoutSession;
  if (session.payment?.status === "awaiting_approval" && paypalConfigured()) {
    const order = await getOrder(paypalOrderId).catch(() => undefined);
    if (order?.status === "APPROVED") {
      session.payment.status = "approved";
      session.updated_at = new Date().toISOString();
      saveSession(row.api_key, session);
    }
  }
  return session;
}

async function capturePayPal(
  session: CheckoutSession,
  paymentData: { order_id?: unknown },
): Promise<{ status: number; error: ApiError } | null> {
  const payment = session.payment;
  const orderId = typeof paymentData.order_id === "string" ? paymentData.order_id : "";
  // Only the order this merchant created for this session can pay for it —
  // never an order id the agent brings from elsewhere.
  if (!payment || payment.paypal_order_id !== orderId) {
    return {
      status: 422,
      error: err(
        "invalid_request",
        "unknown_payment",
        "payment_data.order_id must be the PayPal order created for this session (POST /checkout_sessions/:id/paypal_order).",
        "$.payment_data.order_id",
      ),
    };
  }
  if (payment.amount !== sessionTotal(session) || payment.currency !== session.currency) {
    return { status: 422, error: err("invalid_request", "payment_amount_mismatch", "The cart changed after the PayPal order was created. Create a new PayPal order.") };
  }
  if (!paypalConfigured()) {
    return { status: 503, error: err("service_unavailable", "paypal_not_configured", "PayPal is not configured on this server.") };
  }

  let captured;
  try {
    captured = await captureOrder(orderId);
  } catch (e) {
    if (e instanceof PayPalError && e.issue === "ORDER_NOT_APPROVED") {
      return {
        status: 422,
        error: err("invalid_request", "payment_not_approved", `The buyer has not approved this PayPal payment yet. Approve it at ${payment.approve_url}, then complete again.`),
      };
    }
    return { status: 502, error: err("processing_error", "payment_declined", e instanceof Error ? e.message : String(e)) };
  }

  const unit = captured.purchase_units?.[0];
  const capture = unit?.payments?.captures?.[0];
  const expected = toPayPalValue(payment.amount);
  if (
    captured.status !== "COMPLETED" ||
    capture?.status !== "COMPLETED" ||
    capture.amount.value !== expected ||
    capture.amount.currency_code !== payment.currency.toUpperCase() ||
    (unit?.custom_id !== undefined && unit.custom_id !== session.id)
  ) {
    return { status: 502, error: err("processing_error", "payment_declined", `PayPal did not complete the payment (order ${captured.status}, capture ${capture?.status ?? "none"}).`) };
  }
  payment.status = "captured";
  payment.capture_id = capture.id;
  return null;
}

export async function completeSession(
  apiKey: string,
  id: string,
  body: { buyer?: Buyer; payment_data?: unknown },
): Promise<Result> {
  const open = openSessionOrError(apiKey, id);
  if ("error" in open) return open;
  const { session } = open;

  const paymentData = (body.payment_data ?? {}) as { provider?: unknown; order_id?: unknown };
  if (paymentData.provider === "paypal") {
    const failure = await capturePayPal(session, paymentData);
    if (failure) return failure;
  }
  // Any other payment_data is the original mock: accepted as paid with no
  // real processing, so testers can still run the happy path without PayPal.
  if (body.buyer) session.buyer = { ...session.buyer, ...body.buyer };

  const orderId = `ord_${nanoid(16)}`;
  session.status = "completed";
  session.updated_at = new Date().toISOString();
  session.order = {
    id: orderId,
    checkout_session_id: session.id,
    permalink_url: `${process.env.PUBLIC_BASE_URL ?? "https://acp-sandbox.flo-voice1.com"}/orders/${orderId}`,
    order_number: orderNumber(),
    status: "confirmed",
    line_items: session.line_items,
    totals: session.totals,
  };

  saveSession(apiKey, session);
  return { session };
}

export function cancelSession(
  apiKey: string,
  id: string,
): { session: CheckoutSession } | { error: ApiError; status?: number } {
  const session = loadSession(apiKey, id);
  if (!session) return { error: err("invalid_request", "session_not_found", "No such checkout session"), status: 404 };
  if (session.status === "completed" || session.status === "canceled") {
    return {
      error: err("invalid_request", "not_cancelable", `Session is already ${session.status}`),
      status: 405,
    };
  }
  session.status = "canceled";
  // An uncaptured PayPal order can't pay for a canceled session: stop offering
  // its approval link so nobody approves money for an order that won't ship.
  if (session.payment && session.payment.status !== "captured") {
    session.payment.status = "voided";
    session.links = session.links.filter((l) => l.type !== "payment_approval");
  }
  session.updated_at = new Date().toISOString();
  saveSession(apiKey, session);
  return { session };
}
