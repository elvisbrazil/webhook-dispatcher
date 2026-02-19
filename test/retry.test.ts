import { describe, expect, it } from "vitest";
import { backoffDelay, decide, type RetryPolicy } from "../src/webhooks/retry.js";

const policy: RetryPolicy = { maxAttempts: 5, baseDelayMs: 1000, maxDelayMs: 60_000 };
const noJitter = { random: () => 1 };

describe("backoffDelay", () => {
  it("doubles the delay on every attempt", () => {
    expect([1, 2, 3, 4].map((n) => backoffDelay(n, policy, () => 1))).toEqual([
      1000, 2000, 4000, 8000,
    ]);
  });

  it("applies jitter between half and the full delay", () => {
    expect(backoffDelay(3, policy, () => 0)).toBe(2000);
    expect(backoffDelay(3, policy, () => 0.5)).toBe(3000);
  });

  it("never exceeds the max delay", () => {
    expect(backoffDelay(20, policy, () => 1)).toBe(60_000);
  });
});

describe("decide", () => {
  it("succeeds on 2xx", () => {
    expect(decide({ kind: "response", status: 204 }, 1, policy)).toEqual({ action: "succeed" });
  });

  it.each([400, 401, 404, 410, 422])("fails permanently on %i", (status) => {
    expect(decide({ kind: "response", status }, 1, policy)).toEqual({
      action: "fail",
      reason: `HTTP ${status}`,
    });
  });

  it.each([408, 429, 500, 502, 503])("retries on %i", (status) => {
    expect(decide({ kind: "response", status }, 1, policy, noJitter)).toEqual({
      action: "retry",
      delayMs: 1000,
      reason: `HTTP ${status}`,
    });
  });

  it("does not follow redirects", () => {
    expect(decide({ kind: "response", status: 301 }, 1, policy).action).toBe("fail");
  });

  it("retries network errors and timeouts", () => {
    expect(decide({ kind: "error", message: "timeout" }, 2, policy, noJitter)).toEqual({
      action: "retry",
      delayMs: 2000,
      reason: "timeout",
    });
  });

  it("gives up after the last attempt", () => {
    expect(decide({ kind: "response", status: 500 }, 5, policy)).toEqual({
      action: "fail",
      reason: "HTTP 500 after 5 attempts",
    });
  });

  it("uses Retry-After seconds on 429", () => {
    const decision = decide({ kind: "response", status: 429, retryAfter: "30" }, 1, policy);
    expect(decision).toEqual({ action: "retry", delayMs: 30_000, reason: "HTTP 429" });
  });

  it("caps Retry-After at the max delay", () => {
    const decision = decide({ kind: "response", status: 429, retryAfter: "3600" }, 1, policy);
    expect(decision).toMatchObject({ delayMs: 60_000 });
  });

  it("falls back to backoff when Retry-After is invalid", () => {
    const decision = decide(
      { kind: "response", status: 429, retryAfter: "soon" },
      2,
      policy,
      noJitter,
    );
    expect(decision).toMatchObject({ delayMs: 2000 });
  });
});
