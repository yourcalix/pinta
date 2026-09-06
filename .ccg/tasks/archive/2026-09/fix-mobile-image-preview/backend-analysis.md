# GPT-5.5 后端兼容分析

## 结论

- 图片文件完整且已进入真机预览包，`ignoreDevUnusedFiles` 不是根因。
- 当前把包内路径、`cloud://`、HTTPS 和临时路径统一交给 `wx.getImageInfo`，不能保证输出路径可被 iOS / Android 的 `wx.previewImage` 稳定消费。
- `cloud://` 必须先经 `wx.cloud.downloadFile` 得到临时文件；HTTPS 建议先 `wx.downloadFile`；临时路径和 `getImageInfo` 的结果应先校验文件存在。
- 防重锁应覆盖完整异步生命周期，并用页面销毁标记或请求令牌拦截过期回包。

## 建议验证

- 默认背景与三种默认头像。
- 自定义 `cloud://` 与 HTTPS 头像。
- 失效临时文件、云下载失败、HTTPS 非 2xx。
- 慢网络连续点击、页面卸载、加载提示释放。
