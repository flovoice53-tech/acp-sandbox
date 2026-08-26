# acp-sandbox

A hosted mock merchant implementing the [Agentic Commerce Protocol](https://github.com/agentic-commerce-protocol/agentic-commerce-protocol) (ACP) checkout API — for testing AI shopping-agent integrations end to end without real money, a real store, or real buyer data.

Live at **https://acp-sandbox.flo-voice1.com**

## Why

ACP defines how a shopping agent talks to a merchant to complete a purchase. Stripe's own test mode covers the *payment* side (test cards, test API keys), but there's no hosted "fake merchant" a third-party agent developer can point their code at to verify their ACP client logic actually works — creating a session, updating it, completing checkout, handling errors. This fills that gap.

**v1 scope**: checkout session lifecycle only (create / retrieve / update / complete / cancel), against a small static demo catalog. Payment is stubbed — any `payment_data` you send is accepted and the session is marked paid. OAuth delegated-authentication is not implemented in v1.

## Quickstart

1. Get a test API key (no signup, no email verification — this is a sandbox):

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
  -d '{
    "line_items": [{"id": "item_demo_headphones", "quantity": 1}],
    "currency": "usd",
    "buyer": {"email": "buyer@example.com"}
  }'
```

4. Complete it (any payment_data is accepted):

```bash
curl -X POST https://acp-sandbox.flo-voice1.com/checkout_sessions/{id}/complete \
  -H "Authorization: Bearer acps_test_..." \
  -H "Content-Type: application/json" \
  -d '{"payment_data": {"handler_id": "test", "instrument": {"type": "card", "credential": {"type": "spt", "token": "tok_test"}}}}'
```

5. Inspect what your agent actually sent:

```bash
curl https://acp-sandbox.flo-voice1.com/logs -H "Authorization: Bearer acps_test_..."
```

## Endpoints

| Method | Path | Description |
|---|---|---|
| POST | `/keys` | Issue a test API key |
| GET | `/catalog` | List demo items you can reference in `line_items` |
| POST | `/checkout_sessions` | Create a session |
| GET | `/checkout_sessions/{id}` | Retrieve a session |
| POST | `/checkout_sessions/{id}` | Update a session (line items, buyer, fulfillment) |
| POST | `/checkout_sessions/{id}/complete` | Finalize checkout, creates an `order` |
| POST | `/checkout_sessions/{id}/cancel` | Cancel a session |
| GET | `/logs` | Last 50 requests made with your key |

Responses follow the real ACP `CheckoutSession` / `Order` / `Error` schemas (2026-04-17 spec version) for the fields this sandbox supports. Fields outside v1 scope (discounts, fulfillment options, marketplace details, etc.) are simply omitted rather than faked.

## Known v1 limitations

- No real payment processing — `complete` always succeeds.
- No OAuth `delegate_authentication` flow.
- No fulfillment options (shipping/pickup) — sessions go straight to `ready_for_payment`.
- Fixed demo catalog, not a real product feed.

## Local development

```bash
npm install
npm run dev   # tsx watch, http://localhost:3900
```

Uses Node's built-in `node:sqlite` (no native dependencies) for storage — data persists in `./data/acp-sandbox.db`.
