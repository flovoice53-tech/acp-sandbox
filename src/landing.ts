// Landing page served at GET /. Kept as one self-contained HTML string
// (inline CSS, no assets, no build step) so it ships with the API and has
// nothing to deploy separately. Doubles as the search-landing page for
// people looking for a way to test an Agentic Commerce Protocol client.

const BASE = "https://acp-sandbox.flo-voice1.com";

export const LANDING_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>acp-sandbox — test your Agentic Commerce Protocol (ACP) integration</title>
<meta name="description" content="A hosted mock merchant that implements the Agentic Commerce Protocol checkout API, with real PayPal sandbox payments and a hosted MCP server so any AI agent can shop and pay. No signup, no real money.">
<link rel="canonical" href="${BASE}/">
<meta property="og:type" content="website">
<meta property="og:title" content="acp-sandbox — test your Agentic Commerce Protocol integration">
<meta property="og:description" content="A hosted mock ACP merchant for testing AI shopping-agent checkouts end to end. No signup, no real money.">
<meta property="og:url" content="${BASE}/">
<meta name="twitter:card" content="summary">
<style>
  :root{ color-scheme: light dark; --fg:#1a1a1a; --bg:#fbfbf9; --muted:#5c5c5c; --line:#e3e3dd; --accent:#b3401f; --code-bg:#f2f1ec; }
  @media (prefers-color-scheme: dark){ :root{ --fg:#e8e8e3; --bg:#161613; --muted:#a0a09a; --line:#33332e; --accent:#e0805f; --code-bg:#22221e; } }
  *{box-sizing:border-box}
  body{margin:0;font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--fg);background:var(--bg)}
  .wrap{max-width:760px;margin:0 auto;padding:48px 22px 80px}
  h1{font-size:30px;line-height:1.25;margin:0 0 12px;letter-spacing:-.01em}
  h2{font-size:19px;margin:40px 0 12px;letter-spacing:-.01em}
  p{margin:0 0 16px}
  a{color:var(--accent)}
  .lead{font-size:18px;color:var(--muted)}
  code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13.5px;background:var(--code-bg);padding:.12em .35em;border-radius:4px}
  pre{background:var(--code-bg);border:1px solid var(--line);border-radius:8px;padding:14px 16px;overflow-x:auto;font-size:13px;line-height:1.55}
  pre code{background:none;padding:0;font-size:13px}
  table{border-collapse:collapse;width:100%;font-size:14px;margin:0 0 16px}
  th,td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line);vertical-align:top}
  th{font-weight:600}
  td code{font-size:12.5px}
  ul{margin:0 0 16px;padding-left:22px}
  li{margin:4px 0}
  .tag{display:inline-block;font-size:12px;color:var(--muted);border:1px solid var(--line);border-radius:100px;padding:2px 10px;margin:0 6px 6px 0}
  footer{margin-top:56px;padding-top:20px;border-top:1px solid var(--line);font-size:13px;color:var(--muted)}
</style>
</head>
<body>
<div class="wrap">

<h1>Test your Agentic Commerce Protocol integration</h1>
<p class="lead">acp-sandbox is a hosted mock merchant that speaks the <a href="https://github.com/agentic-commerce-protocol/agentic-commerce-protocol">Agentic Commerce Protocol</a> checkout API. Point your ACP client or shopping agent at it and exercise the full session lifecycle — create, retrieve, update, complete, cancel — without real money, a real store, or real buyer data.</p>

<p>
  <span class="tag">no signup</span>
  <span class="tag">real PayPal sandbox payments</span>
  <span class="tag">hosted MCP server</span>
  <span class="tag">no real charges</span>
  <span class="tag">open source</span>
</p>

<h2>Let an AI agent shop — and pay with PayPal</h2>
<p>acp-sandbox is also a hosted MCP server. Connect any MCP client (Claude, Cursor, …) to it and the agent gets tools to browse the catalog, build a cart, ask you to pay with PayPal, and place the order. You stay in control of the money: the agent can only hand you a PayPal approval link — the payment is captured only after you approve it on PayPal, and only for the exact cart total.</p>
<pre><code>MCP server URL:  ${BASE}/mcp
Auth:            none (a sandbox key is created on the first checkout)</code></pre>
<p>In Claude: <em>Settings → Connectors → Add custom connector</em>, paste the URL, then ask: <em>“Buy me a demo mug and two notebooks from the acp-sandbox store and pay with PayPal.”</em> Approve the payment with a <a href="https://developer.paypal.com/tools/sandbox/accounts/">PayPal sandbox buyer account</a>. The agent gives you a dashboard link where every step it took is logged.</p>
<table>
<tr><th>Tool</th><th>What the agent uses it for</th></tr>
<tr><td><code>list_products</code></td><td>See what the store sells and the prices</td></tr>
<tr><td><code>create_checkout</code> / <code>update_checkout</code></td><td>Build or change the cart (an ACP checkout session)</td></tr>
<tr><td><code>request_paypal_payment</code></td><td>Create a PayPal order for the exact total and get the approval link for the human</td></tr>
<tr><td><code>wait_for_payment_approval</code></td><td>Wait until PayPal confirms the buyer approved</td></tr>
<tr><td><code>complete_checkout</code></td><td>Capture the payment and place the order — fails unless PayPal confirms the money</td></tr>
<tr><td><code>get_checkout</code> / <code>cancel_checkout</code></td><td>Check status, or back out</td></tr>
</table>

<h2>The gap this fills</h2>
<p>ACP defines how a shopping agent talks to a merchant to complete a purchase. Payment sandboxes such as PayPal's cover the <em>payment</em> side, but there is no hosted "fake merchant" you can point a third-party ACP client at to check that your own logic actually works: building a session, patching line items, handling a <code>422</code>, reading back an <code>Order</code>. acp-sandbox is that merchant, with a real PayPal sandbox payment behind every checkout.</p>

<h2>Quickstart</h2>
<p>1 — get a test key (this is a sandbox, so the key is issued on the spot):</p>
<pre><code>curl -X POST ${BASE}/keys \\
  -H "Content-Type: application/json" \\
  -d '{"email":"you@example.com"}'
# =&gt; {"api_key":"acps_test_..."}</code></pre>

<p>2 — see what you can buy:</p>
<pre><code>curl ${BASE}/catalog</code></pre>

<p>3 — create a checkout session:</p>
<pre><code>curl -X POST ${BASE}/checkout_sessions \\
  -H "Authorization: Bearer acps_test_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "line_items": [{"id": "item_demo_headphones", "quantity": 1}],
    "currency": "usd",
    "buyer": {"email": "buyer@example.com"}
  }'</code></pre>

<p>4 — pay with PayPal (sandbox): create the PayPal order, have the buyer approve it at <code>payment.approve_url</code>, then complete with that order id:</p>
<pre><code>curl -X POST ${BASE}/checkout_sessions/{id}/paypal_order \\
  -H "Authorization: Bearer acps_test_..."
# =&gt; session with payment.approve_url (open it, approve with a sandbox buyer)

curl -X POST ${BASE}/checkout_sessions/{id}/complete \\
  -H "Authorization: Bearer acps_test_..." \\
  -H "Content-Type: application/json" \\
  -d '{"payment_data": {"provider": "paypal", "order_id": "&lt;payment.paypal_order_id&gt;"}}'</code></pre>
<p>The order is placed only if PayPal reports the capture <code>COMPLETED</code> for the session's exact amount. Not approved yet → <code>422 payment_not_approved</code>; cart changed after the PayPal order was made → the old order is dropped and you create a new one. Any other <code>payment_data</code> keeps the old mock behaviour (accepted as paid, no processing) for quick happy-path tests.</p>

<p>5 — inspect exactly what your agent sent:</p>
<pre><code>curl ${BASE}/logs -H "Authorization: Bearer acps_test_..."</code></pre>
<p>Or open the <a href="/dashboard">dashboard</a> and paste your key to see each checkout session with every request and response.</p>

<h2>Endpoints</h2>
<table>
<tr><th>Method</th><th>Path</th><th>Description</th></tr>
<tr><td>POST</td><td><code>/keys</code></td><td>Issue a test API key</td></tr>
<tr><td>GET</td><td><code>/catalog</code></td><td>Demo items you can reference in <code>line_items</code></td></tr>
<tr><td>POST</td><td><code>/checkout_sessions</code></td><td>Create a session</td></tr>
<tr><td>GET</td><td><code>/checkout_sessions/{id}</code></td><td>Retrieve a session</td></tr>
<tr><td>POST</td><td><code>/checkout_sessions/{id}</code></td><td>Update a session (line items, buyer, fulfillment)</td></tr>
<tr><td>POST</td><td><code>/checkout_sessions/{id}/paypal_order</code></td><td>Create the PayPal (sandbox) order for the session total; returns the buyer's approval link</td></tr>
<tr><td>POST</td><td><code>/checkout_sessions/{id}/complete</code></td><td>Finalize checkout (captures the PayPal payment if <code>provider: "paypal"</code>), creates an <code>order</code></td></tr>
<tr><td>POST</td><td><code>/checkout_sessions/{id}/cancel</code></td><td>Cancel a session</td></tr>
<tr><td>GET</td><td><code>/logs</code></td><td>Last 50 requests made with your key, plus each session's current state</td></tr>
<tr><td>POST</td><td><code>/mcp</code></td><td>Hosted MCP server (Streamable HTTP) — the same checkout as agent tools</td></tr>
</table>
<p>Responses follow the real ACP <code>CheckoutSession</code> / <code>Order</code> / <code>Error</code> schemas (2026-04-17 spec version) for the fields v1 supports. Out-of-scope fields are omitted, not faked.</p>

<h2>What v1 does not do</h2>
<ul>
<li>Payments are PayPal <em>sandbox</em> only — never real money. Other payment methods are mocked.</li>
<li>No OAuth <code>delegate_authentication</code> flow.</li>
<li>No fulfillment options (shipping / pickup) — sessions go straight to <code>ready_for_payment</code>.</li>
<li>Fixed demo catalog, not a real product feed.</li>
</ul>

<h2>Source &amp; more</h2>
<ul>
<li>Code + full docs: <a href="https://gitlab.com/florin-builds/acp-sandbox">gitlab.com/florin-builds/acp-sandbox</a></li>
<li>ACP specification: <a href="https://github.com/agentic-commerce-protocol/agentic-commerce-protocol">agentic-commerce-protocol/agentic-commerce-protocol</a></li>
<li>Ranked #2 on TinyLaunch: <a href="https://tinylaunch.com/launch/24070-acp-sandbox">launch page</a></li>
</ul>

<footer>
<p><a href="https://tinylaunch.com/launch/24070-acp-sandbox" target="_blank" rel="noopener"><img src="/tinylaunch-badge.svg" alt="TinyLaunch 2nd Place badge" width="202" height="61" style="height:auto"></a></p>
acp-sandbox is an independent testing tool, not affiliated with OpenAI or Stripe. Built by the team behind <a href="https://flo-voice1.com">flo-voice1.com</a>. <a href="/privacy">Privacy</a>.
</footer>

</div>
</body>
</html>`;

// Order confirmation page — this is what order.permalink_url (returned by
// POST /checkout_sessions/{id}/complete) resolves to when opened in a browser.
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function orderHtml(order: {
  id: string;
  order_number: string;
  status: string;
  line_items: { name?: string; quantity: number; unit_amount?: number }[];
  totals: { type: string; display_text: string; amount: number }[];
}): string {
  const rows = order.line_items
    .map(
      (li) =>
        `<tr><td>${escapeHtml(li.name ?? "")}</td><td>${li.quantity}</td><td>${((li.unit_amount ?? 0) / 100).toFixed(2)}</td></tr>`,
    )
    .join("\n");
  const totalRows = order.totals
    .map((t) => `<tr><td>${escapeHtml(t.display_text)}</td><td>${(t.amount / 100).toFixed(2)}</td></tr>`)
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Order ${escapeHtml(order.order_number)} — acp-sandbox</title>
<meta name="robots" content="noindex">
<style>
  :root{ color-scheme: light dark; --fg:#1a1a1a; --bg:#fbfbf9; --muted:#5c5c5c; --line:#e3e3dd; --accent:#b3401f; }
  @media (prefers-color-scheme: dark){ :root{ --fg:#e8e8e3; --bg:#161613; --muted:#a0a09a; --line:#33332e; --accent:#e0805f; } }
  *{box-sizing:border-box}
  body{margin:0;font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--fg);background:var(--bg)}
  .wrap{max-width:600px;margin:0 auto;padding:48px 22px 80px}
  h1{font-size:24px;margin:0 0 4px}
  .status{display:inline-block;font-size:12px;color:var(--accent);border:1px solid var(--line);border-radius:100px;padding:2px 10px;margin:8px 0 24px}
  table{border-collapse:collapse;width:100%;font-size:14px;margin:0 0 24px}
  th,td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line)}
  td:last-child,th:last-child{text-align:right}
  a{color:var(--accent)}
</style>
</head>
<body>
<div class="wrap">
<h1>Order ${escapeHtml(order.order_number)}</h1>
<span class="status">${escapeHtml(order.status)}</span>
<table>
<tr><th>Item</th><th>Qty</th><th>Amount</th></tr>
${rows}
</table>
<table>
${totalRows}
</table>
<p><a href="/">acp-sandbox</a> — this is a mock order from a test sandbox, not a real purchase.</p>
<p><a href="https://tinylaunch.com/launch/24070-acp-sandbox" target="_blank" rel="noopener"><img src="/tinylaunch-badge.svg" alt="TinyLaunch 2nd Place badge" width="202" height="61" style="height:auto"></a></p>
</div>
</body>
</html>`;
}

// Where the buyer lands after approving (or canceling) the PayPal payment.
// The agent, not this page, completes the checkout — this just tells the
// human their part is done.
export function paypalReturnHtml(state: { approved: boolean; sessionId?: string; canceled?: boolean } | null): string {
  const heading = !state
    ? "Unknown PayPal order"
    : state.canceled
      ? "Payment canceled"
      : state.approved
        ? "Payment approved"
        : "Payment not approved yet";
  const body = !state
    ? "This PayPal order isn't linked to a checkout session on this sandbox."
    : state.canceled
      ? "No payment was taken. Your agent can create a new PayPal order if you want to try again."
      : state.approved
        ? "Thanks — you can close this tab. Your shopping agent can now complete the checkout; the payment is captured only when it does."
        : "PayPal hasn't confirmed the approval. Go back to PayPal and approve the payment, or ask your agent for a new link.";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${heading} — acp-sandbox</title>
<meta name="robots" content="noindex">
<style>
  :root{ color-scheme: light dark; --fg:#1a1a1a; --bg:#fbfbf9; --muted:#5c5c5c; --line:#e3e3dd; --accent:#b3401f; }
  @media (prefers-color-scheme: dark){ :root{ --fg:#e8e8e3; --bg:#161613; --muted:#a0a09a; --line:#33332e; --accent:#e0805f; } }
  body{margin:0;font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--fg);background:var(--bg)}
  .wrap{max-width:600px;margin:0 auto;padding:48px 22px 80px}
  h1{font-size:24px;margin:0 0 12px}
  p{color:var(--muted)}
  code{font-size:14px}
  a{color:var(--accent)}
</style>
</head>
<body>
<div class="wrap">
<h1>${heading}</h1>
<p>${body}</p>
${state?.sessionId ? `<p>Checkout session: <code>${escapeHtml(state.sessionId)}</code> — follow it on the <a href="/dashboard">dashboard</a>.</p>` : ""}
<p><a href="/">acp-sandbox</a> — PayPal sandbox payment, no real money.</p>
<p><a href="https://tinylaunch.com/launch/24070-acp-sandbox" target="_blank" rel="noopener"><img src="/tinylaunch-badge.svg" alt="TinyLaunch 2nd Place badge" width="202" height="61" style="height:auto"></a></p>
</div>
</body>
</html>`;
}


// Privacy policy, required for the Claude connector directory listing. States
// only what the code actually does: the sandbox keeps keys, emails and request
// logs in its database and has no automatic deletion.
export const PRIVACY_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Privacy policy — acp-sandbox</title>
<link rel="canonical" href="${BASE}/privacy">
<style>
  :root{ color-scheme: light dark; --fg:#1a1a1a; --bg:#fbfbf9; --muted:#5c5c5c; --accent:#b3401f; }
  @media (prefers-color-scheme: dark){ :root{ --fg:#e8e8e3; --bg:#161613; --muted:#a0a09a; --accent:#e0805f; } }
  body{margin:0;font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--fg);background:var(--bg)}
  .wrap{max-width:680px;margin:0 auto;padding:40px 20px}
  a{color:var(--accent)} h1{font-size:28px} h2{font-size:18px;margin-top:28px}
</style>
</head>
<body>
<div class="wrap">
<h1>Privacy policy</h1>
<p>acp-sandbox is a test sandbox that imitates a merchant implementing the Agentic Commerce Protocol. It is operated by Flovoice SRL (Romania). No real money moves: payments go through PayPal's sandbox (test) environment only.</p>

<h2>What we collect</h2>
<ul>
<li><strong>Sandbox API key and email.</strong> When a key is issued, we store the key and the email you provided. If you give none, a placeholder address is stored.</li>
<li><strong>Request logs.</strong> For each call (REST or MCP tool) we store your key, the endpoint or tool name, the request body, the response status and the response body, so the dashboard can show your checkout steps.</li>
<li><strong>Checkout data.</strong> The carts, buyer email (if you pass one) and test order data you create.</li>
<li>Standard web-server logs (IP address, time, URL) are kept by our web server.</li>
</ul>
<p>We do not collect payment card numbers or real personal payment data. Do not send real personal data to this sandbox.</p>

<h2>How it is used</h2>
<p>Only to run the sandbox and show you your own request log. We do not sell data, do not use it for advertising and do not share it with third parties, except PayPal's sandbox, which receives the order amount and reference needed to create a test payment.</p>

<h2>Storage and retention</h2>
<p>Data is stored in a database on our server in the EU. There is no automatic deletion at the moment: data is kept until you ask us to delete it.</p>

<h2>Your rights and contact</h2>
<p>To access or delete the data tied to your sandbox key or email, write to <a href="mailto:florin@flo-voice.com">florin@flo-voice.com</a> with your key or email address. Under the GDPR you may also lodge a complaint with your national data protection authority.</p>

<p><a href="/">Back to acp-sandbox</a></p>
<p><a href="https://tinylaunch.com/launch/24070-acp-sandbox" target="_blank" rel="noopener"><img src="/tinylaunch-badge.svg" alt="TinyLaunch 2nd Place badge" width="202" height="61" style="height:auto"></a></p>
</div>
</body>
</html>`;
