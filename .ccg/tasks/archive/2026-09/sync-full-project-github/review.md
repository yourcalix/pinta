# 上传前审查

- 远程目标：origin/main，对应 https://github.com/yourcalix/pinta.git。
- 远程 main 是本地 main 的直接祖先，本地领先 30 个提交且无分叉，可使用普通 fast-forward push 让远程文件树与本地一致，无需强推或删除历史。
- 工作区在任务记录前保持干净；当前项目共跟踪 1045 个文件。
- 图片目录共跟踪 71 个文件、约 18.8MB；最大单文件约 6.1MB，符合 GitHub 普通 Git 文件限制。
- .env、project.private.config.json、miniprogram/config/local.js 等私有配置均未被跟踪。
- 项目结构检查通过。
- 全量测试为 327 项中 319 pass、7 fail、1 historical skip；7 项均为此前按用户要求原样搬入拼饭桌页面产生的已知冲突，本次仓库同步未引入代码变更或新增失败。
