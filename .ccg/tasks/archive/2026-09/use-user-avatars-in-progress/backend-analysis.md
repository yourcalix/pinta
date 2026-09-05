# GPT-5.5 Backend Analysis

## Recommendation

- Use dynamic batched hydration for activity roster avatars instead of persisting avatar snapshots in activities.
- Keep `memberId` and `userId` internal; public `avatarSlots` only contains `CUSTOM`, `DEFAULT`, or `EMPTY` display data.
- Batch member and user lookups in chunks of 10 to respect CloudBase `command.in` limits and avoid N+1 queries.
- Custom avatars use a controlled readable reference; missing/cleared avatars fall back to the current gender-based painted avatar.
- Missing members, missing users, invalid historical gender, and non-active members render as `EMPTY`.
- Legacy `PASSENGER_A` / `PASSENGER_B` may remain as internal migration hints but must never be returned as public display kinds.

## Proposed Public Contract

```text
CUSTOM  { kind, src, fallback }
DEFAULT { kind, fallback }
EMPTY   { kind }
```

No public slot may contain `memberId`, `userId`, `cloudPath`, `uploadId`, or avatar revision.

## Main Risks

- CloudBase file access must be verified; if direct file IDs are not readable by public activity viewers, the API must resolve temporary display URLs.
- Historical roster normalization currently depends on legacy passenger kinds and must be loosened to preserve valid `memberId` entries.
- Client image failure must deterministically fall back to a painted avatar, never a pixel avatar or random identity.
