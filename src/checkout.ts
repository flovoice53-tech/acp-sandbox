import { nanoid } from "nanoid";
import { db } from "./db.js";
import { findCatalogItem } from "./catalog.js";
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
  }
  if (body.buyer) session.buyer = { ...session.buyer, ...body.buyer };
  if (body.fulfillment_details) session.fulfillment_details = { ...session.fulfillment_details, ...body.fulfillment_details };
  session.updated_at = new Date().toISOString();

  saveSession(apiKey, session);
  return { session };
}

export function completeSession(
  apiKey: string,
  id: string,
  body: { buyer?: Buyer; payment_data?: unknown },
): { session: CheckoutSession } | { error: ApiError; status?: number } {
  const session = loadSession(apiKey, id);
  if (!session) return { error: err("invalid_request", "session_not_found", "No such checkout session"), status: 404 };
  if (session.status === "completed") {
    return { error: err("invalid_request", "already_completed", "Session is already completed"), status: 405 };
  }
  if (session.status === "canceled") {
    return { error: err("invalid_request", "session_canceled", "Session has been canceled"), status: 405 };
  }
  // Mock merchant: any non-empty payment_data is accepted as "paid".
  // No real payment processing happens here — this endpoint always
  // succeeds so testers can exercise the full happy-path flow.
  if (body.buyer) session.buyer = { ...session.buyer, ...body.buyer };

  const orderId = `ord_${nanoid(16)}`;
  session.status = "completed";
  session.updated_at = new Date().toISOString();
  session.order = {
    id: orderId,
    checkout_session_id: session.id,
    permalink_url: `${process.env.PUBLIC_BASE_URL ?? "https://acp-sandbox.flo-voice1.com"}/orders/${orderId}`,
    order_number: orderId.slice(4, 12).toUpperCase(),
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
  session.updated_at = new Date().toISOString();
  saveSession(apiKey, session);
  return { session };
}
