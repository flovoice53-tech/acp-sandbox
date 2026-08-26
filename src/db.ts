import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const DB_PATH = process.env.DB_PATH ?? "./data/acp-sandbox.db";
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL;");

db.exec(`
  CREATE TABLE IF NOT EXISTS api_keys (
    key TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS checkout_sessions (
    id TEXT PRIMARY KEY,
    api_key TEXT NOT NULL,
    status TEXT NOT NULL,
    currency TEXT NOT NULL,
    data TEXT NOT NULL,
    order_data TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS request_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    api_key TEXT,
    checkout_session_id TEXT,
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    request_body TEXT,
    response_status INTEGER,
    response_body TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_request_log_api_key ON request_log(api_key);
  CREATE INDEX IF NOT EXISTS idx_request_log_session ON request_log(checkout_session_id);
`);
