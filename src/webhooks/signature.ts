import { createHmac, timingSafeEqual } from "node:crypto";

const SECRET_PREFIX = "whsec_";

export type WebhookHeaders = {
  "webhook-id": string;
  "webhook-timestamp": string;
  "webhook-signature": string;
};

export type VerifyOptions = {
  toleranceSeconds?: number;
  now?: Date;
};

function secretKey(secret: string) {
  const encoded = secret.startsWith(SECRET_PREFIX) ? secret.slice(SECRET_PREFIX.length) : secret;
  return Buffer.from(encoded, "base64");
}

export function sign(secret: string, id: string, timestamp: number, body: string) {
  const digest = createHmac("sha256", secretKey(secret))
    .update(`${id}.${timestamp}.${body}`)
    .digest("base64");
  return `v1,${digest}`;
}

export function signedHeaders(
  secret: string,
  id: string,
  body: string,
  now = new Date(),
): WebhookHeaders {
  const timestamp = Math.floor(now.getTime() / 1000);
  return {
    "webhook-id": id,
    "webhook-timestamp": String(timestamp),
    "webhook-signature": sign(secret, id, timestamp, body),
  };
}

function header(headers: Record<string, string | string[] | undefined>, name: string) {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

export function verify(
  secret: string,
  body: string,
  headers: Record<string, string | string[] | undefined>,
  { toleranceSeconds = 300, now = new Date() }: VerifyOptions = {},
) {
  const id = header(headers, "webhook-id");
  const timestamp = Number(header(headers, "webhook-timestamp"));
  const signatures = header(headers, "webhook-signature");
  if (!id || !signatures || !Number.isInteger(timestamp)) return false;

  const age = Math.abs(Math.floor(now.getTime() / 1000) - timestamp);
  if (age > toleranceSeconds) return false;

  const expected = Buffer.from(sign(secret, id, timestamp, body));
  return signatures.split(" ").some((candidate) => {
    const actual = Buffer.from(candidate);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  });
}
