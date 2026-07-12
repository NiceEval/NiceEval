# TODO：docs ↔ 代码对齐的剩余欠账

> 来源：2026-07-12 的 docs/ 与代码一致性审计（30 条）。文档侧的漂移**已全部收口并提交**（`31a850a` 及其之前的六个 docs commit）；本文件只登记**仍需动代码**的欠账，以及一份新暴露出的设计缺口。
>
> 每条独立可执行，互不阻塞。**不要在同一个 commit 里做两条。**
>
> 不在本文件里：Benchmark 阶段计时（`AttemptRecord.phases`，`docs/engineering/benchmark/README.md`，commit `946df65`）——用户明确单独处理。

## 已经处理掉的（不必再看，防止重复劳动）

- **文档写错、代码是对的** → 已按代码重写文档：判定优先级（`errored > failed > skipped > passed`）、`Config` 的 `name`/`workspace`/`telemetry`/`PriceOverride`、`.eval.tsx` 发现、`Sandbox` 接口快照、`t.group` / 沙箱二进制 IO / `noFailedShellCommands`、`readSourceFiles(opts)` 签名、`EvalDef.setup`、`ExperimentDef.maxConcurrency`、`uploadDirectory` 的 `opts.ignore`、`AgentContext.reasoningEffort`、judge 无 key 时静默 no-op、`aiSdkAgent` / `aiSdkOtel`、codex 鉴权（`CODEX_API_KEY`，无 login/profile）、`classifySnapshot` / `exitOnViewUserError` / `estimateCost` 等名字、`resolveLocator`、并发推荐值（vercel=1，不是「云的可以开大」）、`architecture.md` 的源码树。
- **代码有 bug、文档是对的** → 已改代码：`t.loadedSkill()` 改读 `skill.loaded` 一等事件（原先是 `calledTool("load_skill")` 的糖，在 Claude Code 上永远断不中）；`EvalDef.setup` 返回的 `Cleanup` 原先被 `attempt.ts` 丢弃、从不执行，现已在 finally 里 LIFO 调用。
- **文档描述了不该存在的能力** → 已删：AI 失败分类 / `classification.json`（commit `4176eea`）。

---

## A. 文本面「列对齐」没有标准件，官方与用户组件不对等

**性质**：设计缺口。不是某一处写错，是**公开面缺了一层**——照现在的文档写自定义组件，遇中文必歪。

**现象**。`niceeval show` 的表格是列对齐的产物：

```text
STATUS      EVAL                                ATTEMPT     RESULT                              DURATION  COST
✓ passed    memory/agent-037-updatetag-cache    @160iuj3h   —                                   2m 0s     $0.09
✗ failed    memory/swelancer-manager-proposals  @1qrdcfq8   expected 4, received 1 · equals(4)  50.0s     $0.05
```

官方组件靠 `src/report/text/layout.ts` 画出它（`stringWidth` CJK 记 2 列、`padDisplay`、`renderAlignedRows`、`textBar`、`wrapDisplay`、`joinColumns`）。**这个模块一个符号都没从 `niceeval/report` 导出。** 于是 `docs-site/zh/guides/custom-reports.mdx`「换形态」现在明文教用户手搓：

```tsx
text({ rows }, { width }) {
  const bar = (n: number) => "█".repeat(Math.round(n * 10)).padEnd(10, "░");
  return rows.map((r) => `${r.key.padEnd(8)} ${…} ${r.display}`).join("\n");
}
```

三个缺陷，文档在教一个 bug：`String.prototype.padEnd` 数的是 **UTF-16 码元不是显示列宽**（agent 名/eval id 一带中文整张表就撕歪，而这正是本仓库最常见的场景）；列宽 `8` 硬编码，不随内容也不看 `ctx.width`；数字列**没法右对齐**——`renderAlignedRows` 现在除末列外一律左对齐，右对齐这个能力官方自己都没有。

「内置报告只是一份普通的用户报告」这条主张（`plan/built-in-reports-user-parity.md` 正在数据面兑现），在 text 面**目前不成立**。

**目标形态**，两层：

**第 1 层 —— `<Table>` 双面原语**（绝大多数「tab 一样的机制」就是一张表；与 Row / Col / Section / Text / Style 同级，没有特权）：

```tsx
<Table
  columns={[
    { key: "eval", header: "EVAL" },
    { key: "pass", header: "PASS", align: "right" },
    { key: "cost", header: "COST", align: "right" },
  ]}
  rows={[
    { key: "memory/foo", locator: "@160iuj3h",
      cells: { eval: "memory/foo", pass: "87%", cost: "$0.09" } },
    { key: "memory/bar",
      cells: { eval: "memory/bar", pass: null, cost: null } },   // null → 统一渲染 —
  ]}
/>
```

- **text 面**：列宽 = 该列最宽格的**显示宽度**（CJK 记 2 列），列间 3 空格，首行表头；`align: "right"` 按显示宽度右对齐（数字列可读的前提）。
- **web 面**：`<table>` + `<thead>`/`<tbody>`；右对齐落成 class 不是内联样式；`className` 照常可挂钩、配 `<Style>` 上样式。
- **缺数据 `null` → 渲染 `—`，不补 0**：两个面同源，与既有诚实契约一致。
- **超宽策略**：总宽超 `ctx.width` 时优先压最宽的**文本**列（折行），真放不下才截断并**如实标注剩余**——「截断报剩余」是既有契约，不在这里破例。
- **行可选带 `locator`**：带了就自动接证据室（text 面走 `ctx.attemptCommand`、web 面走 `ctx.attemptHref`），自定义表与官方表通同一间证据室。

**第 2 层 —— 文本排版工具箱，从 `niceeval/report` 导出**（表以外的形态仍要手写 text 面；逃生舱里必须有官方组件用的同一把尺子，否则「对等」是假的）：

| 导出 | 来源（`text/layout.ts`） | 为什么必须公开 |
|---|---|---|
| `stringWidth(text)` | `stringWidth` | **`.length` / `.padEnd` 一定会错的那一步**；不给它，用户的表遇中文必歪 |
| `padEnd` / `padStart` | `padDisplay` / `padStartDisplay` | 按显示宽度补齐;右对齐数字列靠 `padStart` |
| `wrapText(text, width)` | `wrapDisplay` | 按显示宽度折行 |
| `indent(block, prefix)` | `indentBlock` | 嵌套块缩进 |
| `bar(ratio, width)` | `textBar` | 字符条（文档里那个手搓 `"█".repeat(…)` 的正解） |
| `columns(blocks, widths, sep?)` | `joinColumns` | 多块并排 |

`renderAlignedRows` **不单独导出**：能力由 `<Table>` 承担，公开两条并行路径只会让作者选错。

**第 3 层 —— 官方组件重建在其上**（对等的构造证明）：`AttemptList` / `EvalList` / `ExperimentList` / `MetricTable` / `DeltaTable` / `Scoreboard` 的 text 面改走 `<Table>`。官方组件用不上的能力，用户就拿不到；官方绕过 `<Table>` 手搓，`<Table>` 就一定会长歪。

**不在范围**：`src/show/render.ts`（证据室切片 `--execution` / `--eval` / `--diff`）不是报告组件，是 CLI 自己的渲染器，继续直接 import 内部 `layout.ts`。

**阶段**：

1. **文档定稿**（先文档后代码）：`docs/feature/reports/library.md` 写 `<Table>` props 契约与工具箱导出表；`docs-site/zh/guides/report-components.mdx`「排版原语」把清单改成 Row / Col / Section / Text / Style / **Table**，示例**必须含中文**（证明不歪）；`docs-site/zh/guides/custom-reports.mdx`「换形态」**删掉 `.padEnd(8)` 示例**、改成「表格用 `<Table>`，非表格用工具箱」两条路，补一句为什么不能用 `String.padEnd`。验收：`docs:validate` + `docs:links`（需 Node 22）。
2. **实现**：`renderAlignedRows` 加 per-column `align`（默认 left，不传时逐字节同旧输出）；`primitives.tsx` 实现 `Table` 双面组件（TSDoc 写全，参考页从 TSDoc 生成）；`report/index.ts` 导出 `Table` / `TableProps` + 工具箱六函数。测试加：**中文列宽**（`stringWidth` vs `.length` 的回归护栏）、`align: "right"`、`null → —`、超宽折行。验收：`pnpm run typecheck`、`pnpm test`、`pnpm docs:reference`。
3. **官方组件重建 + 真实冒烟**：六个表状组件 text 面改走 `<Table>`；`src/show/show.test.ts` 既有断言**不许改**——官方表输出应逐字节保持（右对齐是新增能力，不是把现有列改成右对齐；改视觉要另开裁决）。在 `/Users/ctrdh/Code/coding-agent-memory-evals` 跑 `pnpm exec niceeval show` 冒烟，再写一个含中文列的自定义报告跑 `--report` 确认不歪。

---

## B. Coding Agent 的 Skills / Plugins：文档定稿，代码是旧形状

**性质**：文档先行，代码欠账（不是漂移，不需要「以哪个为准」的裁决）。

**定稿契约**在 `docs/feature/adapters/coding-agent-skills-plugins.md`（commit `1dbc6b1`）：

- 跨 coding agent 共享的结构化 `SkillSpec`（本地 / repo 两种来源，可钉 `ref`，可只启用多 Skill 仓库里的一部分）；
- **不引入统一 `PluginSpec`**——Claude Code 与 Codex 各有各的 native plugin 契约（`ClaudeCodePluginSpec` / `CodexPluginSpec`，各自显式带 marketplace 的 name/source/ref 与 plugin name）；
- `McpServer` 独立成一类，不塞进 plugin 联合；
- Bub 专属 `PythonPluginSpec`；
- 安装结果落 `agent-setup.json`，已同步进 Results Format(`docs/feature/results/architecture.md`)与 Results 库(`library.md`)。

**代码现状**：`src/agents/claude-code.ts` 只有 `ClaudeCodeConfig.skills?: string[]`（只能表达 GitHub `org/repo`，setup 里跑 `npx skills add`），表达不了本地 Skill、钉 commit/tag、仓库内选择性启用；`agent-setup.json` 完全没有；Codex 侧只有 `mcpServers`。

**落点**：`src/agents/{claude-code,codex,bub}.ts` 的 config 类型与 setup；`src/agents/types.ts`（`SkillSpec` 的家）；`src/results/`（`agent-setup.json` 的写入与读取面）。类型要让无效组合**编译期**就不成立（Bub 收不到 MCP、Codex 收不到 Python plugin），不是运行时 fail fast。

**注意**：`memory/npx-skills-add-headless-hang.md`（`npx skills add` 在 headless 沙箱里默认交互式选 agent 会卡死，必须 `-y -a <agent>`）和 `memory/codex-no-native-skill-tool.md`（Codex 没有原生 skill 工具，装了也未必读）动手前必读。

---

## C. `src/` 注释里 85 处指向已不存在的文档

**性质**：文档重组（`docs/*.md` → `docs/feature/*/`）后留下的死指针。注释里指错路径比不指更糟——照着找的人会以为文档没了。

| 已不存在的路径 | 引用次数 | 现在的家 |
|---|---|---|
| `docs/reports.md` | 43 | `docs/feature/reports/{README,library,architecture,show,view}.md` |
| `docs/results-format.md` | 21 | `docs/feature/results/architecture.md` |
| `docs/results-lib.md` | 12 | `docs/feature/results/library.md` |
| `docs/view.md` | 4 | `docs/feature/reports/view.md` |
| `docs/scoring.md` | 3 | `docs/feature/scoring/README.md` |
| `docs/sandbox.md` | 2 | `docs/feature/sandbox/README.md` |

**不能盲 sed**：引用形如 ``docs/reports.md「宿主输入的组合语义」``，原 `reports.md` 的内容已按小节拆到 5 个文件里，得**逐条按小节名判断落到哪一份**。后五行的映射是 1:1 的，可以先批量处理；`docs/reports.md` 那 43 条要人工分派。

**顺手**：`docs/README.md` 的索引与 `test/docs-consistency.test.ts` 只看 `docs/` 内部链接，管不到 `src/` 注释——这批死链没有守护。收口后可考虑给一致性测试加一条「`src/` 注释里的 `docs/…md` 路径必须存在」，按仓库约定写成 `test/` 下的 vitest，不新增脚本。
