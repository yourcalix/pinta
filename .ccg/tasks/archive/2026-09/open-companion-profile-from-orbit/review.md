# Review

## GPT-5.5 backend/security review

- Critical: none.
- The first pass identified top-50 lookup coupling, Mock/Cloud validation drift, and expiry naming. These were fixed with a random per-presence `profileNavNonce`, a 30-second signed time window, direct indexed presence lookup, aligned validation/sanitization, and bounded credential expiry.
- The second pass returned `APPROVE` and suggested an explicit scene guard for future expansion. The guard was added to `resolveProfileNavPresence`.
- The short-lived credential is intentionally a narrowly scoped bearer for the public profile fields of a user who actively joined the companion globe. It is not stored in URL, Storage, or page Data; it does not authorize heartbeat, leave, contact access, or any write.

## Frontend review

- Plan review from Web Gemini 3.7 Flash: `APPROVE_PLAN`, Critical none.
- Final implementation review from Web Gemini 3.7 Flash: `APPROVE`, Critical none, Warning none.
- Confirmed compound dot/text hit regions, CSS-pixel coordinate mapping, front-depth arbitration, 28px iOS edge protection, one-time memory bridge, read-only visual semantics, and package placement.
