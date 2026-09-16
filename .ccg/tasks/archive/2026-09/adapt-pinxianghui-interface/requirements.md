# 需求

将用户提供的“拼享惠”界面适配进现有微信小程序：

- 附件中的 `index.wxml / index.wxss / index.js` 对应 `miniprogram/subpackages/publish/form`。
- 附件中的 `index(2).js` 对应 `miniprogram/pages/publish/index.js`。
- 压缩包包含页面所需图片素材。
- 必须保留现有真实后端数据契约、草稿、鉴权、内容安全、提交防重、键盘与安全区等生产能力，不能简单覆盖掉既有逻辑。
- 视觉尽量忠实还原用户提供版本，素材需放入正确分包并控制包体。
