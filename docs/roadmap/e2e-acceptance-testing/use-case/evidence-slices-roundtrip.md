# Use Case：Show 证据切片完整往返

## 目标

防止一次 CLI、Show 宿主、证据装配或候选包变更让 `niceeval show` 仍能启动，却把
`--source`、`--execution`、`--timing`、`--timing=full` 或 `--diff` 中的一部分从最终用户包里
静默丢掉。

这条 proof 测的是一个公开调试任务，不是五条互不相关的 flag smoke：用户从不带证据选项的
`show @<locator>` 得到证据入口，再用同一个 locator 依次读取源码、执行、时间和文件改动。
任何一段缺失，都意味着失败诊断链没有闭合。

## Behavior

稳定 ID 为 `reports.evidence-slices-roundtrip`，主证明属于 `report` E2E 仓库：

```ts
reportBehavior({
  id: "reports.evidence-slices-roundtrip",
  task: {
    repository: "niceeval",
    path: "docs/feature/reports/use-case/调试/按定位符下钻.md",
    anchor: "全流程",
  },
  contract: {
    repository: "niceeval",
    path: "docs/feature/reports/show.md",
    anchor: "一次调用-范围-切片-形态",
  },
  risk: "release-blocking",
  primary: {
    layer: "e2e",
    target: {
      entry: "cli",
      observations: ["process-result", "stdout"],
      boundaries: ["installed-package", "real-cli", "record-files"],
    },
    execution: {
      mode: "read-only",
      evidenceRecipeId: "report-evidence-slices-v1",
    },
  },
});
```

Recipe 产出一份冻结的确定性 Record，其中一个 attempt 同时具备以下有区分力的事实：

- source 树含一个具名被调文件与一条 send 标注；
- execution 含一个具名工具节点、输入和结果；
- timing 同时含 runner activity 与已关联的 OTel 节点，并有足够节点让 summary / full 不同；
- diff 含一个已修改文件，同时另有一份零净改动 attempt，用来区分“空”与“缺失”；
- locator 来自不带证据选项的详情页或 `--history` 的公开输出，不由测试重造。

## 完整测试

```ts
// test/behavior/debug/evidence-slices-roundtrip.test.ts
import { reportBehavior } from "../../support/behavior";
import {
  cli,
  reportView,
  shellArg,
  expectObserved,
} from "../../support/readback";
import { evidenceSlicesRoundTrip } from "../../support/behaviors";

reportBehavior(evidenceSlicesRoundTrip, async ({ w }) => {
  const locator = w.locator("tool-call/with-all-evidence");
  const cwd = w.consumerDir("report");
  const locatorArg = shellArg(locator);

  const overviewRun = await cli(
    `pnpm exec niceeval show ${locatorArg}`,
    { cwd },
  );
  const overview = reportView(overviewRun.stdout).attempt(locator);
  expectObserved(overview.evidenceCommands()).toShowExactRows([
    "source",
    "execution",
    "timing",
    "diff",
  ]);

  const sourceRun = await cli(
    `pnpm exec niceeval show ${locatorArg} --source`,
    { cwd },
  );
  expectObserved(reportView(sourceRun.stdout).attempt(locator).sourcePaths())
    .toShowRows(["evals/tool-call.eval.ts", "evals/helper.ts"]);

  const executionRun = await cli(
    `pnpm exec niceeval show ${locatorArg} --execution`,
    { cwd },
  );
  expectObserved(reportView(executionRun.stdout).attempt(locator).executionNodes())
    .toShowRows(["get_weather"]);

  const timingSummaryRun = await cli(
    `pnpm exec niceeval show ${locatorArg} --timing`,
    { cwd },
  );
  const timingFullRun = await cli(
    `pnpm exec niceeval show ${locatorArg} --timing=full`,
    { cwd },
  );
  const summaryTiming = reportView(timingSummaryRun.stdout).attempt(locator).timingNodes();
  const fullTiming = reportView(timingFullRun.stdout).attempt(locator).timingNodes();
  expectObserved(summaryTiming).toBeOrderedSubsetOf(fullTiming);
  expectObserved(fullTiming).toShowRows(["eval.run", "get_weather"]);

  const diffRun = await cli(
    `pnpm exec niceeval show ${locatorArg} --diff`,
    { cwd },
  );
  expectObserved(reportView(diffRun.stdout).attempt(locator).changedFiles())
    .toShowExactRows(["answer.txt"]);
});
```

每次 `cli()` 都必须断言 exit 0；上例省略的是通用 matcher 样板，不允许实现只解析 stdout 而忽略
process result。命令使用候选 tarball 安装后的 `pnpm exec niceeval`，不得 import `runShow()`、
renderer、flag 表或 evidence compute helper。

## 变更触发路径

执行登记使用分层 path set，而不是把整个 `src/report/**` 粗略绑到这条 Behavior：

| path set | 路径 | 为什么必须触发 |
|---|---|---|
| `show-cli-entry` | `bin/niceeval.js`、`package.json` 的 `bin` / `files` / lifecycle scripts、`src/cli.ts` | 能让命令或 flag 在安装包、解析、预扫、校验、派发任一处消失 |
| `show-slice-host` | `src/show/**` | 决定 locator 范围、切片互斥、summary/full 档位、文本/JSON 宿主输出 |
| `attempt-evidence-read` | `src/record/locator.ts`、`src/record/open.ts`、`src/record/attempt-evidence.ts`、`src/record/attempt-source.ts`、`src/record/annotated-source.ts` 及其直接拆分文件 | 决定 locator 能否回读，以及四类 artifact 是否被装配成同一个 attempt evidence |
| `attempt-evidence-components` | `src/report/components/attempt-detail/compute.ts`、`validate.tsx`、`src/report/model/conversions.ts`、`src/report/tasks.ts`、`src/report/definition/primitives/diff-lines.ts` 中被 Show 切片消费的导出及其直接拆分文件 | 决定 evidence 到 source / execution / timing / diff 领域数据的映射与 diff 文本 |
| `candidate-package` | `e2e/scripts/injection.ts`、`e2e/scripts/run.ts`、`package.json` 的发布文件清单与 lifecycle scripts、`tsconfig.report-build.json`、`scripts/prune-report-dist.mjs` | 防止源码测试绿、实际 tarball 缺入口、缺预编译 Report runtime 或装入旧产物 |

以下路径不默认触发整条 proof：

- AttemptDetails、Conversation 和 result view 等 Web 组合路径由
  [`reports.attempt-execution-evidence`](attempt-execution-evidence.md#变更触发路径)守护；共享 conversion / task
  导出改变 Show 切片时才同时触发本 Behavior；
- `src/report/**` 的其它 summary、chart、layout 和 web-only 组件不影响证据切片，走各自 Behavior；
- `src/runner/**`、`src/context/**`、`src/o11y/**`、`src/sandbox/**` 改变的是证据**生产**，先跑对应
  unit / adapter proof。只有改动同时触及落盘 evidence schema、artifact registry 或 Show 读取契约时，
  才追加本 Behavior；
- `docs/**` 只有修改 Show 证据切片契约、可运行命令或上述 path set 登记时触发；纯叙述和排版不触发。

删除、重命名或移动文件时，path 影响图必须按 Git diff 的新旧路径共同匹配，不能只匹配最终树。
共享 helper 的影响通过 TypeScript import graph 扩一跳；不得为了省事把 `src/shared/**` 全量纳入。

## 旧 bug kill 与定位

准入时保留两个最小 mutation：

1. 从 CLI option 表删掉 `timing` 或 `source`，必须在 `invoke` 阶段以命令、exit、stderr 和候选包
   digest 报错；
2. 保留 flag，但断开 `runShow` 的对应参数或 evidence component，必须在 `observe` / `outcome`
   阶段列出 locator、期望切片、实际切片和 evidence 文件。

这两种 mutation 分别证明“参数存在”和“参数真的贯穿产品”。只断 `--help`、只断未带证据选项的详情页里出现
下钻提示，或直接调用内部函数，都不能替代这条 proof。

## 频率与边界

- 上述任一硬触发 path set 变化时，本地变更卡与每个 PR 必跑；不需要模型、网络或 secret。
- 发布 tag 在候选 tarball 上再跑一次，防止发布文件清单与工作树执行面分叉。
- adapter 定期 lane 继续用真实协议验证 evidence 内容来源；它不能替代本题的确定性 CLI 闭环。
- `--json` 各 evidence view 的信封与完整字段另归机器出口 Behavior；本题主证明是人读 CLI 调试链，
  不把所有机器形状揉进同一场景。
