# Requirements

- Activity progress must display each active member's current uploaded avatar when available.
- A painted default avatar is used only when the member has no valid custom avatar or the custom image cannot be resolved.
- The fix must work in the repository's default Mock runtime and the real CloudBase runtime.
- Public activity DTOs must not expose CloudBase file IDs or internal member/user identifiers.
- Preserve the existing `CUSTOM | DEFAULT | EMPTY` contract and image-error fallback behavior.
