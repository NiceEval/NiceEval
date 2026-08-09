# Phase Timings 与安装基准

本机制回答两个工程问题：一次 Attempt 慢在哪个阶段，以及不同 Sandbox provider / Agent adapter 的安装速度和成功率怎样比较。持久事实使用 owner-local named channel；`bench/` 是不写 Record 的本地工程工具。

## 持久 timing 契约

Runner 把有序阶段边界写入 Attempt-owned `niceeval.timing` channel。该 channel 的 descriptor、document/JSONL transport、coverage 与 decoder 服从 [Record Architecture](../../feature/record/architecture.md)；它不向 Attempt core 增加字段，也不需要 schema number、projector revision 或图引用。

阶段事实至少能表达：

- 稳定阶段名、开始偏移、持续时间和成功/失败状态；
- parent/child identity，用于恢复 phase → hook/turn → command 的树；
- turn 与 telemetry 的可选 correlation identity；
- collection/decoding partial，而不是把缺失内容补成零。

阶段使用有序、可扩展的 variant。decoder 遇到未知 variant 时保留已知条目并返回 partial；改变既有 variant 的含义时发布新 channel name，不在原名上加数字版本。

## 时间口径

- 主链按真实执行顺序写入 timing 条目：Sandbox queue/create、prepare、Agent ensure/setup、workspace baseline、Eval send/Judge、diff 与判定。
- 收尾链发生在主 Verdict 之后：Agent teardown、Sandbox cleanup/stop、telemetry close。收尾失败写 diagnostic/timing 事实，不反向改写已经形成的 Verdict。
- `durationMs` 只涵盖主链。收尾时间单列，避免“判定已结束但 finalizer 很慢”污染业务耗时。
- sibling 可以重叠，不能把 children duration 简单求和。`startOffsetMs` 用于表达先后与并行。
- `sandbox.queue` 与 `sandbox.create` 分开，避免并发度污染 provider 创建耗时。
- 命令证据有界且脱敏：保存 display、状态、exit code 与关联 identity，不保存 env value 或无限 stdout/stderr。

Attempt 总超时或取消时，当前打开阶段在中断时刻封口为 failed。无法可靠封口时 collection/decoding 必须呈 partial/invalid，不能伪造完整时间树。

## 消费边界

默认 Report 通过内建 timing requirement 请求通道。Attempt timing 详情是已选 Sample 中的参数化页面，例如：

```sh
niceeval show --run <runId> --page attempt-<attemptId>
```

跨 Run 比较重复选择显式 Run，并由 Calculation 按稳定阶段名聚合：

```sh
niceeval show \
  --run <baselineRunId> \
  --run <candidateRunId> \
  --report ./reports/timing-comparison.ts
```

Report consumer 只得到 `ChannelRead` 和 Sample 分母。它看不到 RecordReader、文件路径或 blob 路径，也不能在页面执行时重新读取通道。OTel span 仍由 telemetry channel 拥有；页面可以按 correlation identity 组合两项已请求的事实，但不把其中一项改成另一项的持久真源。

## `bench/` 本地工具

安装基准是仓库内的优化工具，不是 NiceEval 项目、Unit 或 CI 门禁。它直接调用 Runner 的单 Attempt 引擎，以同形内存 timing 值打印结果，但不创建 Record：

```text
bench/
  probes.ts
  stats.ts
  run.ts
  compare.ts
  .snapshots/
  README.md
```

典型命令：

```sh
npx tsx bench/run.ts docker --attempts 10
npx tsx bench/run.ts e2b --attempts 10
npx tsx bench/compare.ts bench/.snapshots/old.json bench/.snapshots/new.json
```

`bench/` 复用生产单 Attempt 生命周期，不能自己重排 Sandbox、ensure、setup、Eval 与 cleanup。探测用例使用公开 `defineEval()` 就地构造，但不调用模型；它只在 Agent 安装完成后运行版本/可用性检查命令。

```ts
export const codexProbe = defineEval({
  description: "codex 安装后可执行",
  async test(t) {
    const result = await t.sandbox.runCommand("codex", ["--version"]);
    if (result.exitCode !== 0) throw new Error("codex --version failed");
  },
});
```

每次采样把结果分成 provider 创建失败、Agent 安装失败和探测命令失败，不能只给一个“失败率”。默认 10 次用于区分首个冷启动与后续运行；涉及付费 provider 或模型调用时，仍须先取得用户批准。

## 比较纪律

- 同一轮只改变一个被测变量；provider、adapter 版本、机器和并发度写入 snapshot metadata。
- 同时报告首个样本、后续 median、min/max 与三类失败计数，不用单一均值隐藏冷启动。
- 比较脚本按预先定义的 noise-aware 阈值输出 regression、improvement 或 inconclusive；样本不足时不强行排名。
- `.snapshots/` 是本地工程数据，不进入 git，也不成为 Record 的第二套持久格式。

## 不变量

- timing 是 Attempt-owned named channel，不是 Attempt core、旧图事件模型或固定读取 revision。
- 未请求 timing 的 Report 不读取它；坏 timing 只影响声明它的 consumer。
- 大型命令输出如需保留，使用具名 Attempt channel/blob，不写入 generic fact。
- 用户停稳后可以编辑 timing channel；下次 reader 读取当前值，没有 hash、proof、revision 或 history 检查。
