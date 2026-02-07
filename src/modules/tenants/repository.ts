import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { tenants } from "../../db/schema.js";

export function hashApiKey(apiKey: string) {
  return createHash("sha256").update(apiKey).digest("hex");
}

export async function createTenant(db: Database, name: string) {
  const apiKey = `whd_${randomBytes(24).toString("base64url")}`;
  const [tenant] = await db
    .insert(tenants)
    .values({ name, apiKeyHash: hashApiKey(apiKey) })
    .returning({ id: tenants.id, name: tenants.name });
  return { tenant: tenant!, apiKey };
}

export async function findTenantByApiKey(db: Database, apiKey: string) {
  const [tenant] = await db
    .select({ id: tenants.id, name: tenants.name })
    .from(tenants)
    .where(eq(tenants.apiKeyHash, hashApiKey(apiKey)));
  return tenant;
}
