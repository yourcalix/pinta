# 后端 / API 分析

## 外部模型状态

- 已按 CCG 路由调用 GPT 5.5。
- GPT 5.5 未返回可用消息；包装器自动回退 GPT 5.6 Terra。
- Terra 因账户用量上限同样未返回结果。本任务不伪造外部模型结论。

## 官方接口核验

- 高德 Input Tips 是输入提示服务，候选可能只是泛化词条且没有 `location`。
- 高德 POI 关键字搜索 `v3/place/text` 返回 `pois`，支持 `city + citylimit`，并提供 `location`。
- 官方文档明确 POI 搜索 Key 必须是 Web 服务 API 类型。

## 脱敏实测

- 使用当前本地 Web 服务 Key，对常见澳门地标进行脱敏探测。
- Input Tips 偶尔包含无坐标的候选；同关键词 `v3/place/text` 返回的 POI 均具有坐标。
- 未输出、记录或提交 Key。

## 推荐状态机

1. Input Tips 成功且清洗后有有效澳门 POI：直接返回，不增加请求。
2. Input Tips 成功但为空或全部缺少有效坐标：调用 `v3/place/text` 兜底。
3. 文本检索有合法澳门 POI：返回结果。
4. 两层原始候选都为空：返回真正空数组。
5. 任一层有候选但两层都无法形成合法坐标：返回 `AMAP_COORDINATES_UNAVAILABLE`。
6. Input Tips 自身网络/API/响应失败不盲目发第二次同域请求；直接保留现有安全错误，避免失败放大与限流。
7. 第二层请求失败时返回第二层的安全错误，允许用户重试。

## 安全边界

- 两层均复用 `cleanPoi` 与澳门经纬度边界。
- 不合并两层列表；第二层只在第一层无有效结果时触发，因此无需跨层去重。
- 不记录 Key、上游 `info/infocode`、原始 request 错误或用户位置。
