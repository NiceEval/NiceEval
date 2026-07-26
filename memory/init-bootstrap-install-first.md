# INIT 收缩成自举文件：先装后探，安装向导零线上文档链接

## 裁决（2026-07-18）

`INIT.zh.md` / `INIT.md` 只做安装前就能定稿的三件事：心智模型、前置条件、安装命令，装完立即交接 `node_modules/niceeval/INDEX.md`。接入流程正文（探索项目、Tier 推荐、按形态选文档、judge、三件套、跑通、往深接菜单）整体搬进随包页面 `docs-site/zh/tutorials/agent-onboarding.mdx`。顺序从「先探索项目再安装」翻为「先安装再探索」：装 dev 依赖廉价可逆，不需要探明项目作为前置，而探索发生在装完之后就能拿版本对齐的随包文档做判断。守护：`test/docs-site/bundled-docs-index.test.ts` 拦 INIT 里的 `niceeval.com/docs` 与 GitHub raw 链接。

## 曾选方案

安装前向导自带完整判断流程：第 2 步探索项目 + 一张「被测对象 → 官网 URL」路由表（9 个 `niceeval.com/docs/...` 绝对链接），另复述 judge 配置代码块、`ctx.session`、HITL 事件名等 API 细节，并按标题串引用 INDEX 任务入口（“编写 Adapter”等十几处）。

## 否决理由

- 手写 URL 清单是 agent-docs README 明文否决过的「手写任务表」，且零守护——docs-site 页面改名/挪区即静默断链；实测 2026-07-18 线上全部 `/docs/*` 路径已 404（含官网首页自己链的 `/docs/introduction`），风险已成现状。
- 安装前读的是官网/`main`（未发布态），装到的是 npm latest：INIT 复述的 API 越多，暴露在版本错位窗口里的契约越多，与随包文档机制的存在理由直接冲突。
- INDEX 入口按标题串引用会随各页 frontmatter `title` 演进失配，与「agent 扫带自述的树自行路由」的设计重复。
- 搬进随包页面后，站内相对链接受 `docs:links` 守护、与安装版本天然对齐，三类漂移面全部消失。

## 关联

- 线上 `/docs/*` 全量 404 是独立的站点部署/路由问题，本裁决只消除 INIT 对它的依赖，未修站点。
- `docs-site/zh/tutorials/agent-feedback-loop.mdx` 内仍有一张手写「任务 → 文件路径」表，同类漂移，未在本次一并处理。
