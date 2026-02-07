import { loadConfig } from "../config.js";
import { runMigrations } from "./client.js";

const config = loadConfig();
await runMigrations(config.DATABASE_URL);
