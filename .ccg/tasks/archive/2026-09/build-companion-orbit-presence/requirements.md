# Requirements

## Product goal

Replace the current `#寻找搭子` activity-list shortcut with a dedicated immersive presence page inspired by the supplied reference: a dark spherical field that rotates slowly, a real online total, and visible dots that each correspond to one real opted-in presence.

## Non-negotiable boundaries

- Do not infer online state from `users.updatedAt`, login time, posts, or activities.
- Do not fabricate users or inflate the online total.
- Define “online” as an eligible user who explicitly joins the companion globe while the page is visible and whose short-lived presence has not expired.
- Visitors may view a snapshot without being counted; joining presence requires login, ACTIVE status, complete profile, adult confirmation, and an explicit user action/disclosure.
- Never return internal user IDs, openids, contact information, birthdays, precise location, custom avatar URLs, or stable tracking identifiers.
- A visible dot must map to a real live presence. The total may cover all live presences, while the globe renders a bounded sample for performance and anti-enumeration.
- Preserve the existing Community tab background and layout; only change the `#寻找搭子` destination and add the dedicated page/API.
- Use native mini-program capabilities with no UI or animation framework. Prefer Canvas 2D for the rotating sphere; no generated bitmap is required.

## Required states

- Public snapshot loading, ready, empty, and recoverable error.
- Logged-out viewer state with a clear “加入星球” action that triggers existing login/profile completion only on demand.
- Joined state with low-frequency heartbeat while visible.
- Hide/unload cleanup and TTL fallback when leave cannot be delivered.
- Reduced-motion/static fallback when animation cannot initialize or the page is hidden.
