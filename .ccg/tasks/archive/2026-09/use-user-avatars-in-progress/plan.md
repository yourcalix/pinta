# Implementation Plan

1. Replace the public passenger avatar contract with `CUSTOM | DEFAULT | EMPTY` and keep legacy kinds only as internal gender hints.
2. Add MemoryStore and CloudStore batch hydration of active activity members and current user profiles, including CloudBase temporary display URL resolution.
3. Route every activity DTO response through a shared hydrated public-activity mapper without exposing member or user identifiers.
4. Update the Mock server to derive slots from active member facts and current profiles.
5. Replace client pixel mappings with real/custom and painted-default normalization plus single-step image-error fallback.
6. Wire fallback handling into discovery cards, activity detail, and the personal timeline while preserving stack layout and click behavior.
7. Update specs and regression tests, run the full verification suite, then perform the required backend and frontend reviews.

