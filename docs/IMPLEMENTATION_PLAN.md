# Mock review pilot implementation plan — 2026-11-06

Scope authority: REVIEW_PILOT.md and the delegated implementation request. Implementation choices below are developer decisions for a synthetic local pilot, not approved production policy.

## Design
Use a single Node.js/TypeScript server, no runtime packages, same-origin vanilla UI, atomic JSON snapshots with exclusive process lock. A browser-only localStorage demo cannot verify server authorization or durable idempotency. A full framework/Postgres stack is unnecessary for one local process; it remains an option for a future service.

A mock adapter owns fixed synthetic products and order states. No Cafe24 adapter is implemented; no endpoint or scope is inferred. Runtime network guard rejects outbound sockets, HTTP, HTTPS, fetch, and DNS. Browser CSP permits same-origin requests only. Bind 127.0.0.1 and reject unknown Host / cross-origin mutation requests. This guard is an accidental-use barrier, not an OS security boundary.

The admin and buyer use separate, randomly generated HttpOnly demo session cookies. Demo identities are selectable only in localhost UI; this is not real identity verification. A random-secret HMAC capability in the URL fragment plus matching synthetic buyer session authorizes an order. The link expires seven days after creation; no renewal/reissue, no edits; each distinct product in an order has one review. Exact replay returns the original row, conflicting replay is rejected. Once all products are reviewed the link is consumed for new writes. Eligibility is rechecked on every write; partial/cancelled/returned/unpaid orders are held. Imported text must come from the fixed, rights-confirmed synthetic fixture; it can never get purchase verification. Unknown mapping and ambiguous duplicate rows go to a review queue; reruns do not add rows.

## Tasks and verification
1. Tests first: domain eligibility, order request idempotency, scoped token and buyer authorization, expiry/reuse, per-product replay/conflict, import provenance/quarantine/rerun, persistence rollback/restart and lock. Implement src/domain.ts, src/mock.ts, src/store.ts and tests/domain.test.ts.
2. Integration tests first: protected admin routes, wrong-order/product writes, input errors, concurrent request/submission, CSP/CSRF/Host, external network blocking. Implement src/server.ts and src/main.ts, tests/http.test.ts and tests/network.test.ts.
3. Browser tests first: desktop/mobile request → link → write/save → correct product widget, admin/import, invalid/expired link and repeat flows, failed widget and purchase-button independence. Implement public UI and e2e/pilot.spec.ts.
4. Run lint, strict type check, build, unit/integration and browser suites; save synthetic-only screenshots. Keep PRD.md unchanged; append actual results to REVIEW_PILOT.md, README.md and docs/VERIFICATION.md. Commit locally on codex/review-pilot-mock; no push/PR.

## Review focus
Durable uniqueness across restart; expired or ineligible orders fail before replay; cross-order/buyer access; conflicting source IDs and duplicate source content; failed persistence cannot mutate live state; widget outage cannot capture storefront purchase events. No production KPIs will be claimed.
