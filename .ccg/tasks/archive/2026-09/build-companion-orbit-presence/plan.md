# Implementation plan

1. Add failing contract tests for presence authentication, eligibility, TTL expiration, heartbeat throttling, DTO privacy, bounded sampling, and the new page route/Canvas lifecycle.
2. Add a dedicated `companion-presence` domain helper with constants, validation, safe display DTO construction, deterministic layout seed, and expiration rules.
3. Extend MemoryStore and CloudStore with deterministic presence upsert, soft-throttled heartbeat, snapshot count/sample, and best-effort leave semantics; keep CloudBase queries bounded and indexable.
4. Add service actions and validation for `companion.presence.enter`, `.heartbeat`, `.snapshot`, and `.leave`, with public snapshot and protected writes.
5. Mirror the same behavior in Mock without fabricated online fixtures.
6. Add the mini-program service wrapper and the `subpackages/community/companion` Canvas 2D page, including loading/empty/guest/joined/error states, 30-second heartbeat, lifecycle cleanup, DPR cap, 50-node cap, front-depth nickname culling, and reduced static fallback.
7. Change only the `#寻找搭子` card destination; preserve the Community tab design and other topic actions.
8. Run targeted tests, full verification, package budgets, and diff checks. Complete GPT 5.5 backend review and Web Gemini final frontend review before archiving and committing.

## Product decisions

- Read-only ambient rotation, approximately 48 seconds per revolution; no canvas touch handlers.
- A user is counted only after an explicit join action and disclosure.
- Safe nickname display is limited to the short-lived opted-in presence and cannot navigate to a profile or direct message.
- The real total covers all unexpired eligible presences; the globe renders at most 50 real samples with no pagination.
- The current user receives a one-time local highlight after joining.
