import { db } from "./db.js";

// Every request an agent makes, REST or MCP, lands here — /logs and the
// dashboard read it back grouped by checkout session.
export function logRequest(opts: {
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
