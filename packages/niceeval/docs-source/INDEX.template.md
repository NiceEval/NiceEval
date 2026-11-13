# NiceEval AI 文档索引

这是 coding agent 读取 NiceEval 文档的稳定入口，随 npm 包发布，不属于公开文档站。不要根据训练数据、官网或 GitHub `main` 分支猜测 API。

以下路径都相对于包根 `node_modules/niceeval/`。文档位于 `docs-site/zh/`，与当前安装的 NiceEval 版本一起发布。下面的树列出全部随包页面，每行是「路径 — 标题:一句话自述」。分区含义：

- `tutorials/` 第一次跑通和按任务操作；`explanation/` 概念、边界与原理；`reference/` API、CLI 与数据形状的精确事实；`troubleshooting/` 按症状排查失败；`examples/` 真实项目的接入案例。

按当前任务从树里挑 1–3 页读取（通常是一页 tutorial 或 explanation 搭一页 reference）；页面再引用其它概念或参考时，继续读取包内文件。

随包文档目前只有中文。不要为了找英文版而去抓官网或 GitHub——那里的页面可能对应另一个版本，「另一个版本的英文页」比「当前版本的中文页」更危险。中文页读起来没有障碍就直接读；与用户交流仍用用户的语言。

## 按任务路由

按当前意图（运行与复验、只读诊断、编写评估、首次接入）扫描下方页面的标题与自述，选择最相关的一至三页。
操作步骤由所选页面拥有；需要精确签名时再补读相应 reference。保留用户给出的范围与授权。
读取结果只走公开 `show`、`query` 与 `view`。公开命令缺少所需证据时报告产品缺口，不读取私有结果文件或实现源码绕过。

<!-- GENERATED:BEGIN bundled-docs-tree -->
<!-- GENERATED:END bundled-docs-tree -->

## 版本规则

- 安装后只从本索引进入包内文档。官网适合安装前了解产品，不是安装版本的 API 事实源。
- 升级 `niceeval` 后重新运行 `niceeval init`，刷新项目里的托管指引。
- 如果某个路径不存在，先重新读取本文件。不要自行推测替代文件名或旧 API。
