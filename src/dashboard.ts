// GET /dashboard — a browser view of the same data /logs returns, grouped
// into checkout sessions, so a developer can see what their agent sent and
// what the sandbox answered at each step without curl + jq. Asked for by the
// first outside user (2026-09-25).
//
// The page is static: the API key is typed in, kept only in sessionStorage
// (gone when the tab closes, never in the URL), and sent as a bearer header
// to /logs. Everything from the log is rendered with textContent, never
// innerHTML — request bodies are whatever an agent sent.
export const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dashboard — acp-sandbox</title>
<meta name="robots" content="noindex">
<style>
  :root{ color-scheme: light dark; --fg:#1a1a1a; --bg:#fbfbf9; --muted:#5c5c5c; --line:#e3e3dd; --accent:#b3401f; --code-bg:#f2f1ec; --ok:#2f7d32; --warn:#b26a00; --bad:#b3261e; }
  @media (prefers-color-scheme: dark){ :root{ --fg:#e8e8e3; --bg:#161613; --muted:#a0a09a; --line:#33332e; --accent:#e0805f; --code-bg:#22221e; --ok:#7cc47f; --warn:#e0a24f; --bad:#ef8a80; } }
  *{box-sizing:border-box}
  body{margin:0;font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--fg);background:var(--bg)}
  .wrap{max-width:900px;margin:0 auto;padding:40px 22px 80px}
  h1{font-size:26px;margin:0 0 6px}
  h2{font-size:17px;margin:0}
  a{color:var(--accent)}
  .muted{color:var(--muted);font-size:14px}
  form{display:flex;gap:8px;flex-wrap:wrap;margin:20px 0 8px}
  input{flex:1 1 320px;min-width:0;font:14px ui-monospace,SFMono-Regular,Menlo,monospace;padding:9px 11px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--fg)}
  button{font:inherit;font-size:14px;padding:9px 16px;border-radius:8px;border:1px solid var(--line);background:var(--code-bg);color:var(--fg);cursor:pointer}
  button.primary{background:var(--accent);border-color:var(--accent);color:#fff}
  .session{border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin:14px 0}
  .head{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}
  .pill{font-size:12px;border-radius:100px;padding:1px 9px;border:1px solid currentColor}
  .ok{color:var(--ok)} .warn{color:var(--warn)} .bad{color:var(--bad)}
  details{margin-top:8px;border-top:1px solid var(--line);padding-top:6px}
  summary{cursor:pointer;font:13px ui-monospace,SFMono-Regular,Menlo,monospace}
  pre{background:var(--code-bg);border:1px solid var(--line);border-radius:8px;padding:10px 12px;overflow-x:auto;font-size:12.5px;line-height:1.5;margin:6px 0}
  .label{font-size:12px;color:var(--muted);margin-top:8px}
  #status{min-height:1.4em}
</style>
</head>
<body>
<div class="wrap">
  <h1>Dashboard</h1>
  <p class="muted">Your checkout sessions and every request your agent sent, with the sandbox's response. Paste the test key you got from <code>POST /keys</code>. It stays in this tab only. Agents connected over MCP hand you a link with the key already in it. <a href="/">Back to acp-sandbox</a></p>
  <form id="keyform">
    <input id="key" type="password" autocomplete="off" spellcheck="false" placeholder="acps_test_..." aria-label="API key">
    <button class="primary" type="submit">Show</button>
    <button id="refresh" type="button" hidden>Refresh</button>
    <button id="forget" type="button" hidden>Forget key</button>
  </form>
  <p id="status" class="muted"></p>
  <div id="out"></div>
</div>
<script>
(function () {
  var KEY_STORE = "acps_dashboard_key";
  var form = document.getElementById("keyform");
  var input = document.getElementById("key");
  var status = document.getElementById("status");
  var out = document.getElementById("out");
  var refresh = document.getElementById("refresh");
  var forget = document.getElementById("forget");

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function pretty(raw) {
    try { return JSON.stringify(JSON.parse(raw), null, 2); } catch (e) { return String(raw); }
  }

  function parse(raw) {
    try { return JSON.parse(raw); } catch (e) { return null; }
  }

  function statusClass(code) {
    return code < 300 ? "ok" : code < 500 ? "warn" : "bad";
  }

  function requestBlock(r) {
    var d = el("details");
    var line = r.method + " " + r.path + " \\u2192 " + r.response_status + "   " + r.created_at + " UTC";
    var s = el("summary", statusClass(r.response_status), line);
    d.appendChild(s);
    d.appendChild(el("div", "label", "Request body"));
    d.appendChild(el("pre", "", pretty(r.request_body)));
    d.appendChild(el("div", "label", "Response"));
    d.appendChild(el("pre", "", pretty(r.response_body)));
    return d;
  }

  var PAYMENT_TEXT = { awaiting_approval: "PayPal: waiting for buyer approval", approved: "PayPal: approved, not captured yet", captured: "PayPal: paid" };
  var PAYMENT_CLASS = { awaiting_approval: "warn", approved: "warn", captured: "ok" };

  function render(requests, sessionsNow) {
    sessionsNow = sessionsNow || {};
    out.textContent = "";
    if (!requests.length) {
      status.textContent = "No requests yet for this key. Create a checkout session and refresh.";
      return;
    }
    // /logs is newest first; show each session's steps in the order they happened.
    var sessions = {};
    var order = [];
    var loose = [];
    requests.slice().reverse().forEach(function (r) {
      var id = r.checkout_session_id;
      if (!id) { loose.push(r); return; }
      if (!sessions[id]) { sessions[id] = []; order.push(id); }
      sessions[id].push(r);
    });
    status.textContent = order.length + " checkout session(s), " + requests.length + " request(s) (the last 50 are kept).";

    order.reverse().forEach(function (id) {
      var steps = sessions[id];
      // Prefer the session's current state from the server; fall back to the
      // last logged response for sessions older than that field.
      var latest = sessionsNow[id] || null;
      for (var i = steps.length - 1; i >= 0 && !latest; i--) {
        var body = parse(steps[i].response_body);
        if (body && body.status) latest = body;
      }
      var box = el("div", "session");
      var head = el("div", "head");
      head.appendChild(el("h2", "", id));
      if (latest) {
        var cls = latest.status === "completed" ? "ok" : latest.status === "canceled" || latest.status === "cancelled" ? "bad" : "warn";
        head.appendChild(el("span", "pill " + cls, latest.status));
        var total = (latest.totals || []).filter(function (t) { return t.type === "total"; })[0];
        if (total && typeof total.amount === "number") {
          head.appendChild(el("span", "muted", (total.amount / 100).toFixed(2) + " " + String(latest.currency || "").toUpperCase()));
        }
        var pay = latest.payment;
        if (pay && PAYMENT_TEXT[pay.status]) {
          var payText = PAYMENT_TEXT[pay.status] + (pay.capture_id ? " (capture " + pay.capture_id + ")" : "");
          head.appendChild(el("span", "pill " + PAYMENT_CLASS[pay.status], payText));
        }
        if (latest.receipt_url) {
          var a = el("a", "", "receipt " + (latest.order_number || ""));
          a.href = latest.receipt_url;
          head.appendChild(a);
        }
      }
      head.appendChild(el("span", "muted", steps.length + " request(s)"));
      box.appendChild(head);
      steps.forEach(function (r) { box.appendChild(requestBlock(r)); });
      out.appendChild(box);
    });

    if (loose.length) {
      var other = el("div", "session");
      var h = el("div", "head");
      h.appendChild(el("h2", "", "Requests without a session"));
      h.appendChild(el("span", "muted", "e.g. a create that failed validation"));
      other.appendChild(h);
      loose.reverse().forEach(function (r) { other.appendChild(requestBlock(r)); });
      out.appendChild(other);
    }
  }

  function load(key) {
    status.textContent = "Loading\\u2026";
    fetch("/logs", { headers: { Authorization: "Bearer " + key } })
      .then(function (res) {
        if (res.status === 401) throw new Error("That key isn't valid. Get one with POST /keys.");
        if (!res.ok) throw new Error("The sandbox answered " + res.status + ".");
        return res.json();
      })
      .then(function (data) {
        try { sessionStorage.setItem(KEY_STORE, key); } catch (e) {}
        refresh.hidden = false;
        forget.hidden = false;
        render(data.requests || [], data.sessions);
      })
      .catch(function (err) {
        out.textContent = "";
        status.textContent = err.message;
      });
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var key = input.value.trim();
    if (key) load(key);
  });
  refresh.addEventListener("click", function () {
    var key = input.value.trim();
    if (key) load(key);
  });
  forget.addEventListener("click", function () {
    try { sessionStorage.removeItem(KEY_STORE); } catch (e) {}
    input.value = "";
    out.textContent = "";
    status.textContent = "";
    refresh.hidden = true;
    forget.hidden = true;
  });

  // An agent can hand the user /dashboard#key=... — the fragment never
  // reaches the server. Take the key, then drop it from the address bar.
  var fromLink = /^#key=(acps_test_[A-Za-z0-9_-]+)$/.exec(location.hash);
  if (fromLink) {
    input.value = fromLink[1];
    try { history.replaceState(null, "", location.pathname); } catch (e) {}
    load(fromLink[1]);
  } else {
    try {
      var saved = sessionStorage.getItem(KEY_STORE);
      if (saved) { input.value = saved; load(saved); }
    } catch (e) {}
  }
})();
</script>
</body>
</html>`;
