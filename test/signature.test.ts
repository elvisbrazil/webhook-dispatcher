import { describe, expect, it } from "vitest";
import { sign, signedHeaders, verify } from "../src/webhooks/signature.js";

const secret = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
const body = JSON.stringify({ type: "order.created", data: { id: 42 } });
const now = new Date("2026-02-14T12:00:00Z");

describe("signature", () => {
  it("matches the Standard Webhooks reference vector", () => {
    const signature = sign(
      secret,
      "msg_p5jXN8AQM9LWM0D4loKWxJek",
      1614265330,
      '{"test": 2432232314}',
    );
    expect(signature).toBe("v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=");
  });

  it("produces the three webhook headers", () => {
    const headers = signedHeaders(secret, "evt_1", body, now);
    expect(headers["webhook-id"]).toBe("evt_1");
    expect(headers["webhook-timestamp"]).toBe(String(now.getTime() / 1000));
    expect(headers["webhook-signature"]).toMatch(/^v1,[A-Za-z0-9+/]+=*$/);
  });

  it("verifies a payload it signed", () => {
    const headers = signedHeaders(secret, "evt_1", body, now);
    expect(verify(secret, body, headers, { now })).toBe(true);
  });

  it("rejects a tampered body", () => {
    const headers = signedHeaders(secret, "evt_1", body, now);
    expect(verify(secret, body.replace("42", "43"), headers, { now })).toBe(false);
  });

  it("rejects a signature made with another secret", () => {
    const headers = signedHeaders("whsec_c29tZS1vdGhlci1zZWNyZXQ=", "evt_1", body, now);
    expect(verify(secret, body, headers, { now })).toBe(false);
  });

  it("accepts any of several space separated signatures", () => {
    const headers = signedHeaders(secret, "evt_1", body, now);
    headers["webhook-signature"] = `v1,bm90LXRoaXMtb25l ${headers["webhook-signature"]}`;
    expect(verify(secret, body, headers, { now })).toBe(true);
  });

  it("rejects timestamps outside the tolerance window", () => {
    const headers = signedHeaders(secret, "evt_1", body, now);
    const later = new Date(now.getTime() + 301_000);
    const earlier = new Date(now.getTime() - 301_000);
    expect(verify(secret, body, headers, { now: later })).toBe(false);
    expect(verify(secret, body, headers, { now: earlier })).toBe(false);
    expect(verify(secret, body, headers, { now: later, toleranceSeconds: 600 })).toBe(true);
  });

  it("rejects missing headers", () => {
    expect(verify(secret, body, {}, { now })).toBe(false);
  });
});
