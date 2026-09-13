# Requirements

## Product intent

- Keep the existing bell image and its current header slot on the Discover tab.
- Change the bell destination to a new subpackage page titled `讨论动态`.
- Reproduce the supplied reference layout: custom light navigation, three tabs (`全部 / 回复我的 / 收到的赞`), rounded white activity cards, unread dots, and a 30-day terminal message.
- Every visible event must come from real per-user community activity data; do not ship sample people, counts, content, or status cards.
- Tapping a valid reply/like event opens its corresponding discussion detail. Removed or moderated content must not expose the original text.

## Backend analysis decision

- Existing `notification.list/read` is activity-centric and should remain isolated.
- Add a community-specific feed with reply-to-post, post-liked, and post-status event types.
- Generate events on real write transitions, paginate by opaque cursor, enforce recipient-only reads, hydrate only controlled avatar DTOs, and filter/redact deleted or suspended content at read time.
- Aggregate likes by post with a bounded recent-actor preview; self-replies and self-likes do not generate events.
- Cover list, unread, read/read-post, tabs, pagination, idempotency, privacy, takedown, and Mock/Cloud parity.

## Visual constraints

- Background remains `#F9F7F2`; use real system status bar and WeChat capsule rather than drawing them.
- Existing bell asset is not regenerated or replaced.
- No new image generation is required for the page: user avatars come from controlled profile DTOs and the community assistant can reuse an existing local shield asset.
- Provide loading, empty, error, disabled/removed-content, unread, and pagination states.
