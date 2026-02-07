import { parseArgs } from "node:util";
import { loadConfig } from "../config.js";
import { createDatabase } from "../db/client.js";
import { createTenant } from "../modules/tenants/repository.js";

const { positionals } = parseArgs({ allowPositionals: true });
const name = positionals[0];
if (!name) {
  process.stderr.write("usage: pnpm tenant:create <name>\n");
  process.exit(1);
}

const { db, close } = createDatabase(loadConfig().DATABASE_URL);
const { tenant, apiKey } = await createTenant(db, name);
await close();

process.stdout.write(`tenant ${tenant.id}\napi key ${apiKey}\n`);
