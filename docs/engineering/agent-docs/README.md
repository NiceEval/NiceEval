# 随包 AI 文档（agent-docs）

Coding agent 在用户项目里接入 niceeval、编写配置和 Eval 时，如果依赖训练数据或官网，读到的可能是另一个版本的 API。

本机制把中文文档随 npm 包发布，让 agent 永远读「与当前安装版本一起发布」的文档：官网服务人，`node_modules/niceeval/` 里的文档服务 AI。

用户面契约（AI 应该怎么读、init 写什么）单源在 [`docs-site/zh/tutorials/agent-feedback-loop.mdx`](../../../docs-site/zh/tutorials/agent-feedback-loop.mdx) 与 [`docs-site/zh/reference/cli.mdx`](../../../docs-site/zh/reference/cli.mdx)。本篇只定义仓库侧的打包、发现与守护机制。这套机制对 agent 是否真的有效，由独立评估仓库给出证据——接入链路见 [`agent-install-eval.md`](agent-install-eval.md)，接入后的结果诊断链路见 [`agent-debug-eval.md`](agent-debug-eval.md)。

## 打包方案：原样发布，不转换

`package.json` 的 `files` 白名单收录三项文档面。
`docs-site/zh/` 与 `docs-site/images/` 原样进包——不经复制、转换或搬运，包内路径与仓库路径一致，这个路径本身是托管区块与文档引用的契约；`INDEX.md` 是打包前由 `prepare` 生成的构建输出（时机链见下）：

| 进包内容 | 角色 |
| --- | --- |
| `INDEX.md`（包根） | AI 的单点路由入口，构建输出 |
| `docs-site/zh/` | 中文正文，MDX 原文 |
| `docs-site/images/` | 正文引用的图片资源，保证引用在包内有落点 |

- **为什么原样发 MDX**：与整个包发布 TS 源码是同一个模型——消费侧直接读源文件，没有 build 步骤就没有构建漂移；MDX 的 frontmatter 和组件标签不妨碍 agent 阅读，frontmatter 的 `description` 反而是页面自述。
- **为什么只发中文**：中文是产品叙事与场景示例的准绳（根 CLAUDE.md），英文入口从中文同步。
  双语随包只增加体积和漂移面，不增加 agent 可用的信息。
- **体积边界**：zh 正文约 1MB 文本，images 约 28KB，相对 `src/` 与 `dist/` 占比可接受，不做裁剪。
  将来正文膨胀时，裁剪的单位是「这一整页值不值得给 agent」，不是换压缩格式或抽摘要。

不随包的文档面，及不随包的理由：

- `INIT.zh.md` / `INIT.md`：安装自举文件。
  它们工作的阶段包还不在 `node_modules`，从官网 / GitHub raw 读取，因此内容收敛到安装前就能定稿的三件事：心智模型、前置条件、安装命令。装完立即交接给随包 `INDEX.md`。
  自举文件**不含任何线上文档链接**：线上 URL 既没有守护（页面改名即静默断链），版本也与将要装到的包无关。接入流程正文住在随包页面 [`docs-site/zh/tutorials/agent-onboarding.mdx`](../../../docs-site/zh/tutorials/agent-onboarding.mdx)，`test/docs-site/bundled-docs-index.test.ts` 拦截向导里出现的线上文档链接。
- `docs-site/` 英文入口与站点配置（`docs.json` 等）：服务网站构建，不服务包内读者。
- `docs/`、`memory/`：内部设计契约与过程条目，读者是维护 niceeval 仓库的人，不是用户项目里的 agent。

## 发现机制：两跳静态路径

发现链只有两跳，全部是静态文件路径，不依赖任何运行时接口：

1. **项目指引 → 包根索引**。
   `niceeval init` 往用户项目写托管指引区块（已有 `AGENTS.md` 写 `AGENTS.md`；只有 `CLAUDE.md` 写 `CLAUDE.md`；都没有则新建 `AGENTS.md`），区块指向 `node_modules/niceeval/INDEX.md`。
   升级 niceeval 后重跑 `init` 刷新区块。
2. **包根索引 → 任务页面**。
   `INDEX.md` 按任务路由到 `docs-site/zh/**` 的具体页面；页面再引用其它概念或参考时，agent 继续读包内文件。

`node_modules/niceeval/INDEX.md` 这个路径本身是契约：托管区块、`INIT.zh.md`、教程文案引用的都是它。
文档站怎么重组都不改这个入口——重组的代价被收敛在「重新生成一次 `INDEX.md`」以内，已经写进各用户项目的托管区块不需要跟着变。

## INDEX.md：导语手写在模板，文档树打包时生成

`INDEX.md` 由一份签入的模板和一个构建输出组成：

- **模板 `INDEX.template.md`（签入 git）**：手写导语——给 AI 的阅读契约（不要按训练数据猜 API、路径相对包根、各分区含义、按任务挑 1–3 页读）、版本规则，以及一个空的 `<!-- GENERATED:BEGIN bundled-docs-tree -->` 区块。
  导语内容不存在于任何单页的 frontmatter 里，是这套机制里唯一需要人维护的文案。
- **输出 `INDEX.md`（不签入，gitignore）**：生成器读模板、把文档树填进区块、写出包根 `INDEX.md`。
  树按 `docs-site/zh` 顶层目录分组，顺序按 agent 的使用顺序排（tutorials → explanation → how-to → reference → troubleshooting → examples）。清单外的新目录自动排在其后；每页一行「路径 — `title`：`description`」。
  站点导航入口（各级 `index.mdx` 与 `introduction.mdx`）不进树：它们服务网站导航，对包内读者没有路由价值。

**单源关系**：树里每一行的文案单源在对应页面的 frontmatter `title` / `description`。

页面自述与正文同文件、同次修改演进，索引输出又在每次打包时现算，因此不存在任何需要人同步的第二份文案；`docs-site/AGENTS.md` 对标题与描述的任务表述纪律，就是索引行的质量纪律。

生成器对缺 `title` 或 `description` 的页面直接报错——「这页帮 agent 完成什么任务」必须在页面定稿时答出，答不出说明页面定位有问题，回到 [`docs-site/zh/README.md`](../../../docs-site/zh/README.md) 的信息架构裁决。

这与参考页 `{/* GENERATED */}` 区块是同一个模式：文案单源在内容紧邻处，生成器只拼装、不承载文案，同一个 `scripts/generate-reference.ts` 承载。

三条边界裁决：

- **不做手写任务表**（按任务分组、一行路由多页组合的人工索引）。
  页面自述已单源存在于 frontmatter，手写行是它的复述，复述必然漂移，而守护只能保证路径存在、保证不了措辞同步；跨页组合的路由，agent 扫一遍带自述的树即可自行完成。
  若效果评估（见 [`agent-install-eval.md`](agent-install-eval.md)）表明 agent 路由质量不足，再以有证据的策展补一张小表，不默认维护。
- **不为索引增设第二个 frontmatter 字段**。
  一句 `description` 同时服务站点卡片与 agent 路由，两者的要求一致——任务视角的一句话自述；措辞冲突时改这一句，不加旁路字段造第二事实源。
- **页面级路由，不做 anchor 级**。
  小节标题的变更频率远高于页面路径，anchor 行会持续腐烂；agent 打开页面后自行定位小节。

守护落点与分工：

| 守护 | 落点 | 校验内容 |
| --- | --- | --- |
| 可生成 | `lint/docs-site/bundled-docs-index.lint.ts` | 复用生成器的纯函数，从模板 + 全部 zh 页面在内存生成一次：缺 `title` / `description`、模板缺区块标记时红灯，并校验每个非入口页都出现在输出里——与发版时 `prepare` 同一条失败路径，提前到 `pnpm lint:docs-site` |
| 完整 | 生成器自身 | 树由文件系统枚举构造，存在与完整性天然成立；缺 `title` / `description` 的页面在生成时报错并指明落点，发布被挡下 |
| 单点入口与打包链 | `lint/docs-site/bundled-docs-index.lint.ts` | `package.json` `files`、`INIT.zh.md`、`src/cli.ts` 托管指引三处指向的都是包根 `INDEX.md`；`prepare` 链包含 `build:index`，缺了发出去的包就没有索引 |

## 生成与打包的时机链

`INDEX.md` 走与 `dist/report/**` 相同的构建输出模型——签入的是源（模板 + 各页 frontmatter），输出在打包前现场生成：

1. **模板签入，输出不签入。**
   手写导语在 `INDEX.template.md`；`INDEX.md` 在 gitignore 里。
   仓库里没有需要人工刷新的生成物，也就没有「忘跑生成」这类漂移。
2. **安装与发版时生成。**
   `prepare` 生命周期（本地 `pnpm install` 与发版 CI 的 install 步骤都会触发）运行 `pnpm run build:index`，从模板与当前各页 frontmatter 生成包根 `INDEX.md`。某页缺 `description` 时在这里报错，发布随之失败——索引与包内页面在打包那一刻由构造保证一致。
3. **打包时只收文件。**
   `pnpm publish` 按 `files` 白名单把刚生成的 `INDEX.md` 与原位的 `docs-site/zh/**`、`docs-site/images/**` 收进 tarball；docs 页面不经任何复制或搬运，包内路径与仓库路径一致。

## 维护与验收

- 增删、移动、重命名 `docs-site/zh` 页面，或修改任何页面的 `title` / `description`：索引零手动动作，下一次安装 / 发版自动反映；本地想预览输出运行 `pnpm run build:index`（`pnpm docs:reference` 也会顺带产出）。
  `docs-site/AGENTS.md` 规定的 `docs.json` 与 redirect 义务照旧。
- 修改导语或分区说明：改 `INDEX.template.md`。
- 以 link / 本地路径把仓库工作树当包消费时，`INDEX.md` 是上一次 `prepare` 时点的输出：先在仓库跑 `pnpm install` 或 `pnpm run build:index` 再消费，索引才与工作树页面一致。
- 验收：`pnpm lint:docs-site` 绿；发版前抽查 `pnpm pack --dry-run`（或 `npm pack --dry-run`）的文件清单包含 `INDEX.md`、`docs-site/zh/**` 与 `docs-site/images/**`。
