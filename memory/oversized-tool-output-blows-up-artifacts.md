---
format: concord.document/v1
id: oversized-tool-output-blows-up-artifacts
title: oversized-tool-output-blows-up-artifacts
createdAt: 2026-07-13T14:23:41+08:00
createdAtSource:
  kind: first-recorded
  path: memory/oversized-tool-output-blows-up-artifacts.md
  commit: 4883d8ecdc4c392805cdc63779453105f0b66f3d
description: 一条失控 grep 让单个 attempt 的 trace.json 撑到 101MB,同一份 51MB 字符串在盘上存了三遍;修法是写入面统一截断
kind: memory
memoryKind: problem
state: resolved
epoch: 0
promotions: []
history: []
resolution:
  reason: 正文或对应 INDEX 明确使用“已修/已修复”；这是作者声明的事实，不等同于本视图验证证明。
  at: 2026-09-14T15:00:25.173Z
  epoch: 0
  kind: fixed
  evidenceLevel: attested
  attestation:
    statement: "**已修**(2026-07 复核):代码在 `5e7549eb`(results schema
      v8)随落盘截断一起实现,与上面的契约逐条对上——"
    proof: []
    source:
      path: memory/oversized-tool-output-blows-up-artifacts.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:b08c7c2eb403484b641da6712f0bba384b9e6d9c93095cc2644195bdc50611c1
---

**现象**:`coding-agent-memory-evals` 的 `.niceeval/dev-e2b_bub-e2b/2026-07-11T10-38-30-729Z-ua0x/memory/agent-037-updatetag-cache/a0/` 一个 attempt 占 159MB:

```
trace.json    106M   ← 只有 9 个 span,其中 1 个 execute_tool bash 占 99.9%
events.json    53M   ← 同一份内容的 action.result
diff.json      39B   ← 对比:文档里被点名"可达百 MB"的那个,实际 39 字节
```

同一快照里其它 trace 最大只有 1.6MB,这是极端离群值,不是普遍现象。

**根因**(三层叠加,缺一不可):

1. **agent 跑了一条会炸的命令**:`grep -R "cacheTag\|revalidateTag\|posts" -n app . | head -100` —— 递归 grep 扫进 `node_modules`。**`head -100` 只限行数不限字节**:输出确实只有 102 行,但里面有 minified 的 next.js bundle,**单行最长 4.2MB**,加起来 51MB。行数护栏对压缩过的单行文件完全无效,这是反直觉的地方。
2. **bub 的 instrumentation 把同一份工具结果发了两遍**:span attributes 里 `output.value`(OpenInference 约定)与 `gen_ai.tool.call.result`(GenAI semconv)**逐字节相同**,各 51MB → trace 106MB。
3. **niceeval 全链路没有任何体积上限**:`src/o11y/otlp/parse.ts` 原样透传 OTLP attributes,`src/o11y/otlp/canonical.ts` 的 `tagSpan()` 明确承诺「raw name / 既有 attributes 一律保留,只增不改,供 view 下钻」;事件归一化侧同样不削。所以 51MB 原样落盘 ×3。

**顺带被证伪的心智**:文档一直只给 `diff.json` 标「可达百 MB,所以必须懒」,`copySnapshots` 示例更是把 `trace` 放进发布白名单、把 `diff` 排除掉。真实分布正好反过来——照文档教的发布路径走,会把最大的文件发出去、把最小的排除掉。

**修法**(2026-07-13 定稿,契约落在 `docs/feature/results/architecture.md` 的「大值截断」):

- **运行时全量,落盘截断。** 截断只发生在 artifact 序列化那一刻;断言、`t.*` 作用域查询、`o11y.json` 派生统计都跑在完整值上。**截断永远不影响判决**——落盘是证据,不是评分输入。这条是整个设计的支点:有了它,截断就不需要任何 flag 或配置项。
- **落点唯一**:`snap.writeAttempt()`(`src/results/writer.ts`),不在 adapter / OTLP 解析 / 事件归一化里做。adapter 自己先削一刀会让断言看到不完整输出,是 bug 不是保护(已写进 `docs/feature/adapters/architecture/events.md` 不变量 7)。
- **上限**:`events.json` / `trace.json` 里任意字符串值 256 KiB(UTF-8,按字符边界回退);`sources` / `diff` / `o11y` 不截断。截断值末尾追加 `[niceeval] truncated <orig> → <kept> bytes`,并在 `StreamEvent` / `TraceSpan` 上打结构化 `truncated?: Truncation[]`(`{path, originalBytes}`)——marker 给人看,程序判断读结构化字段(「只给文本等于逼消费方正则解析」,与 Selection 警告同一条原则)。
- **明确不做 span 属性去重**:去重要判定「哪个 key 是 canonical」,那是 agent 侧属性约定,core 不该猜;截断之后两份各 256 KiB,重复代价可忽略。
- **writer 不设单文件总量上限,发布边界必须设。** 本地 writer 不能在预算耗尽时猜该丢哪条事件、span 或源码;`copySnapshots` 则在创建目标目录前对所有待发布文件做固定 50 MiB 预检,超限整体失败并给出排除 artifact / 重新生成历史结果的动作。逐值 256 KiB 只能防单值爆炸,不能被表述成整个文件「发布安全」。

`truncated` 是新增可选字段,按 [Architecture 版本规则](../docs/feature/results/architecture.md#版本与升级设计)不递增 `schemaVersion`。截断只对新写入生效,`copySnapshots` 不改 artifact 内容,历史上那个 101MB 不会被追溯截断;发布预检会在复制前拒绝它。

这只修 niceeval 的持久化爆炸。bub/tape 在把工具输出送进模型请求前仍需独立字节预算;否则 50 MB action.result 仍会先触发 413,results 只能保证这次失败不会再产出 101 MB trace。

**已修**(2026-07 复核):代码在 `5e7549eb`(results schema v8)随落盘截断一起实现,与上面的契约逐条对上——
`src/results/truncate.ts` 的 `ARTIFACT_VALUE_MAX_BYTES = 256 * 1024`(按 UTF-8 字节边界回退)、
`truncateEvents`/`truncateSpans`/`truncateCommands` 逐值截断并追加
`[niceeval] truncated <orig> → <kept> bytes` 文本 marker + 结构化 `truncated: [{path, originalBytes}]`;
落点唯一在 writer 侧(`src/results/writer.ts:352` 起的序列化路径),adapter / OTLP 解析 / 事件归一化
均未加削减,「运行时全量、落盘截断」的支点成立。`src/o11y/types.ts` 的 `Truncation` 注释也写明
「只由 results writer 在落盘时刻写入,adapter 不产出它」。回归覆盖:`src/results/results.test.ts`
「commands:stdout/stderr 超 256 KiB 时逐值截断并打结构化 truncated 标记」。

相关:[[view-sources-artifact-serving-not-dereferenced]]、[[static-site-export-drops-sources]]。
