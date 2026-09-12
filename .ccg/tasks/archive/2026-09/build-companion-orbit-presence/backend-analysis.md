# Backend analysis — GPT 5.5

GPT 5.5 completed the required architecture review.

## Recommended MVP

- Add an isolated presence domain; never reuse `users.updatedAt` or other activity timestamps.
- Actions: `companion.presence.enter`, `companion.presence.heartbeat`, `companion.presence.snapshot`, and best-effort `companion.presence.leave`.
- `snapshot` is public and read-only; it never creates presence.
- Presence writes require an authenticated ACTIVE user with complete profile and adult confirmation.
- Use one deterministic presence document per user and scene, a 90-second online TTL, a 30-second client heartbeat, and a 20-second server minimum write interval.
- Online truth is `expiresAt > serverNow`; TTL deletion is only physical cleanup and is not the business predicate.
- Return a real aggregate total plus at most 50 sampled live presences, with a hard maximum of 60 and no pagination.
- Each sample uses an unstable display token and deterministic sphere seed; no userId, openid, contact data, birth data, exact location, or custom avatar.
- Cloud, Memory, and Mock must share the same action and expiration semantics. Mock defaults to zero presence unless a test or explicit demo session actually enters.
- CloudBase needs a compound `scene + expiresAt` index.

## Product/privacy synthesis

The reference image displays nicknames, but exposing every logged-in nickname by default would create an online-user enumeration surface. The implementation should therefore treat explicit “加入星球” as consent to a short-lived public display. A safe public display name may be included only for that opted-in presence, with no stable identifier or profile-link action. Repeated snapshot calls must not support pagination or stable ordering.
