# Repository Guidelines

## Project Structure & Module Organization

niceeval 是一个 TypeScript evals 库。CLI 入口在 `bin/niceeval.mjs`，运行时通过 `tsx` 直接加载 `src/cli.ts` 和用户项目里的 `.ts` 配置 / eval 文件。核心实现位于 `src/`：类型契约在 `src/types.ts`，定义 API 在 `src/define.ts`，运行器在 `src/runner/`，评分器在 `src/scoring/` 与 `src/expect/`，执行上下文在 `src/context/`，可观测性在 `src/o11y/`，沙箱 provider 在 `src/sandbox/`，本地结果查看器在 `src/view/`。产品站点位于 `site/`，Mintlify 文档站位于 `docs-site/`，可运行示例位于 `examples/`。

## 文档路由：先读什么

本文件只保留仓库级总规则，正文都在下面四个入口后面，按需读：

- **建立设计心智 / 找某篇设计** → `docs/README.md`（按意图索引全部内部文档；标「设计提案(未实现)」的不是当前行为）。
- **把设计行为定位到源码**（仅实现与核对阶段用；讨论设计时现状以 docs 声明为准，docs 未声明视为未定稿、先补契约，不从源码反推） → `docs/source-map.md`。
- **动手前查踩坑** → `memory/INDEX.md` 对应分区，命中一行才读正文（见「记录问题的规范」）。
- **改 `docs-site/`** → 必须先读 `docs-site/AGENTS.md`（公开站的写作指南、术语表和校验规则）。
- **改观感 / 主题 / 色板** → 先读根目录 `DESIGN.md`（观感单源 basalt、公开令牌与类名边界、改色动线与守护）。
- **画图或改任何 SVG** → 必须先读 `docs/SVG-DESIGN.md`（底色、语义色、间距网格与共用样式）。样式整段抄 `docs/assets/_style.css`，不在单张图里发明 hex；盒标题与泳道名只能用正文已有的词，不在图里造简称。两条都由 `pnpm test:docs` 逐张图比对。

## 开发工作流
### 设计Agent
实现功能或者修复bug
- 变更 docs，写下预期的cli的用法与输入、写下library应该用用户怎么用这个api在代码中
- 同批在 `docs/engineering/testing/unit/<feature>.md` 的「覆盖规范」声明该变更的覆盖类别；实现 Agent 只为已声明的类别写测试，先声明后写测（规则见 `docs/engineering/testing/unit/registry.md`）
- 变更 docs-site，教用户如何使用该功能
- **设计只落 docs，不写执行计划。** 定稿的契约本身就是实现 Agent 的输入：要做什么写在 `docs/` 正文，为什么这么定写在正文的理由句或 `reference/`，翻案与弯路写在 `memory/`。不再单独维护一份任务分解——它会与 docs 正文重复一遍契约，并且落后于 docs 的下一次迭代。多 agent 并行按 docs 的目录边界切工作，不按计划文件里的节点切。
### 实现Agent
- 实现功能
- 在真实的eval相关的repo(如`/Users/ctrdh/Code/coding-agent-memory-evals`) 里面执行 pnpm exec niceeval xxx 测试输出是否与docs下面的预期一样。
- 如果不是cli相关功能，应该思考用户的用法是否一致

## 设计原则：beta，不背惯性包袱

niceeval 是 beta 软件，DX 可以随便改。做 API / CLI / 契约设计决策时可以打破一切惯性：不必顾虑向后兼容、已有用户习惯、行业惯例或「大家都这么设计」，从第一性原理出发想最理想的形态，破坏性的 API / CLI 重设计也完全可以做。惯性不是理由，理想形态才是标准；唯一的约束是定稿后按下面的「文档写作要求」落成声明式契约，并履行表格里的同步义务。

## 文档写作要求：结果进 docs，过程进 memory

写下任何内容前先按体裁路由到唯一的家：

- **结果（当前定稿的契约与行为）** → `docs/`（设计契约，给实现者）与 `docs-site/zh`（任务文档，给用户）。正文只写定稿形态，声明式表述。理由可以写——「为什么是组件树而不是判别联合」是契约的一部分；时间线不能写——「早先草案」「同日翻案」「现已改为」「2026-07 迭代」是过程。
- **过程（反复改、否决方案、踩坑、修法）** → `memory/`。设计翻案、砍掉的方案记成「设计裁决」条目（裁决 / 曾选方案 / 否决理由 / 日期）；docs 正文需要出处时链条目，不复述叙事。
- **变更审计（这次改了什么、为什么改）** → commit message，不落任何文档正文。

判据：把 docs 任何一段拿给没读过旧稿的人，契约信息完整、没有一个词要靠「知道以前长什么样」才能读懂，就合格。具体规则：

- 不写差分句——「去掉 X 后的类型」「删除了 Y」「不再是 Z」不落正文。
- 不留待定问题——「要不要 / 再议」在定稿前裁决，落进文档的只有决定和理由。
- 改设计时**重写受影响小节**，不在旧文上贴「现已改为」补丁。逐句自测：删掉这句丢契约信息就留；只丢历史，搬 memory 或直接删。
- 文档正文只写「要什么、是什么」，不写实现状态——「已实现」「未实现」「进行中」这类词不进正文，也不进状态行。功能文档先于代码定稿是正常流程，代码后续跟上；这个时间差不需要在文档里加免责声明。状态只用文档在 `docs/feature/`（当前契约）还是 `docs/roadmap/`（未定契约的提案）里的物理位置表达，一篇提案定稿后整篇搬进 `docs/feature/`，不在原地加状态标记。
- `docs/` 正文也是给人读的：行宽、句长、段落与用词四条排版规矩在 `docs/README.md`「写给人读」，禁词库在 `docs/writing-rules.json`。
- `docs-site/zh` 额外过「口语测试」与术语裁决，规则在 `docs-site/AGENTS.md`。

`docs/` 内部按内容性质分两类，`docs/README.md` 的「接着读哪一篇」索引按类分组、不混排：

- **功能文档**（`docs/feature/`，提案阶段在 `docs/roadmap/`）：回答「niceeval 能做什么、怎么用」的设计契约，读者是要用这个能力的实现者或用户侧协作者。一个功能一个子目录，子目录里按需拆成功能说明、CLI 预期反馈、架构等几篇——`docs/feature/adapters/` 现有的多文件结构是范例。心智模型、eval 写法、adapter/sandbox 接入、跑与看都属于这类。
- **工程文档**（`docs/engineering/`）：回答「niceeval 这个仓库自己怎么被验证、维护、跑分」的内部工程记录，不是能力说明——例如 tier 同步工具、e2e 自测方案、执行阶段 / 安装耗时一类 benchmark。新增文档先判断属于哪一类，工程文档不进给用户/实现者看的能力路径分组，单独成组；同一条「不写实现状态」规则同样适用。

一次设计迭代的落文档顺序：**① 分歧在对话里裁决**（不落文档）→ **② 先文档后代码**：按定稿重写 `docs/` 受影响小节与 `docs-site/zh` 对应页（文档写不顺说明设计有问题，回到 ①）→ **③ 改代码**，按下表履行验证与同步义务 → **④ 沉淀过程**：有翻案、弯路或反直觉修法的，记 memory 一条并索引；复盘确认的长期约束升格为本文件或 docs 里的一句规则。

| 改动 | 验证 | 收尾（同步义务） |
| --- | --- | --- |
| `src/` / `bin/` | `pnpm run typecheck`；改 CLI 行为再用 `pnpm run niceeval -- <命令>` 冒烟 | 公开面（导出类型/TSDoc/flag 表）变了：跑 `pnpm docs:reference` 重新生成参考页区块。参考页文案单源在源码紧邻注释——接口/函数看 TSDoc，CLI flag 说明写在 `src/cli.ts` `FLAG_OPTIONS` 各项的 JSDoc（缺注释生成器报错），生成脚本本身不承载文案（`{/* GENERATED */}` 区块内不要手改，`pnpm test:docs-site` 的漂移守护会拦）；新增/改名 flag 顺手核对 `src/i18n/` 两份 `--help` 速查（手工体裁，只点名常用 flag，不逐条生成）；可观察行为变了（flag、断言语义、结果格式、导出面）：grep `docs/` 与 `docs-site/` 同步声明，或记为明确的阶段性差异；修了 bug 补 memory 台账 |
| `docs/` 或根 README | `pnpm test:docs`（`test/docs/docs-consistency.test.ts` 查索引覆盖与链接真实性，`test/docs/docs-writing.test.ts` 查句长、段长、行宽、禁用写法与图里的用语，逐行该怎么改直接打在断言里；台账收紧跑 `pnpm test:docs -u`） | 新文档在 `docs/README.md` 挂一行索引；用词按 `docs/concepts.md` 立词，新禁用写法加进 `docs/writing-rules.json`（带 `use` / `why`）；`docs/writing-baseline.json` 只许变小 |
| `docs-site/` | `pnpm test:docs-site`（Vitest 守护 + `docs:validate` + `docs:links`，mint 那两步需 Node 22，见下） | 中文先定稿；英文入口按中文和当前代码核对后同步；`docs-site/zh` 每页 frontmatter 必须有任务视角的 title/description（包根 `INDEX.md` 由 `prepare` 打包时据此生成，缺了 `pnpm test:docs-site` 与发版都会红灯） |
| `examples/` 各 tier | `pnpm test`（`test/unit/example-tiers.test.ts` 查落后、冲突标记与 verbatim 铁律）；要同步跑 `pnpm tiers:sync`（动之前先读 memory 的 tier-sync 条目） | 文档 / README 链接示例必须指向真实目录 |
| `site/` | `pnpm run site:build` | — |
| `memory/` | `pnpm test:docs`（`test/docs/memory-index.test.ts` 查索引覆盖） | `INDEX.md` 加一行 |

测试按**验证对象**分三个入口，各对应一个 vitest project：`pnpm test`（代码，收 `src/**` 与 `test/unit/**`）、`pnpm test:docs`（`docs/` 与 `memory/`，收 `test/docs/**`）、`pnpm test:docs-site`（`docs-site/`，收 `test/docs-site/**`，再串 mint 的 `docs:validate` + `docs:links`）。归属由目录决定：新守护文件放进 `test/` 的哪个子目录就归哪个入口，不用改配置清单。边界与理由见 `docs/engineering/testing/unit/README.md`「套件边界与仓库守护」。

守护一律搭这三个命令的便车：仓库约定需要机器校验时，写成 `test/` 对应子目录下的 vitest 测试，不新增脚本、package.json 命令或 hook。判据是**说红绿的一律是 vitest，写产物的才是脚本**——一条约束只能有一个入口说它红，同一个检查既能由脚本判又能由测试判时，两边迟早给出不同结论，而人只会记得跑其中一条。`scripts/` 里同时干这两件事的（`sync-tiers.mjs` 的 sync/check、`docs-writing-lint.ts` 的检查/更新台账），检查那一半导出成不打印不退出的纯函数交给测试调用，生成那一半保留命令行。带待清理台账的守护不自建 `--update`：先判回归再对台账做文件快照比对，收紧走 `vitest -u`（顺序不能反，回归断言在前才保证更新模式写不进放宽的数字）。

**渲染面不做 src-grep 守护。** 样式、类名、DOM 结构是否真的生效只有真实产物能证明，不写「grep 源码提取类名 ↔ CSS 规则对齐」这类文本代理守护——它证明的是两段文本对得上，不是样式作用到了元素，且正是单元测试文档自己列的「grep 局部源码文本」反模式。这类缺陷的验收归 e2e 报告域对导出站的计算样式与几何断言（候选断言词表见 `docs/roadmap/e2e-acceptance-dsl/`）；单元层只测数据语义。详见 [memory 条目](memory/css-classname-grep-guard-retired.md)。

已批准的例外只有一个：`scripts/generate-reference.ts`（`pnpm docs:reference`，2026-07 用户明确批准）——参考页区块从源码 TSDoc 生成，包根 `INDEX.md` 的随包文档树从各页 frontmatter 生成（机制见 `docs/engineering/agent-docs/`）；它是生成器且挂在 `prepare` 打包链上，publish 时不能靠跑测试产出产物，两者的守护仍走 vitest（`test/docs-site/reference-consistency.test.ts`、`test/docs-site/bundled-docs-index.test.ts`）。

## Build, Test, and Development Commands

- `pnpm install`：安装依赖。
- `pnpm run typecheck`：运行 TypeScript 类型检查。
- `pnpm test`：跑代码单测与代码级仓库守护（`src/**` 与 `test/unit/**`，含 examples tier 同步、INIT.md 符号链接）。
- `pnpm test:docs`：跑 `docs/` 与 `memory/` 的守护（索引覆盖、链接真实性、句长段长行宽与禁用写法、用例登记）；加 `-u` 收紧 `docs/writing-baseline.json`。
- `PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm test:docs-site`：跑 `docs-site/` 的守护（生成区块漂移、随包索引），再跑 Mintlify 的构建校验与断链检查。mint 那两步需 Node 22。
- `pnpm run niceeval -- --help`：通过本地入口冒烟 CLI。
- `pnpm run site:dev` / `pnpm run site:build`：产品站点开发 / 构建。
- `PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm run docs:validate` / `pnpm run docs:links`：单独跑 Mintlify 的构建校验或断链检查（`test:docs-site` 已包含这两步，只想验一项时用）。

## Public Docs, Examples & README

公开文档有三层，更新时要保持一致：

- `docs-site/`：Mintlify 官网文档。`docs-site/docs.json` 管导航；顶层 `*.mdx` 是英文入口；`docs-site/zh/` 是中文入口、指南、参考和场景示例。
- `examples/`：可运行示例。当前完整示例在 `examples/zh/`。
- `README.md` / `README.zh.md`：仓库首页文案。只放稳定、短路径信息；详细教程链接到 `docs-site/` 或 `docs/`。

中文内容是产品叙事和场景示例的准绳。更新英文 README、英文 docs-site 或示例索引时，如果发现与中文 README、`docs-site/zh/`、`examples/zh/` 不一致，先按中文和当前代码核对，再把其它语言/入口同步过去；不要为了英文入口临时发明新的能力、路径或产品定位。

## Architecture Boundaries

保持 core 中立。core 负责 eval 发现、断言收集、评分判定、并发调度、缓存、报告和 artifact。`Agent` / Adapter 负责“连到哪个被测对象、协议怎么说”；`Sandbox` 负责“在哪里跑、如何隔离”。CLI、配置 schema、注册表可以按名字路由；运行器、评分、报告这些核心路径不要写 `agent == codex` 或 `sandbox == docker` 之类的行为分支。需要差异行为时，放到对应 Adapter、Sandbox 或中性的 hook。

## Site
开发 Landing Page 用的是 NextJS
<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may differ from your training data. Read the docs in `node_modules/next/dist/docs/` before coding.
<!-- END:nextjs-agent-rules -->

## Coding Style & Naming Conventions

项目使用 ESM + TypeScript，公共类型优先放在 `src/types.ts`，公共 API 从 `src/index.ts` 或现有子路径导出。沿用现有模块边界，不为单个 case 提前抽象新层。错误信息要直接说明问题和下一步，尤其是 CLI、配置和 eval 发现错误。注释可以用中文，但只解释不显然的设计约束或复杂流程。

**概念命名不用 Resolve 词族。** `Resolve` / `Resolved` / `Resolver` 不进新的类型名、函数名、文件名（docs 正文同规则，理由见 `docs/writing-rules.json`：口袋词，配置、维度、报告树、表格都能叫它，名字不携带具体动作）。按动作起名：解析什么、求值什么、归一成什么，就叫那个具体的名字。外部事实不受限：Promise 的 resolve 回调、Node 的 `path.resolve`、上游 API 的字段名照写。存量 `resolve*` 标识符不专项大改名，触碰该域时顺手改。

**给共享接口加可选字段：数着调用点过。** 跨多个调用点的接口 / 回调签名新增**可选**字段时，类型系统一次都拦不住：生产侧漏填是合法省略，消费侧不读新字段旧字段还在，两侧的回落分支（`x.code ?? x.key.split(":")[0]` 这类）让漏改在大多数 fixture 上恰好正确。加字段的那次改动必须包含一次**调用点普查**——grep 出全部构造点与消费点（消费点要 grep **旧**字段名，不是新字段名），逐个判定「该填 / 有意不填」，并配一条真正跑该字段生效路径的行为测试。`pnpm run typecheck` 绿不构成「所有实现方都接住了」的证据。能做成必选就别做成可选。详见 [memory 条目](memory/optional-field-additions-need-call-site-census.md)。

**字符串 key 索引的结构还要核对 key 与消费侧同源。** 上一条是构造点漏填；`Record<string, X>` 形态（表格的 `cells` × 列集是典型）还有方向相反的一半：写进去的 key 消费侧没有对应项时，取不到就按缺数据回落，两面都不报错、类型也不报错，症状是「这一格恒为 `—`」。共用的行构造函数被 N 种列集消费时，它写的每个 key 都要在这 N 份列集里各有交代；加列或加格子的那次改动 grep 该 key 出现在哪几个列集里，逐个判定。详见 [memory 条目](memory/cell-key-must-match-column-set.md)。

**一个字段能从两处以上来：先在 docs 定死解析链，再写 `??`。** flag / experiment / eval / config 各有一个同名字段时，`a ?? b ?? c` 少写一层类型系统一次都拦不住，而且只有**同时配了两层**的项目才露馅——单层配置的 fixture 和示例全绿。链里有「兜底层」时特别检查它有没有被提前物化成上游的值：把 `config` 的缺省提前塞进 run 配置，下游那层 `??` 就永远短路，症状是「eval 里写的值不生效」，报错还落在离改动很远的地方。解析顺序单点声明在对应功能文档里（`timeoutMs` 见[配置解析链](docs/feature/experiments/architecture.md#配置解析链一次求值处处同源)），新增来源的那次改动配一条「上层缺省 + 下层显式」的区分力测试——那一格是唯一会红的。详见 [memory 条目](memory/multi-source-field-resolution-order.md)。

## CLI Model

CLI 只有两类输入：位置参数选择“跑哪些 eval”（eval id 前缀），flag 选择“对着哪个 agent、怎么跑”。不要把 agent 名字、URL 或运行配置混进位置参数语义里；新增命令或报错时保持这个模型清晰。

## Git & Collaboration

直接在 `main` 上开发，不要为改动新建 feature 分支；若已有分支则合回 `main`。main 直推下 commit message 是唯一审计线索：说清改了什么行为、为什么，不写 `update` 这类空消息。

不要用 `git reset --hard`、`git clean`、`git checkout -- <path>` 或 `git restore` 去丢弃工作树改动，除非用户明确要求。工作树里出现你没写的改动时，把它当成用户或其他 agent 的工作，不要覆盖。提交前用 `git status` 和 `git diff` 确认只包含本次任务相关文件。

## Release

发版走 CI（`.github/workflows/release.yml`），**不要在本地 `npm publish`**（本地没有
发布凭证，publish 会 401/404）。触发方式只有一种：`git tag vX.Y.Z` → push tag 到
origin。标签号就是发布版本号，CI 自己从标签名解析版本号、在 runner 本地写入
`package.json`（不写回仓库，main 上不需要预先提交版本号变更）→ install（经 `prepare`
生命周期自动触发 `pnpm run build:report`，见下）→ typecheck → `pnpm publish`（NPM_TOKEN
secret，provenance）→ 创建 GitHub Release。预发布版（如 `0.5.0-alpha.1`）自动发对应
dist-tag，正式版发 latest。

包大部分发 TypeScript 源码（消费侧用 tsx 加载，无 build 步骤）；打包前生成的产物只有两个：
`src/report/**`（报告 web 面的 JSX）编译成 `dist/report/**` 预编译 ESM（`pnpm run
build:report`，见 `tsconfig.report-build.json`）；包根 `INDEX.md`（随包 AI 文档索引，不签入
git）由 `pnpm run build:index` 从 `INDEX.template.md` 与 `docs-site/zh` 各页 frontmatter
生成（机制见 `docs/engineering/agent-docs/`）。两者都挂在 `prepare` 链上。

## 记录问题的规范

发现基础设施 bug、API 限制或行为反直觉的地方时，记入 `memory/`（项目根目录下的 `memory/` 文件夹），不写进本文件。`memory/INDEX.md` 是索引兼维护规则——先读后动、写完即索引、已修标注、复盘升格，细则都在它开头，写或读 memory 时照做。

一条条目 = **现象**（什么错误、在哪复现）/ **根因**（为什么）/ **修法**（怎么改、落点文件或 commit、适用场景）。发现问题立刻记，趁上下文还在；修法反直觉（如「调大 timeout 反而让 session 更短」）时尤其要记。memory 同时是修法台账：已修条目不删除，留作后续复盘「这个修法合理不合理」的材料。
