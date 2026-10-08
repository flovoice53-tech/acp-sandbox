# acp-sandbox

A hosted mock merchant implementing the [Agentic Commerce Protocol](https://github.com/agentic-commerce-protocol/agentic-commerce-protocol) (ACP) checkout API, with **real PayPal sandbox payments** and a **hosted MCP server** — so an AI agent can shop, ask a human to pay with PayPal, and place the order, end to end, without real money or a real store.

Live at **https://acp-sandbox.flo-voice1.com** · MCP server: **https://acp-sandbox.flo-voice1.com/mcp**

## Why

ACP defines how a shopping agent talks to a merchant to complete a purchase. Payment providers' test modes cover the *payment* side, but there's no hosted "fake merchant" an agent developer can point their code at to check the whole thing works: building a cart, changing it, getting it paid, handling errors, reading back an order. acp-sandbox is that merchant — and the payment behind its checkout is a real PayPal Orders v2 flow against the PayPal sandbox.

The design rule for money: **the agent never pays on its own.** It can only create a PayPal order for the exact cart total and hand the human an approval link. The merchant captures the payment only after the buyer approves it on PayPal, and only if PayPal confirms the capture for that amount, currency and checkout.

## Let an AI agent shop (MCP)

Connect any MCP client to `https://acp-sandbox.flo-voice1.com/mcp` (Streamable HTTP, no auth — a sandbox key is created on the first checkout).

- **Claude (claude.ai / Desktop):** Settings → Connectors → Add custom connector → paste the URL.
- **Claude Code:** `claude mcp add --transport http acp-sandbox https://acp-sandbox.flo-voice1.com/mcp`

Then ask: *"Buy me a demo mug and two notebooks from the acp-sandbox store and pay with PayPal."* The agent builds the cart, gives you a PayPal link, waits while you approve it with a [PayPal sandbox buyer account](https://developer.paypal.com/tools/sandbox/accounts/), then places the order and returns the receipt. It also gives you a dashboard link that shows every step it took.

| Tool | What the agent uses it for |
|---|---|
| `list_products` | See what the store sells and the prices |
| `create_checkout` | Start an ACP checkout session with items and quantities (issues a sandbox key if needed) |
| `update_checkout` | Change the cart — any PayPal order for the old total is dropped |
| `request_paypal_payment` | Create the PayPal order for the exact total; returns the approval link for the human |
| `wait_for_payment_approval` | Wait (≤45 s per call) until PayPal confirms the buyer approved |
| `complete_checkout` | Capture the payment and place the order — fails unless PayPal confirms the money |
| `get_checkout` / `cancel_checkout` | Check status, or back out |

## REST quickstart

1. Get a test API key (no signup — this is a sandbox):

```bash
curl -X POST https://acp-sandbox.flo-voice1.com/keys \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com"}'
# => {"api_key":"acps_test_..."}
```

2. See what you can buy:

```bash
curl https://acp-sandbox.flo-voice1.com/catalog
```

3. Create a checkout session:

```bash
curl -X POST https://acp-sandbox.flo-voice1.com/checkout_sessions \
  -H "Authorization: Bearer acps_test_..." \
  -H "Content-Type: application/json" \
  -d '{"line_items": [{"id": "item_demo_mug", "quantity": 1}, {"id": "item_demo_notebook", "quantity": 2}]}'
```

4. Pay with PayPal (sandbox) — create the PayPal order, have the buyer approve it, then complete:

```bash
curl -X POST https://acp-sandbox.flo-voice1.com/checkout_sessions/{id}/paypal_order \
  -H "Authorization: Bearer acps_test_..."
# => session with payment.approve_url — open it and approve with a sandbox buyer account

curl -X POST https://acp-sandbox.flo-voice1.com/checkout_sessions/{id}/complete \
  -H "Authorization: Bearer acps_test_..." \
  -H "Content-Type: application/json" \
  -d '{"payment_data": {"provider": "paypal", "order_id": "<payment.paypal_order_id>"}}'
# => status "completed", payment.status "captured", order with a receipt permalink
```

Errors you can test against: `422 payment_not_approved` (buyer hasn't approved), `422 unknown_payment` (an order id this session didn't create), cart changed after the PayPal order (the old order is dropped — create a new one). Any other `payment_data` keeps the original mock behaviour (accepted as paid, nothing processed) for quick happy-path runs.

5. Inspect what your agent sent: `GET /logs` with your key, or open the [dashboard](https://acp-sandbox.flo-voice1.com/dashboard).

## Endpoints

| Method | Path | Description |
|---|---|---|
| POST | `/keys` | Issue a test API key |
| GET | `/catalog` | Demo items you can reference in `line_items` |
| POST | `/checkout_sessions` | Create a session |
| GET | `/checkout_sessions/{id}` | Retrieve a session |
| POST | `/checkout_sessions/{id}` | Update a session (line items, buyer, fulfillment) |
| POST | `/checkout_sessions/{id}/paypal_order` | Create the PayPal (sandbox) order for the session total; returns the buyer's approval link |
| POST | `/checkout_sessions/{id}/complete` | Finalize checkout (captures the PayPal payment when `provider: "paypal"`), creates an `order` |
| POST | `/checkout_sessions/{id}/cancel` | Cancel a session |
| GET | `/orders/{id}` | Order receipt (the `order.permalink_url`) |
| GET | `/logs` | Last 50 requests made with your key, plus each session's current state |
| GET | `/dashboard` | The same, in a browser, grouped by checkout session |
| POST | `/mcp` | Hosted MCP server (Streamable HTTP) |
| GET | `/paypal/return`, `/paypal/cancel` | Where PayPal sends the buyer back |

Responses follow the ACP `CheckoutSession` / `Order` / `Error` schemas (2026-04-17 spec version) for the fields this sandbox supports. Fields out of scope (discounts, fulfillment options, …) are omitted rather than faked. `payment` on a session is this sandbox's own record of the PayPal payment, not an ACP field.

## How the PayPal payment works

1. `paypal_order` calls PayPal `POST /v2/checkout/orders` (intent `CAPTURE`) with the session's line items and exact total, `custom_id` = the checkout session id, and a `PayPal-Request-Id` so retrying for the same cart returns the same order.
2. The buyer approves on PayPal and lands on `/paypal/return`; the sandbox asks PayPal to confirm the order is `APPROVED` before recording it (the query string alone proves nothing). `wait_for_payment_approval` also asks PayPal directly, so approval counts even if the buyer never reaches the return page.
3. `complete` checks the order id is the one created for this session and that the cart total hasn't changed, then calls `POST /v2/checkout/orders/{id}/capture` (idempotent via `PayPal-Request-Id`). The session is marked paid only if the order and the capture are `COMPLETED` for the expected amount, currency and `custom_id`.

## Known limitations

- PayPal **sandbox** only — never real money. Other payment methods are mocked.
- No OAuth `delegate_authentication` flow.
- No fulfillment options (shipping/pickup) — sessions go straight to `ready_for_payment`.
- Fixed demo catalog, not a real product feed.

## Run it yourself

```bash
npm install
npm run build && npm start   # http://127.0.0.1:3900  (or: npm run dev)
```

For PayPal, create a sandbox REST app at [developer.paypal.com](https://developer.paypal.com/dashboard/applications/sandbox) and put its keys in `./.env` (loaded at startup, never committed):

```
PAYPAL_CLIENT_ID=...
PAYPAL_CLIENT_SECRET=...
# optional: PUBLIC_BASE_URL=http://127.0.0.1:3900  (where PayPal sends the buyer back)
```

Without them, everything works except the PayPal routes, which return `503 paypal_not_configured`. Storage is Node's built-in `node:sqlite` (Node 22+, no native dependencies) in `./data/acp-sandbox.db`.

## License

MIT — see [LICENSE](LICENSE).
