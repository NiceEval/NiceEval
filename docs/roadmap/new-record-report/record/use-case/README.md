# 从 Attempt（一次独立执行）到 sealed Record（已封口事实集）

本用例只串起一次完整路径。类型、状态与错误的单一契约在 [Record 内部 Library](../library.md)，
本页不复制它们。

## 目标

作者希望评测一个 Agent 回复，并保留断言、OTel（OpenTelemetry 可观测性协议）、第三方能耗读数和
文件差异，以便后续的 Analysis（分析层）能够复核这些事实。

作者只写 Assertion-first（断言优先）代码：

```ts
export default defineEval({
  plugins: [agentObservability(), gpuEnergy(), workspaceDiff()],

  async test(t) {
    const turn = await t.send("完成任务，并说明做了什么。");

    t.check(turn.message, includes("完成"))
      .label("说明完成");
  },
});
```

这个调用点登记 Assertion（断言），但不给作者 Record writer、文件路径、SchemaId 或迁移能力。
三个 Plugin 的内部边界分别取得受限 Capture（采集能力），而不是共享一个任意写入器。

## 一次封口路径

```text
作者 Assertion
      │
Adapter、领域 SDK、文件差异采集
      │
AttemptCapture
      │ 验证 owner / definition / producer / cardinality
      ▼
完整 Attempt 附件
      │ 与 Run 附件一同原子 seal
      ▼
current Record（当前格式事实集）
      │
Analysis snapshot（分析快照）
```

1. runner 为这次 Attempt 创建受限 Capture。Assertion runtime 把 `t.check()` 形成的
   AssertionResult（断言结果）及其 Evidence（证据）封口到 Attempt 附件。

2. Adapter 把本次调用的 OTel span、用量、诊断和安全的 Evidence 提交到官方信封。它提交的是
   规范化输入，不能指定持久化路径、附件 schema 或 converter（转换器）。

3. `gpuEnergy()` 内的领域 SDK 只对已注册的 Metric token 封口。host 检查 token 是否属于该 Attempt，
   producer identity 是否匹配，以及声明的 coordinate 是否恰好齐全。

4. 文件差异采集把每个文件的 metadata（元数据）内联。小型、完整的 UTF-8 单文件 patch 内联文本。
   大型、二进制或多文件材料进入 Artifact（附属材料）blob（字节内容），metadata 留下精确引用。

5. 某些材料无法完整取得时，采集面提交 `partial`（部分采集）及其 limitation（限制原因）。内容按保留规则
   被省略时，提交 `elided`（明确省略）及其原因。两种状态都会随附件进入上层，不会被显示为没有变化。

6. Attempt 结束时，host 检查每项 Capture obligation（采集义务）已经恰好封口一次。它还检查
   owner、definition、producer、cardinality、Evidence 引用与 Artifact closure（引用闭包）。

7. Run 的其它 Attempt 和 Run 级 OTel 数据同样完成后，Record Host SDK 原子 seal Run。此刻形成新的
   current sealed Record；此前的任何失败、中断或漏封都只留下不可读取的未完成写入。

8. Analysis host 随后打开新的冻结快照。它只能看到已封口的 Record，并按自己的总体、分母和
   Evidence 口径产生闭合结果。Report 只消费这些结果并呈现到终端、网页或静态站。

## 旧格式的路径

如果快照打开时识别到已知旧格式，操作返回 `migration-required` 并要求：

```console
niceeval migrate
```

`niceeval migrate` 先形成只读计划，再对同一份 Record 执行显式迁移。不存在无损路径时，
返回 `migration-unavailable`；迁移中断时返回 `migration-interrupted`。Analysis 不接收旧格式，
也不会在读取中改写任何事实。
