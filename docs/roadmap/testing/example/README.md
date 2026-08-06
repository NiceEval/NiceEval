# 可读测试 Example

这里展示选定方案的**测试正文**，不是另一个框架实现。四个文件分别代表四个独立场景 Repo；为了并排比较作者体验，
文档把它们集中在本目录。实现时每个文件放回自己的真实用户项目，与 package、lockfile、config、Eval、Experiment、Report
和 `e2e.json` 一起运行。

旧 example 用 15 个文件表达一条 Report 结果，读者要依次理解 Behavior、Recipe、World、Execution、Observed、Registry 和
Retirement。现在从测试文件开始读即可：完整命令、实际结果、独立预期、bug 引用和失败检查点都在一屏内。

## 先读哪几个文件

| 文件 | 回答的问题 | 历史 bug / 风险 |
|---|---|---|
| [`cli-show-json-pipe.test.ts`](result/cli-show-json-pipe.test.ts) | 大 JSON 经真实 pipe 是否完整交付 | `d8d5a84b` |
| [`report-chart-tooltip.test.ts`](result/report-chart-tooltip.test.ts) | 静态报告中的真实 hover 是否产生用户可见结果 | `d489dfd4` |
| [`adapter-tool-identity.test.ts`](result/adapter-tool-identity.test.ts) | 真实 SDK 工具事件能否从公开出口读回规范身份 | `060a6a05` |
| [`first-eval-to-report.test.ts`](journey/first-eval-to-report.test.ts) | plan、run、debug、export 的跨域用户目标是否闭合 | 长 Journey |

[`support/process.ts`](support/process.ts) 只有 spawn、严格 JSON / NDJSON parse 和诊断，不知道 NiceEval 的 verdict、target 或正确答案。

## 每个文件实际住在哪种 Repo

```text
e2e/
├── cli-large-show/
│   ├── package.json
│   ├── pnpm-lock.yaml
│   ├── e2e.json
│   ├── niceeval.config.ts
│   ├── agents/deterministic.ts
│   ├── evals/large-output/payload.eval.ts
│   ├── experiments/large-show.ts
│   └── test/show-json-pipe.test.ts
├── report-charts/
│   ├── package.json + pnpm-lock.yaml + e2e.json
│   ├── niceeval.config.ts
│   ├── evals/ + experiments/charts.ts
│   ├── reports/charts.tsx
│   └── test/chart-tooltip.test.ts
├── adapter/codex-sdk/
│   ├── package.json + pnpm-lock.yaml + e2e.json
│   ├── niceeval.config.ts
│   ├── evals/tool-call/shell.eval.ts
│   ├── experiments/tool-call.ts
│   └── test/tool-identity.test.ts
└── journey-first-eval-to-debug/
    ├── package.json + pnpm-lock.yaml + e2e.json
    ├── evals/onboarding/{passes,fails}.eval.ts
    ├── experiments/onboarding.ts
    └── test/first-eval-to-report.test.ts
```

真实实现必须签入生成的 lockfile；这里不手写一份会过期的示意 lockfile。根 runner 只在临时副本里把 `niceeval` dependency
替换成候选 tarball，并在安装后核对解析身份。

## 最小 package 与 Manifest

每个 Repo 都是普通项目，不依赖 workspace：

```json
{
  "name": "niceeval-e2e-cli-large-show",
  "private": true,
  "type": "module",
  "scripts": { "test": "vitest run" },
  "dependencies": { "niceeval": "^0.10.2" },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.7.2",
    "vitest": "^3.2.4"
  }
}
```

```json
{
  "schemaVersion": 1,
  "id": "cli-large-show",
  "areas": ["cli", "report"],
  "lanes": ["pr", "main", "release"],
  "executor": { "kind": "host" },
  "command": ["pnpm", "test"],
  "timeoutMinutes": 8,
  "secrets": [],
  "paths": ["src/cli.ts", "src/show/**", "src/report/tasks.ts"],
  "artifacts": ["artifacts/**", "test-results/**"]
}
```

manifest 不描述“要看到 tail sentinel”；这个 expected 只在测试文件。

## CLI Result：真实 pipe 与大结果

`cli-large-show` 使用确定性 agent；Eval 不调用模型，而是产生足以超过 128 KiB 的断言结果，最后一个预期包含
`tail-sentinel`。这是真实 NiceEval Eval / Experiment，不是预烘 `.niceeval`：

```ts
// evals/large-output/payload.eval.ts
import { defineEval } from "niceeval";
import { equals } from "niceeval/expect";

export default defineEval({
  test(t) {
    for (let index = 0; index < 5_000; index += 1) {
      const expected = index === 4_999 ? "tail-sentinel" : `expected-${index}`;
      t.check(`actual-${index}`, equals(expected));
    }
  },
});
```

测试先真实运行 `pnpm exec niceeval exp` 产生结果，再用真实子进程 pipe 调 `show --json`。它同时检查字节规模、JSON 可解析、
信封身份和尾部 sentinel；只检查 exit 0 或只检查输出长度都抓不住截断。

## Report Result：真实用户动作

[`report-chart-tooltip.test.ts`](result/report-chart-tooltip.test.ts) 的 expected 是 fixture 里签入的
`main / task-a / 0.75`，不是从候选导出的图表点反推。测试依次证明：

1. Experiment 真实运行成功；
2. `view --out` 真实导出成功；
3. 浏览器能按可访问身份找到该数据点；
4. hover 后 tooltip 可见且包含三个业务值。

它不读取 `.niceeval-chart-dot`、不 `waitForTimeout(100)`，也不因为页面“有一个 tooltip DOM”就通过。

## Adapter Result：真实协议身份

[`adapter-tool-identity.test.ts`](result/adapter-tool-identity.test.ts) 位于 Codex SDK live Repo：

- 真正运行 `pnpm exec niceeval exp tool-call`，不是把 SDK event 手写进 E2E；
- 通过公开 history 确认预期 Eval 被调度且 passed，避免 discovery 少排后假绿；
- 把公开 locator 交给 `show --execution --json`；
- 断言规范 `tool` 包含字面量 `shell`，且不退化成 `unknown`。

同一 bug 还应在根仓库保留一条小型 transformer Unit，用手写上游事件精确定位 mapping。Unit 拥有完整事件种类矩阵，
live Result 只证明真实 SDK 接线。

Adapter Repo 的 manifest 进入 `main / nightly / release` 并声明 secrets；另一个无密钥 Docker protocol Repo 在 PR 中注入断流和 5xx。
两者不能互相冒充。

## Journey：从运行到定位再到报告

[`first-eval-to-report.test.ts`](journey/first-eval-to-report.test.ts) 保留用户真实顺序：

```text
pnpm exec niceeval init
pnpm exec niceeval exp onboarding --dry --json
pnpm exec niceeval exp onboarding --rerun all --json
pnpm exec niceeval show onboarding/fails --history --json
pnpm exec niceeval show @locator --execution --json
pnpm exec niceeval view --out artifacts/site --no-open
浏览器打开失败 Eval，并看到同一个 locator
```

它不是把所有 CLI 矩阵再测一次。独有命题是：plan 选中的身份能进入 run，run 产生的 locator 能跨到 show，再进入导出报告。
每个接缝立即断言，因此不会把“根本没排到 Eval”最后报成“页面缺链接”。

Journey Repo 的初始状态刻意没有 config，由 `init` 生成；Eval / Experiment 是签入的用户源码。该 Repo 独占自己的结果根，
不与 CLI / Report Result 共享 `.niceeval`，所以不存在“这段必须排在最后”。

## Unit：同一个 Bug 怎样更快定位

Adapter live Result 报“公开证据没有 shell”时，下面的 Mechanism owner 进一步区分纯转换算法：

```ts
// wrong algorithm: command_execution 只保留 raw name，没有 canonical tool。
// live E2E 能发现接线坏了，但无法穷举四种 ThreadItem；这里拥有完整转换矩阵。
test.each([
  ["command_execution", "shell"],
  ["file_change", "file_edit"],
  ["web_search", "web_search"],
])("Codex %s 映射为 %s", (rawType, expectedTool) => {
  expect(canonicalToolForCodexItem(rawType)).toBe(expectedTool);
});
```

Result 指出坏在“真实 SDK → NiceEval 公开 readback”边界，Unit 指出坏在规范化映射；不在 E2E 里增加内部探针。

## 为什么这个 Example 更中立

- 真实 Repo 只是用户现场，不宣称自己是覆盖模型；
- 原生断言可直接评审，也允许将来换 runner；
- 候选 manifest 只拥有运行条件，不能替测试生成答案；
- 示例同时展示短结果和长 Journey，不把一种粒度强行套全部风险；
- 代价写清楚：没有机器生成的全仓 Behavior 图，多个 Repo 会重复少量进程 helper，live Adapter 仍有成本和波动；
- 只有重复 parser 确实造成误诊后才提取更强抽象，不先建设平台再寻找用途。
