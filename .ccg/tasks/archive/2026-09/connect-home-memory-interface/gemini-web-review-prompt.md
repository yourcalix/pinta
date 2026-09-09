# Gemini Web Review Prompt

ROLE: frontend reviewer

TASK: Review the implemented WeChat Mini Program frontend change that connects the homepage “琐碎回忆” shortcut to a dedicated static “成团记忆” preview page. This is a post-implementation review, not a plan review.

Scope and implementation:

1. `miniprogram/pages/discover/index.wxml`
   - The existing visible shortcut title/subtitle and all other homepage layout remain unchanged.
   - Its accessibility label is now “琐碎回忆，查看成团记忆专题预告”.
2. `miniprogram/pages/discover/index.js`
   - `handleHomeShortcut('memories')` navigates to `/subpackages/activity/memories/index`.
   - `_memoriesNavigationPending` blocks repeated taps.
   - A 500ms timer releases the lock; navigation failure also releases it and shows “页面打开失败，请稍后重试”.
   - `onShow`, `onHide`, and `onUnload` clear the timer/lock.
3. `miniprogram/app.json`
   - `memories/index` is registered inside `subpackages/activity`.
4. New static page `miniprogram/subpackages/activity/memories/index.{js,json,wxml,wxss}`
   - Native navigation title: “成团记忆”. No share handler.
   - Warm ivory page background `#F9F7F2`, with `padding: 36rpx 28rpx calc(48rpx + env(safe-area-inset-bottom)) 28rpx`.
   - Explicit status copy: “拼友成团故事分享与精选晒图功能正在筹备中，近期开放”.
   - Archived poster restored as a 347:430 blue panel: standard `694×860rpx`, `24rpx` padding; <=340px `600×744rpx`, `18rpx` padding.
   - Uses a package-local 694×860, 34KB Baseline JPEG with `aspectFill`, plus blue gradient/shade/glow.
   - Headline: OUR STORIES / 分享你的 / yellow 成团 + white 记忆 / CSS camera / subtitle.
   - Three static slots use exact geometry: standard columns `315+16+315`, left `588`, right `286+16+286`; narrow columns `272+12+272`, left `508`, right `248+12+248`.
   - Slot copy is limited to controlled preview wording: “成团故事 / 分享功能即将开放”, “虚位以待 / 敬请期待”, “等你来分享 / 记录精彩瞬间”.
   - There is no `bindtap`, button, story detail link, author, photo, likes, views, upload, backend request, or `activity.memories` call.
   - All poster children are `aria-hidden="true"` and non-interactive; only the outer panel has aggregate `aria-label="成团记忆专题画报，记录每一次顺利成团的珍贵瞬间，分享功能即将开放"`.
5. Tests verify routing, timer/failure lock release, zero data service usage, static preview contract, 375px/320px geometry, accessibility, local path, JPEG Baseline/dimensions/size, global light-background exception, source paths and package budgets.

Verification already passed:

- `npm run verify`: 354 tests, 353 passed, 1 intentionally skipped, 0 failed; static project check OK.
- Main package: 1,684,313 bytes (1.606 MiB), below 1.70 MiB.
- Activity subpackage: 119,423 bytes (0.114 MiB), below 1.50 MiB.
- No WebP/AVIF runtime assets or dangling local image paths.

Review focus:

- visual fidelity to the archived 347:430 poster at 375px and 320px;
- warm ivory-to-blue transition and safe-area spacing;
- whether the static status copy prevents dead-end confusion;
- grid arithmetic, overflow, large-font behavior and native navigation compatibility;
- repeat-navigation lock correctness, including timer/onHide/fail interactions;
- accessibility aggregation and whether decorative descendants are properly hidden;
- any accidental implication that real UGC stories already exist;
- confirmation that other homepage/page branches remain unaffected.

OUTPUT: Return only:

Critical:
- findings, or “无”

Warning:
- findings, or “无”

Info:
- concise verified strengths

Verdict:
- APPROVE or REQUEST_CHANGES
