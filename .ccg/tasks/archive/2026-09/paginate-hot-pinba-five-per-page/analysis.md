# 分析结论

## 采纳

- 每次请求 `limit: 5`，移除触底自动追加。
- 活动卡之后、成团记忆之前显示“上一页 / 第 N 页 / 下一页”。
- 下一页未缓存时保留当前五张卡，只在分页按钮显示加载中。
- 上一页与已访问的下一页读取页面实例缓存，不发网络请求。
- 翻页完成后平滑滚动至“热门拼吧”标题，而非页面顶部。
- 无总数契约，不展示总页数；章节右侧改为“第 N 页”。

## 主会话校正

- Gemini 示例中的 `cursorStack[currentPage - 1]` 存在一位偏差。以 1 为起始页码时，从第 N 页请求第 N+1 页应读取 `_pageCursors[currentPage]`。
- 使用 `_pageCache[pageIndex] = { activities, nextCursor }` 保存每页快照，并同步维护 `_pageCursors`，避免游标与页面缓存错配。
- 只有 `currentPage > 1 || hasNextPage` 时显示分页器；末页不伪造总页数。
