# `config.report` 项目默认报告 + `--report` 收内建视图名:实现 TODO

契约已定稿,**一律以 docs 为准,本 plan 只列落点不复述契约**:

- 三档取值链、`--report` 值判别、错误反馈、dev 重载语义:`docs/feature/reports/architecture.md#外壳与页装载规范化`
- 用户面入口与「项目默认报告」小节:`docs/feature/reports/README.md#项目默认报告`
- 字段位置与作用:`docs/concepts.md`「配置词汇」表
- 内建视图名表 = `niceeval/report/built-in` 具名导出:`docs/feature/reports/library/built-in.md`
- CLI 侧操作步骤与报错样例:`docs/feature/reports/show/reports.md`(Case 7)、`docs/feature/reports/show.md`、`docs/feature/reports/view.md`
- 用例全流程(第 6/7 步):`docs/feature/reports/use-case/report-shared-show-view.md`
- 测试覆盖类别:`docs/engineering/testing/unit/reports.md`「报告取值链与 `--report` 值判别」
- 用户文档:`docs-site/zh/tutorials/custom-reports.mdx#设成项目默认`、`docs-site/zh/reference/define-config.mdx`

## TODO

- [ ] **A. 类型与配置面**
  - [ ] A1. `src/runner/types.ts` 的 `Config` 加 `report?: ReportDefinition`,TSDoc 按 docs 定稿写(参考页文案单源在这里);注意 `ReportDefinition` 来自 `src/report/definition/report.ts`,确认 runner 类型模块 import 它不会把 report 侧拉进 runner 运行路径(只 import type)。
  - [ ] A2. 校验:`config.report` 在场且 `isReportDefinition()` 为假时,报与文件默认导出非法同一类反馈,只换出处一句(点名 `niceeval.config.ts` 的 `report` 字段)。落点跟着装载器走,不在 `loadConfig` 里另起一套。
- [ ] **B. 装载器:三档取值链与值判别**(`src/report/runtime/load.ts` + `src/report/runtime/host.ts`)
  - [ ] B1. `--report` 值形态判别(纯函数,先于任何 IO):含 `/`、以 `.` 开头、或 `.ts`/`.tsx`/`.js`/`.mjs` 后缀 → 文件路径;其余裸词 → 内建视图名。判别只看字符串,不探测文件系统。
  - [ ] B2. 内建视图名表:从 `niceeval/report/built-in` 的具名导出取,不另立注册表常量(新增内建视图时名表自动跟随)。裸词未命中报错列出可用名字 + 提示路径写法(文案见 `show/reports.md` Case 7 样例)。
  - [ ] B3. 取值链归一:`--report` → `config.report` → 内建默认导出,产出同一个 `ReportDefinition`,两宿主共用同一个入口函数(现有 `host.ts` 的装载规范化点)。
  - [ ] B4. mtime cache-busting 的入口是「实际装载的那个文件」:`--report <文件>` 是报告文件,`config.report` 是配置文件;依赖不追踪的既有语义不变。
- [ ] **C. 两个宿主接线**
  - [ ] C1. `src/show/index.ts`:裸跑不再直接取内建默认导出,改走 B3 的取值链;show 目前是否已装载项目 config 要先确认——没有就补一次装载(与 `niceeval exp` 同一个 `loadConfig`),且**没有 `niceeval.config.ts` 时不能报错**(show/view 读的是结果根,允许在没有配置的目录里跑)。
  - [ ] C2. `src/view/`(本地 server 与 `--out` 同一条 `SitePlan`):同上,取值链结果进 `viewData.report`;`--out` 的静态导出同样消费这一份。
  - [ ] C3. 现有互斥规则(`--report` × `--json` / `--history` / `--stats`)不因新取值形态改变;`config.report` 在场时这些互斥仍只针对显式 flag,不因为「有默认报告」就改判用法错误。
- [ ] **D. 文案与 i18n**
  - [ ] D1. 新错误 key 进 `src/i18n/` 两份词典:裸词未命中内建名表、`config.report` 非 `defineReport` 产物。
  - [ ] D2. `src/cli.ts` `FLAG_OPTIONS` 的 `report` JSDoc 改写(值收名字或文件、取值链、`--report standard` 回内建)→ 跑 `pnpm docs:reference` 重生成 `docs-site/*/reference/cli.mdx` 与 `define-config.mdx` 的 GENERATED 区块;核对 `src/i18n/` 两份 `--help` 速查是否点名 `--report`。
- [ ] **E. 单测**:按 `docs/engineering/testing/unit/reports.md`「报告取值链与 `--report` 值判别」类别写,断言面是解析出的 definition 引用与错误对象。其中「fixture 里存在同名 `./site.tsx` 时 `--report site` 仍报错」这条必须真跑,它是「判别只看字符串」的唯一证据。
- [ ] **F. 真实项目冒烟**(在 `/Users/ctrdh/Code/MemoryBench` 跑,核对输出与 docs 预期一致)
  - [ ] F1. 无 `config.report` 时裸 `show` / `view` 与今天一致(无回归)。
  - [ ] F2. 配上 `report: site` 后裸 `show` / `view` 装载自定义报告;`--page`、eval 前缀收窄、`@locator` 下钻照旧。
  - [ ] F3. `--report standard` 回到内建;`--report site` 报错文案与 `show/reports.md` Case 7 一致。
- [ ] **G. 同步义务**
  - [ ] G1. `docs/source-map.md` 补取值链与名表解析的落点行。
  - [ ] G2. 英文 docs-site 入口(`tutorials/custom-reports.mdx`、`reference/define-config.mdx`)按中文与最终代码核对后同步;`docs:validate` + `docs:links`(Node 22)。
  - [ ] G3. `pnpm test`(docs 一致性 / 参考页漂移守护)与 `pnpm run typecheck`。
