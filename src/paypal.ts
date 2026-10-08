// PayPal Orders v2 against the PayPal sandbox — the real payment step behind
// an ACP checkout. The merchant (this server) creates the PayPal order for
// the session's exact total; the buyer approves it on PayPal; the agent then
// completes the ACP session with that order id and the merchant captures it.
// Only a capture PayPal reports as COMPLETED, for the right amount and the
// right session, marks the session paid.
//
// Sandbox only by default: PAYPAL_API_BASE points at api-m.sandbox.paypal.com
// unless explicitly overridden, and the credentials are sandbox app keys.

const TIMEOUT_MS = 15_000;

// Read at call time, not import time, so a .env loaded at startup applies.
const apiBase = () => process.env.PAYPAL_API_BASE ?? "https://api-m.sandbox.paypal.com";
const clientId = () => process.env.PAYPAL_CLIENT_ID ?? "";
const clientSecret = () => process.env.PAYPAL_CLIENT_SECRET ?? "";

export function paypalConfigured(): boolean {
  return Boolean(clientId() && clientSecret());
}

export class PayPalError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly issue?: string,
  ) {
    super(message);
  }
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.value;
  const res = await fetch(`${apiBase()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${clientId()}:${clientSecret()}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new PayPalError(`PayPal auth failed (${res.status})`, res.status);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  // Refresh a minute early so a token never expires mid-request.
  cachedToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return cachedToken.value;
}

async function call<T>(method: "GET" | "POST", path: string, body?: unknown, requestId?: string): Promise<T> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${await accessToken()}`,
    "content-type": "application/json",
    prefer: "return=representation",
  };
  // PayPal-Request-Id makes create/capture idempotent: a retried request
  // returns the first result instead of creating or capturing twice.
  if (requestId) headers["paypal-request-id"] = requestId;
  const res = await fetch(`${apiBase()}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const data = (await res.json().catch(() => ({}))) as T & {
    details?: { issue?: string; description?: string }[];
    message?: string;
  };
  if (!res.ok) {
    const issue = data.details?.[0]?.issue;
    const description = data.details?.[0]?.description ?? data.message ?? `PayPal request failed (${res.status})`;
    throw new PayPalError(description, res.status, issue);
  }
  return data;
}

export type Money = { currency_code: string; value: string };

export type PayPalOrder = {
  id: string;
  status: "CREATED" | "SAVED" | "APPROVED" | "VOIDED" | "COMPLETED" | "PAYER_ACTION_REQUIRED";
  links?: { href: string; rel: string }[];
  purchase_units?: {
    custom_id?: string;
    amount?: Money;
    payments?: { captures?: { id: string; status: string; amount: Money }[] };
  }[];
};

// ACP amounts are integer minor units; PayPal wants a decimal string.
// Every currency this sandbox uses has two decimals.
export function toPayPalValue(minorUnits: number): string {
  return (minorUnits / 100).toFixed(2);
}

export async function createOrder(opts: {
  sessionId: string;
  currency: string;
  totalMinor: number;
  items: { name: string; quantity: number; unitMinor: number }[];
  returnUrl: string;
  cancelUrl: string;
}): Promise<{ order: PayPalOrder; approveUrl: string }> {
  const currency_code = opts.currency.toUpperCase();
  const order = await call<PayPalOrder>(
    "POST",
    "/v2/checkout/orders",
    {
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: opts.sessionId,
          custom_id: opts.sessionId,
          description: "acp-sandbox demo order (PayPal sandbox, no real money)",
          amount: {
            currency_code,
            value: toPayPalValue(opts.totalMinor),
            breakdown: { item_total: { currency_code, value: toPayPalValue(opts.totalMinor) } },
          },
          items: opts.items.map((i) => ({
            name: i.name.slice(0, 127),
            quantity: String(i.quantity),
            unit_amount: { currency_code, value: toPayPalValue(i.unitMinor) },
          })),
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: "acp-sandbox demo store",
            shipping_preference: "NO_SHIPPING",
            user_action: "PAY_NOW",
            return_url: opts.returnUrl,
            cancel_url: opts.cancelUrl,
          },
        },
      },
    },
    // One PayPal order per session total — asking again for the same cart
    // returns the same order rather than piling up new ones.
    `${opts.sessionId}-${opts.totalMinor}-${currency_code}`,
  );
  const approveUrl = order.links?.find((l) => l.rel === "payer-action" || l.rel === "approve")?.href;
  if (!approveUrl) throw new PayPalError("PayPal returned no approval link", 502);
  return { order, approveUrl };
}

export function getOrder(orderId: string): Promise<PayPalOrder> {
  return call<PayPalOrder>("GET", `/v2/checkout/orders/${encodeURIComponent(orderId)}`);
}

export function captureOrder(orderId: string): Promise<PayPalOrder> {
  return call<PayPalOrder>(
    "POST",
    `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
    {},
    `capture-${orderId}`,
  );
}
