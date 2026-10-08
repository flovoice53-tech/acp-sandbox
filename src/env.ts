// Imported first by index.ts. Loads ./.env (server-only, never in git) into
// process.env when it exists — that's where the PayPal sandbox keys live.
import { existsSync } from "node:fs";

const ENV_FILE = process.env.ENV_FILE ?? "./.env";
if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);
