# Getting Started

这一页从一个 Eval 运行到可审阅、可搬运的 sealed Record。完整 API 见 [Eval](feature/eval/README.md)、[Experiments](feature/experiments/README.md)、[Inspection](feature/inspection/README.md) 与 [Insight](feature/insight/README.md)。

## 安装

~~~sh
pnpm add -D niceeval
pnpm exec niceeval init
~~~

`init` 创建项目入口和配置示例。使用 TypeScript 的项目建议采用 ESM；CLI 可以装载 ESM 或 CommonJS 宿主下的 TypeScript 文件。

## 写一个 Eval

在 `evals/greeting.ts` 中定义一次检查：

~~~ts
import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  async test(t) {
    const turn = await t.send("用一句话介绍 NiceEval");
    t.check(turn.message, includes("NiceEval"));
  },
});
~~~

值、行为、Sandbox 和 Judge 检查都会形成 Attempt-local assertion 数据。断言无法取得必需材料时显示为 `unavailable`，不会按通过或零分处理。

## 选择运行配置

Experiment 选择 Eval、Agent 和本次调度条件。把配置放在 `experiments/`，再运行：

~~~sh
pnpm exec niceeval exp
~~~

每个选中的 Experiment 建立一个 Run。Run 的 expected slots 是本次分母；每个 slot 最终连接到精确 Attempt：实际执行形成 origin，沿用或显式采用形成 reference。

命令结束时显示 Invocation receipt，其中包含 `runIds`。receipt 很小：详细的 Verdict、用量、计时、conversation 和 diff 都在停稳 Record 中。

## 查看一次运行

~~~sh
pnpm exec niceeval view --run <run-id>
~~~

默认 Record root 为 `<project>/.niceeval/record/record.sqlite`。这是 Host-owned operational database，绝不能复制、进入 Git
或直接传给 `--record`。不要读取其中的内部结构，也不要从应用代码 import Record reader / writer。`view` 由内部 Record Host 和
Inspection operations 读取它，不从目录时间猜测“最近结果”，也不在浏览器内读取文件。

要让 AI 或自动化发现可查询的已封口事实，使用：

~~~sh
pnpm exec niceeval query discover
~~~

不带 selector 的 `view` 打开默认 overview。`query discover` 先返回 compact bootstrap；再以 operation request 查询 sealed facts。旧结果不会被删除；需要查看精确历史时使用 receipt 中的 `--run` 或 locator。

## 读懂状态

Inspection operation 保留 selection 已建立的完整分母：`--run` 使用具名 Run 的完整 expected slots，默认 selection 只把身份仍
匹配当前目标的 slots 纳入结果。selection audit 说明每个已选 slot 是下列哪一种：

| 状态 | 含义 |
|---|---|
| `included` | 有合法 Member，能读取其采用的 Attempt。 |
| `not-recorded` | expected slot 没有 Member。 |
| `invalid` | Member、Attempt 或引用违反核心规则。 |
| `excluded` | Inspection selector 在既有 Run 上排除了该 slot。 |

Attachment 状态与 slot 状态分开。页面需要的 Attachment 若未采集，会显示 `unavailable`；当前 reader 不支持时显示 `unsupported`；损坏时显示具名 issue。

## 编辑与再次查看

Record 是 immutable whole-Run 的持久事实集。`query` 与 `view` 使用短 reader 读取 sealed cutoff，可以和 writer 并发。

每个 query result 在关闭 reader 后不再访问 Record。Insight 只保留完整 Snapshot generation；需要不同事实时发布新 Run 或在 operational View 中确认 refresh。

operational database 只由 Host 修改。不要手工编辑、复制或拼接 main/WAL 文件；需要搬运时生成新的 `RecordSnapshot`。

## 分享封口事实

~~~sh
pnpm exec niceeval record snapshot --output ./release.record-snapshot
~~~

Snapshot 是 sealed-only 的 portable Record artifact。接收者使用 current NiceEval runtime 的 `view --record ./release.record-snapshot` 打开它。它不是静态站点，也不承诺匿名 URL、离线浏览或业务脱敏。

## 接进 CI

在 CI 中运行同一条 `niceeval exp` 命令。进程退出状态结合 Invocation completion 和 Verdict；
机器调用方使用 `query` 的 `niceeval.query/v1` document 读取已停稳结果，不打开 Record 私有文件或 reader API。

## 接着读

- [Record](feature/record/README.md)
- [Inspection](feature/inspection/README.md)
- [Insight](feature/insight/README.md)
- [缓存与携带](feature/experiments/cache.md)
- [Assertions](feature/assertions/README.md)
