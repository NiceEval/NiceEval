# AI 随包文档使用包根 INDEX.md 路由

## 裁决

给 coding agent 的稳定文档入口是 npm 包根的 `INDEX.md`。`INIT.zh.md` 与 `niceeval init` 写入的托管指引只指向 `node_modules/niceeval/INDEX.md`；具体任务页面由该索引路由。`INDEX.md` 通过 `package.json.files` 随包发布，但不放进 `docs-site/`，不属于 Mintlify 公开文档内容树。

## 曾选方案

安装入口和托管指引直接列出 `docs-site/zh/` 下的具体 `.mdx` 路径；随后短暂考虑把 `INDEX.md` 放在 `docs-site/zh/` 下。

## 否决理由

直接列页面路径会让文档拆分或改名反向要求修改长期稳定的安装入口。把 AI 索引放进 `docs-site/zh/` 又会混淆公开站内容与机器路由文件，可能被文档工具当作站点页面处理。包根索引同时满足版本绑定、单点路由和不进入公开文档站三个约束。

日期：2026-07-12
