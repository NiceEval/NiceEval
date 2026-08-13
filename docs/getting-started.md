# Getting Started

这一页从一个 Eval 运行到可查看、可分享的 Report。完整 API 见 [Eval](feature/eval/README.md)、[Experiments](feature/experiments/README.md) 与 [Reports](feature/reports/README.md)。

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
pnpm exec niceeval show --run <run-id>
pnpm exec niceeval view --run <run-id>
~~~

默认 Record root 为 `<project>/.niceeval/record/`。它是可整体复制或进入 Git 的 opaque
目录；不要读取其中的内部结构，也不要从应用代码 import Record reader / writer。`show` 和
`view` 由内部 Report host 读取它，不从目录时间猜测“最近结果”，也不在浏览器内读取文件。

若要选择每个 Experiment 最后完成的 Run，使用：

~~~sh
pnpm exec niceeval show --latest
~~~

`--latest` 只考虑带 `completedAt` 的 Run。没有完成 Run 时，改用明确的 `--run`。

## 读懂状态

Sample 保留完整分母。样本状态（Sample slot state）说明每个 slot 是下列哪一种：

| 状态 | 含义 |
|---|---|
| `included` | 有合法 Member，能读取其采用的 Attempt。 |
| `not-recorded` | expected slot 没有 Member。 |
| `invalid` | Member、Attempt 或引用违反核心规则。 |
| `excluded` | 选择器在既有 Sample 上排除了该 slot。 |

Attachment 状态与 slot 状态分开。页面需要的 Attachment 若未采集，会显示 `unavailable`；当前 reader 不支持时显示 `unsupported`；损坏时显示具名 issue。

## 编辑与再次查看

Record 是 immutable whole-Run 的持久事实集。`show`、`view` 与 export 使用持有 shared maintenance lease 的 frozen reader，可以和 writer 并发。

宿主形成 `ReportExecution` 并关闭 reader Scope 后，Report execution 与静态站不再访问 Record。需要不同事实时发布新 Run，不局部编辑已发布 Attempt。

不要在 writer 或 reader lease 存续时编辑目录。Record 不保存编辑事务、历史副本或全局格式整数。

## 导出静态报告站

~~~sh
pnpm exec niceeval view --run <run-id> --out ./report-site
~~~

export 包含页面、组件宿主数据、精确 runtime、下载项和资源。生成后的站点可离线打开，不需要源 Record 或之后安装 NiceEval。

## 接进 CI

在 CI 中运行同一条 `niceeval exp` 命令。进程退出状态结合 Invocation completion 和 Verdict；
机器调用方使用 `show --json` 读取已停稳结果，不打开 Record 私有文件或 reader API。

## 接着读

- [Record](feature/record/README.md)
- [Sample](feature/sample/README.md)
- [Reports CLI](feature/reports/README.md)
- [缓存与携带](feature/experiments/cache.md)
- [Assertions](feature/assertions/README.md)
