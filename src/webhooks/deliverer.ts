import { and, eq, sql } from "drizzle-orm";
import { request, type Dispatcher } from "undici";
import type { Database } from "../db/client.js";
import { deliveries, deliveryAttempts, endpoints, events } from "../db/schema.js";
import type { DeliveryQueue } from "../queue/port.js";
import { decide, type AttemptResult, type Decision, type RetryPolicy } from "./retry.js";
import { signedHeaders } from "./signature.js";

export type DelivererOptions = {
  db: Database;
  queue: DeliveryQueue;
  policy: RetryPolicy;
  timeoutMs: number;
  disableAfter: number;
  dispatcher?: Dispatcher;
  now?: () => Date;
  random?: () => number;
};

export type DeliveryOutcome = Decision | { action: "skipped" };

const USER_AGENT = "webhook-dispatcher/0.1";

export function createDeliverer({
  db,
  queue,
  policy,
  timeoutMs,
  disableAfter,
  dispatcher,
  now = () => new Date(),
  random = Math.random,
}: DelivererOptions) {
  async function send(url: string, headers: Record<string, string>, body: string) {
    const startedAt = performance.now();
    let result: AttemptResult;
    try {
      const res = await request(url, {
        method: "POST",
        headers,
        body,
        dispatcher,
        signal: AbortSignal.timeout(timeoutMs),
      });
      await res.body.dump();
      const retryAfter = res.headers["retry-after"];
      result = {
        kind: "response",
        status: res.statusCode,
        retryAfter: Array.isArray(retryAfter) ? retryAfter[0] : retryAfter,
      };
    } catch (error) {
      result = { kind: "error", message: describeError(error, timeoutMs) };
    }
    return { result, durationMs: Math.round(performance.now() - startedAt) };
  }

  async function load(deliveryId: string) {
    const [row] = await db
      .select({ delivery: deliveries, event: events, endpoint: endpoints })
      .from(deliveries)
      .innerJoin(events, eq(events.id, deliveries.eventId))
      .innerJoin(endpoints, eq(endpoints.id, deliveries.endpointId))
      .where(eq(deliveries.id, deliveryId));
    return row;
  }

  async function deliver(deliveryId: string): Promise<DeliveryOutcome> {
    const row = await load(deliveryId);
    if (!row || row.delivery.status !== "pending") return { action: "skipped" };

    const { delivery, event, endpoint } = row;

    if (!endpoint.enabled) {
      await db
        .update(deliveries)
        .set({ status: "failed", lastError: "endpoint disabled", updatedAt: now() })
        .where(eq(deliveries.id, delivery.id));
      return { action: "fail", reason: "endpoint disabled" };
    }

    const body = JSON.stringify({
      type: event.type,
      timestamp: event.createdAt.toISOString(),
      data: event.payload,
    });
    const headers = {
      ...signedHeaders(endpoint.secret, event.id, body, now()),
      "content-type": "application/json",
      "user-agent": USER_AGENT,
    };

    const attempt = delivery.attempts + 1;
    const { result, durationMs } = await send(endpoint.url, headers, body);
    const decision = decide(result, attempt, policy, { now: now(), random });

    const recorded = await db.transaction(async (tx) => {
      const updated = await tx
        .update(deliveries)
        .set({
          attempts: attempt,
          status: STATUS[decision.action],
          lastError: decision.action === "succeed" ? null : decision.reason,
          nextAttemptAt:
            decision.action === "retry" ? new Date(now().getTime() + decision.delayMs) : null,
          updatedAt: now(),
        })
        .where(
          and(
            eq(deliveries.id, delivery.id),
            eq(deliveries.status, "pending"),
            eq(deliveries.attempts, delivery.attempts),
          ),
        )
        .returning({ id: deliveries.id });
      if (updated.length === 0) return false;

      await tx.insert(deliveryAttempts).values({
        deliveryId: delivery.id,
        attempt,
        statusCode: result.kind === "response" ? result.status : null,
        error: result.kind === "error" ? result.message : null,
        durationMs,
      });

      if (decision.action === "succeed") {
        await tx
          .update(endpoints)
          .set({ consecutiveFailures: 0 })
          .where(eq(endpoints.id, endpoint.id));
      }

      if (decision.action === "fail") {
        await tx
          .update(endpoints)
          .set({ consecutiveFailures: sql`${endpoints.consecutiveFailures} + 1` })
          .where(eq(endpoints.id, endpoint.id));
        await tx
          .update(endpoints)
          .set({
            enabled: false,
            disabledReason: `disabled after ${disableAfter} consecutive failed deliveries`,
          })
          .where(
            and(
              eq(endpoints.id, endpoint.id),
              eq(endpoints.enabled, true),
              sql`${endpoints.consecutiveFailures} >= ${disableAfter}`,
            ),
          );
      }

      return true;
    });

    if (!recorded) return { action: "skipped" };

    if (decision.action === "retry") {
      await queue.enqueue({ deliveryId: delivery.id }, { delayMs: decision.delayMs });
    }

    return decision;
  }

  return { deliver };
}

const STATUS = {
  succeed: "succeeded",
  retry: "pending",
  fail: "failed",
} as const;

function describeError(error: unknown, timeoutMs: number) {
  if (error instanceof Error && error.name === "TimeoutError") {
    return `timeout after ${timeoutMs}ms`;
  }
  if (error instanceof Error) {
    const code = (error as { code?: string }).code;
    return code ? `${code}: ${error.message}` : error.message;
  }
  return String(error);
}
