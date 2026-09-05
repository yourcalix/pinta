# 部署要求

- 将提交 `89f454e` 中支持自定义头像上传的 `cloudfunctions/api` 部署到本项目已绑定的 CloudBase 环境。
- 部署前确认真实 AppID、目标环境、云函数配置与依赖完整，禁止猜测环境 ID。
- 部署后验证云函数可用、`security.imgSecCheck` 权限配置生效，且不输出任何密钥。
- 不修改或清空生产数据，不切换到其他 CloudBase 环境。
