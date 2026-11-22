# Customer API account screen

`CustomerAPI.svelte` accepts `actorId`, `companyId`, and the parent account-access `AbortSignal`. It emits `close` and `denied` (`{status: 401 | 403}`). Company selection is a lifecycle boundary; tokens are owned by the signed-in account, not the selected company.

Verified backend source, 15 November 2026: immutable release `native-company-enterprise-browser-20261115`, `open_webui/routers/customer_http.py`, `customer_store.py`, `customer_native.py`, `customer_company.py`, `starli_customer_api.py`, and `wave_panels/workspace_app.py`. The mount is gated by `STARLI_CUSTOMER_API_ENABLED=1`; this UI does not enable or change the service. The unauthenticated public management probe returned 404 during implementation. The screen requires successful, versioned JSON from both token list and bot directory before enabling creation. A missing route or SPA fallback produces the unavailable state.

Management uses the existing native session Bearer header, never a customer credential: `GET/POST /api/v1/starli/api-tokens`, `GET /api/v1/starli/api-tokens/bots`, and `DELETE /api/v1/starli/api-tokens/{tokenId}`. Token expiration is Unix seconds. Supported scopes are `bots:read`, `conversations:read`, `messages:send`, `runs:read`, `runs:cancel`. Shared bots must be explicitly selected using catalogue IDs; `all_owned` grants personal bots only.

The customer base URL is `https://api.starlidigital.ro/api/customer/v1`. The guide documents only the inspected contract: `/models`, `/chat/completions` with one new user message and returned `starli/{botId}` model, SSE completion chunks, idempotency and operation/run recovery, cancellation, and canonical history. It does not offer conversation creation or provider configuration.

The full newly issued secret exists only in the one-time component state and the create response. Token metadata is explicitly projected without the secret. No customer secret is written to storage or diagnostics. Dismissal, guide navigation, refresh, revocation, component destruction, account/company changes, native-session storage events and parent access abort clear the displayed secret. Revocation requires an explicit product confirmation. Copying is user initiated.

Run the controlled transport and strict TypeScript checks with:

    node src/lib/components/enterprise/account/customer-api-client.test.cjs

Fixtures verify exact native Authorization transport and create schema, secret-free metadata, encoded deletion, rejection of late responses after session change, closed clients, version mismatch, and HTML route fallbacks. Fixtures neither contact live customer endpoints nor print credentials.
