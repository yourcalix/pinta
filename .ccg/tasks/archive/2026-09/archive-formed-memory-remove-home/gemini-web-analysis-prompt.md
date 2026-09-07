请把下面这段粘贴到网页版 Gemini 3.7 Flash；拿到结果后直接贴回 Codex：

<GEMINI_WEB_PROMPT>
ROLE: frontend UI/UX analyzer

PROJECT:
拼吧微信小程序。当前首页采用 Concept A 暖米白生活方式风格。此前已经完成过一版独立的“成团记忆”专题画报设计，但该能力属于未来用户主动发布的真实晒图/同行故事，暂时没有正式 UGC 数据契约。

REVIEW TARGET:
本轮只做两件事：
1. 把此前已经定稿的“成团记忆”设计沉淀成可恢复的设计档案；
2. 从当前首页删除 160rpx 的 `OUR STORIES / 成团记忆`静态预告条。

KNOWN CONSTRAINTS:
- 当前首页顺序为：问候栏、Hero、三快捷卡、搜索筛选、真实活动分页列表、成团记忆静态预告条、页面终点文案。
- 删除预告条后，页面终点文案应自然接在活动列表/分页器之后，不能留下大块空白。
- 不删除旧版设计背景资产，不修改后端，不接入假 UGC，不把已成团活动 DTO 冒充用户分享。
- 旧版已定稿设计要记录这些核心参数：`OUR STORIES` 英文水印；347:430 专题板比例（694×860rpx）；亮蓝画报背景；白黄双色倾斜艺术字；左侧 315×588rpx 大卡；右侧两张 315×286rpx 小卡，16rpx 间距并严格等高；未来仅消费真实用户分享；空态时不得伪造内容或死链。
- 微信原生小程序，需兼容 375px 与 320px、安全区和自定义悬浮 TabBar。

REVIEW QUESTIONS:
1. 从当前暖米白首页移除该预告条后，活动分页器、页面终点文案和底部安全区应如何衔接，才能保持自然收口？
2. 设计档案还应记录哪些关键视觉、数据语义、交互和空态约束，才能保证未来恢复时不走样？
3. 哪些现有 WXML/WXSS/测试/规范引用应同步删除或改写，避免留下失效契约？

OUTPUT:
1. 总体判断与最主要问题
2. Critical / Warning / Info 分级问题清单
3. 建议保留的“成团记忆”设计档案字段清单
4. 当前首页删除模块后的最小修改范围
5. 验收清单

Do not invent future APIs or UGC data. Do not suggest deleting the archived design assets. Do not output implementation code.
</GEMINI_WEB_PROMPT>
