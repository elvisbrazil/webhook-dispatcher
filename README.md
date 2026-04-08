# webhook-dispatcher

A small service that delivers outgoing webhooks for multiple tenants. Tenants register endpoints,
publish events, and the service fans each event out to the subscribed endpoints, signs the
requests, retries failures with backoff and keeps a log of every attempt.

Fastify 5, TypeScript, PostgreSQL (Drizzle), BullMQ on Redis.

## Running

```sh
docker compose up -d          # postgres + redis
pnpm install
cp .env.example .env
pnpm db:migrate
pnpm tenant:create acme       # prints the tenant api key
pnpm dev                      # api on :3000, docs on /docs
pnpm dev:worker               # delivery worker, separate process
```

Tests run against an embedded Postgres (PGlite) with the same migrations and an in-memory queue,
so they do not need Docker:

```sh
pnpm test
```

`docker compose --profile app up -d --build` also runs the api and the worker in containers.

Delivery behaviour is tuned through env vars (see `.env.example`): `DELIVERY_TIMEOUT_MS`,
`DELIVERY_MAX_ATTEMPTS`, `BACKOFF_BASE_MS`, `BACKOFF_MAX_MS`, `AUTO_DISABLE_AFTER` and
`WORKER_CONCURRENCY`.

## API

All routes except `/health` and `/docs` need the tenant key in `x-api-key`.

```sh
export KEY=whd_...

# register an endpoint; the signing secret is only returned here
curl -s localhost:3000/endpoints -H "x-api-key: $KEY" -H 'content-type: application/json' \
  -d '{"url":"https://example.com/hooks","eventTypes":["order.created","order.paid"]}'

# publish an event (202, or 200 with the original event when the key was already used)
curl -s localhost:3000/events -H "x-api-key: $KEY" -H 'content-type: application/json' \
  -d '{"type":"order.created","payload":{"id":42},"idempotencyKey":"order-42-created"}'

# deliveries and attempts of an event
curl -s localhost:3000/events/<event-id>/deliveries -H "x-api-key: $KEY"

# failed deliveries of an endpoint, then retry one
curl -s 'localhost:3000/endpoints/<endpoint-id>/deliveries?status=failed' -H "x-api-key: $KEY"
curl -s -X POST localhost:3000/deliveries/<delivery-id>/retry -H "x-api-key: $KEY"

# disable / enable an endpoint
curl -s -X POST localhost:3000/endpoints/<endpoint-id>/disable -H "x-api-key: $KEY"
```

An endpoint subscribed to `*` receives every event type.

## Verifying signatures

Requests follow [Standard Webhooks](https://www.standardwebhooks.com/): `webhook-id`,
`webhook-timestamp` and `webhook-signature` (`v1,` + base64 HMAC-SHA256 of
`${id}.${timestamp}.${body}`, keyed with the base64 part of the `whsec_` secret). The body is
`{"type", "timestamp", "data"}`.

`src/verify.ts` exports the check consumers need. Verify against the raw body, before parsing:

```ts
import { verify } from "./verify.js";

const ok = verify(process.env.WEBHOOK_SECRET!, rawBody, request.headers, {
  toleranceSeconds: 300,
});
```

## Design notes

- The worker owns retries instead of BullMQ: each attempt is recorded, then the decision (succeed,
  retry after a delay, fail) re-enqueues a delayed job. That keeps the retry rules in one pure
  function (`src/webhooks/retry.ts`) that is easy to test. BullMQ's own retries only cover crashes
  in the worker itself.
- 2xx is success. 408, 429 and 5xx, timeouts and network errors are retried with exponential
  backoff and jitter; any other status is a permanent failure. `Retry-After` (seconds or HTTP date)
  is honored on 429/503, capped at the max backoff.
- An endpoint is disabled after `AUTO_DISABLE_AFTER` deliveries in a row end as failed (not
  attempts). A success resets the counter. Re-enabling is manual.
- `webhook-id` is the event id, so it stays the same across retries and consumers can dedupe on it.
- Events and their deliveries are written in one transaction and enqueued after commit. If Redis
  is down at that moment the deliveries stay `pending` in Postgres; a sweeper that re-enqueues old
  pending rows would close that gap and is not implemented yet.
- API keys are stored as SHA-256 hashes. Endpoint secrets are stored in plain text because the
  worker needs them to sign.
- The queue sits behind a small port (`DeliveryQueue`) so the API and tests do not depend on Redis.
