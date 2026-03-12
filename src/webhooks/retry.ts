export type RetryPolicy = {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
};

export type AttemptResult =
  | { kind: "response"; status: number; retryAfter?: string | undefined }
  | { kind: "error"; message: string };

export type Decision =
  | { action: "succeed" }
  | { action: "retry"; delayMs: number; reason: string }
  | { action: "fail"; reason: string };

export type DecideOptions = {
  now?: Date;
  random?: () => number;
};

export function isRetryableStatus(status: number) {
  return status >= 500 || status === 408 || status === 429;
}

export function backoffDelay(attempt: number, policy: RetryPolicy, random = Math.random) {
  const ceiling = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempt - 1));
  return Math.round(ceiling / 2 + (random() * ceiling) / 2);
}

export function parseRetryAfter(value: string | undefined, now = new Date()) {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;

  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, date - now.getTime());
}

export function decide(
  result: AttemptResult,
  attempt: number,
  policy: RetryPolicy,
  { now = new Date(), random = Math.random }: DecideOptions = {},
): Decision {
  if (result.kind === "response" && result.status >= 200 && result.status < 300) {
    return { action: "succeed" };
  }

  const reason = result.kind === "response" ? `HTTP ${result.status}` : result.message;

  if (result.kind === "response" && !isRetryableStatus(result.status)) {
    return { action: "fail", reason };
  }

  if (attempt >= policy.maxAttempts) {
    return { action: "fail", reason: `${reason} after ${attempt} attempts` };
  }

  const retryAfter =
    result.kind === "response" && (result.status === 429 || result.status === 503)
      ? parseRetryAfter(result.retryAfter, now)
      : undefined;

  const delayMs =
    retryAfter === undefined
      ? backoffDelay(attempt, policy, random)
      : Math.min(retryAfter, policy.maxDelayMs);

  return { action: "retry", delayMs, reason };
}
