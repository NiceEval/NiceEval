# Schema 演进证据

本页回答两个问题：为什么现有 Record 经常升 `schemaVersion`，以及 graph v2 如何证明普通功能不再推动容器升版。
逐版事实来自 [`results-schema-version-history`](../../../../memory/results-schema-version-history.md)，现行格式行为来自 [Record Architecture](../../../feature/record/architecture.md#版本与升级设计)。

## 现有链路为什么变化面大

现有格式让整个 Run、`result.json` 与全部 artifact 共用一个顶层 `schemaVersion`。
新增证据还要进入 artifact registry、writer 参数、reader loader、`AttemptRecord.artifacts` 与 `publish({ artifacts })`。
任一真正破坏性字段变化都会让整份历史 Run 不可读、不可携带；实际成本见 [`schema-bump-invalidates-all-history`](../../../../memory/schema-bump-invalidates-all-history.md)。

同一个报告功能在两套设计中的修改面如下：

| 功能 | 现有链路 | graph v2 | frozen core 变化 |
|---|---|---|---|
| 增加 Agent 对话轮数 | 增加或消费 artifact、loader、measure 与发布名单 | 已有 Turn 事件时只增加 Projector 与页面 | 否 |
| 增加首 token 延迟 | 扩展 timing/result 类型、writer、reader 与报告 | 新事件 payload、timing Projector 与页面 | 否 |
| 增加 trace 瀑布图 | 接入 `trace.json`、artifact registry、loader、publish 与页面 | telemetry node、trace Projector 与页面 | 否 |
| trace 增加 attribute | 修改共享 `TraceSpan` 或 artifact 形状 | 新 telemetry media type 或新 Projector | 否 |
| 修改成本算法 | 处理 `result.json` 中旧成本字段的语义 | 新 evaluator/Projector identity，历史 Claim 不覆盖 | 否 |
| 增加源码或 diff 下钻 | 新 artifact、reader 方法和 publish 词干 | 新 payload、strong edge 与 Projector | 否 |
| 报告发布 trace | 调用方手工把 `trace` 放进 artifact allowlist | Export Plan 的 `basedOn` 自动形成强闭包 | 否 |
| 单个 trace 超过 Git 限制 | 发布失败、排除证据或重新运行 | segment node 与 chunk-index node 自动扩展 | 否 |
| 修改 Report 页面或字段 | 页面改动可能反推共享结果类型 | 只改 Report；读模型变化时升级 Projector | 否 |
| 新增 bundle、签名或加密交付 | 扩大顶层格式或另造旁路文件 | 新 subject、wrapper 或 attestation payload | 否 |
| 改变 frozen core 或 object-ID 信任语义 | 整份格式升版 | 先过版本升级防火墙，确实无解才讨论 v3 | 可能 |

## 同一功能的代码对照

现有 writer 和 publish API 要显式认识每一种 artifact：

```ts
await run.writeAttempt(result, {
  commands,
  events,
  trace,
  o11y,
  agentSetup,
  diff,
  sources,
});

await publish(sample, target, {
  artifacts: ["commands", "events", "trace", "sources"],
});
```

增加 `httpArchive` 时，writer、registry、reader 与发布调用方都必须知道这个新词干。

v2 把 HTTP archive 写成新 payload，并把它引用的 chunk 明确列入 strong edge。
下面是 writer 内部边界示意；generic verifier 与 copier 不理解 archive 的业务字段。

```ts
const chunks = await graph.putChunks(rawHttpArchive);

const httpArchive = await graph.putNode({
  payload: {
    mediaType: "application/vnd.example.http-archive-index.v1+json",
    bytes: indexBytes,
  },
  dependencies: chunks.map((target) => ({
    relation: "dev.example.chunk",
    target,
  })),
});

await record.attach(attempt, "dev.example.evidence", httpArchive);
```

`record.attach()` 同时增加领域 catalog entry 和所属 node 的 strong edge。
如果第三方 payload 没有依赖，`dependencies` 是 `null`；它不能把 DescriptorV1 藏进未知 body。

报告依赖通过 Projector 声明，不通过文件名单猜：

```ts
const plan: ReportExportPlan = {
  report: { name: "network", version: "1", parameters: {} },
  inputs: [{ id: "source", recordId, graph: recordGraph }],
  projections: [{
    id: "requests",
    attempt: { inputId: "source", attemptId },
    projector: { name: "http-requests", version: "1" },
  }],
  pages: [{ route: "/network", projectionIds: ["requests"] }],
};
```

如果旧 Record 没有 HTTP archive，Projector 返回 `not-recorded`。
它不能把缺失解释成零请求，也不能要求给 Record payload 补一个 `httpArchive` 字段。

## 1→15 反事实回放

下面不是迁移方案，而是检验 v2 表达力的历史测试。
如果过去的变化仍要求改 LayoutV2、DescriptorV1、GraphNodeV1、EdgePageV1 或 GraphRootV1，v2 就没有解决原问题。

| 旧版本变化 | 在 v2 中的归属 | 是否改变 frozen core |
|---|---|---|
| 1→2→3 `flags` / `params` 往返改名 | 新 Provenance payload media type；旧 node 原样保留 | 否 |
| 4 run 聚合改成逐执行目录 | 新 Run/Attempt payload 与领域 relation | 否 |
| 5 locator 与源码内容寻址 | 新 identity/source payload 与 relation | 否 |
| 6 字符串 error 改结构化 error | 新 error Observation 或 Claim media type | 否 |
| 7 `operation` 改 `phase` | 新 lifecycle event schema 与 Projector | 否 |
| 8 Assertion、diff、coverage 大改 | 各自发布新 payload schema | 否 |
| 9 `has*` 改 artifact registry | 领域 catalog 挂任意 node，strong edge 保证复制 | 否 |
| 10 source role 与 caller path | 新 source Provenance media type | 否 |
| 11 snapshot 改 Run、增加 runId/locator | 新 entity/relation schema，bootstrap 不认识业务名 | 否 |
| 12 diff `binary` 并入 `elided` | 新 diff media type，旧 diff 不重解释 | 否 |
| 13 TimingNode 改 TimingActivity、phase 改 origin | 新 timing event schema 与 Projector | 否 |
| 14 `coverage` 改 `evidenceCoverage` | 新 Claim media type | 否 |
| 15 command 增加必填 `checked` | 新 command Observation schema | 否 |

这张表证明所有已知历史变化都不需要修改 frozen core。
它不证明未来不存在未知基础问题；下面用实现机制、攻击输入和规模变化继续反证。

## 红队反例回放

| 场景 | v2 表达或反馈 | 是否需要 v3 |
|---|---|---|
| gzip、zstd 或多层 wrapper | 新 wrapper payload；encoded object 走 strong edge | 否 |
| 加密与多个 recipient | 新 encryption payload；密文与 key envelope 分别引用 | 否 |
| 签名、timestamp、透明日志证明 | 引用 sealed Graph root 的 attestation payload | 否 |
| 多 Record bundle 或组合交付 | 新 bundle subject，以 strong edge 引用成员 | 否 |
| 单 writer checkpoint | 新 open Graph root，再更新 `layout.json.head` | 否 |
| 并发 writer | single-writer lease 或按旧 head compare-and-swap；冲突方重试 | 否 |
| 远端内容仓库或 partial clone | locator 属于 transport；本地缺对象返回 `missing-object` | 否 |
| GC 与跨 Record 共享 | 从全部保留 head 使用同一 strong-edge walker 做 mark-and-sweep | 否 |
| 超大 catalog | catalog node 与 Edge page 分别分页，所有文件仍小于 16 MiB | 否 |
| 新 digest 算法 | Digest 注册表追加算法；旧 reader 返回 `unsupported-digest` | 否 |
| JCS 重复 key 或实现差异 | frozen core 严格拒绝；跨 runtime 语料守护相同字节 | 否 |
| sealed 后收到迟到事实 | 写新 Graph root 与 lineage；旧 Claim 仍绑定旧 root | 否 |
| 脱敏、选择性披露或权限变化 | 导出新的闭包或 encryption payload，不改原 sealed graph | 否 |
| 恶意深图、重复边或伪循环 | visited set 与资源预算保证终止，并返回资源限制 | 否 |
| digest 路径穿越或大小欺骗 | 路径解析器先校验算法、编码和 size，再访问文件系统 | 否 |
| 相同 digest、不同 media type | typed reference 比较完整 DescriptorV1，不以 digest 合并 | 否 |
| 未知复合 payload | 所有容器依赖在 strong edge；opaque body 不参与遍历 | 否 |
| packfile、CDN 或镜像源 | 只改变 transport；取得字节后仍按 DescriptorV1 验证 | 否 |
| mutable URL 成为事实权威 | 违反 immutable payload 与内容寻址前提 | 可能 |

这些反例说明普通产品功能不需要 v3，但也暴露了 v2 必须先冻结的边界。
如果 bootstrap 仍写 `record | report`，仍让领域 Catalog 决定 object→object 闭包，或 EvidenceRef 仍只写 digest，这张表就不成立。

## 版本升级防火墙

v2 先固定五个可检查的不变量：

1. **Bootstrap**：Layout 只发现一个 immutable Graph root，不认识 Record、Report 或其它领域 kind。
2. **Typed reference**：digest 定位字节；完整 DescriptorV1 决定 media type、size 与语义引用身份。
3. **Strong closure**：opaque payload 之外只有一套可分页强依赖；copier、verifier、GC 与 exporter 共用 walker。
4. **Graph root**：sealed 只表示封口时闭包完整、字节验证通过且 root 不可变，不表示真实性、保密性或本地对象齐全。
5. **Extension isolation**：五种 frozen core 不增加字段；所有新增语义只进入新 payload 或安全追加的 payload 可选字段。

任何容器升版提案必须逐项回答：

1. 需求能否表示成有限、不可变的 typed payload？
2. payload 的全部容器依赖能否写成 strong edge，而不要求 generic walker 解码 body？
3. 旧 reader 能否按 frozen core 验证引用、遍历并原字节复制未知 payload？
4. wrapper、attestation、metadata、bundle、分页或新 Projector 是否已经能隔离新语义？
5. 新 reader 读取旧 v2 时，能否用 `not-recorded` 或局部 unavailable 如实表达？
6. 提案是否保持 typed reference、Graph root、sealed 和既有 payload media type 的解释不变？
7. 实现是否区分 unsupported、missing-object、resource-limit、corrupt 与 not-recorded？

七项都是“能”时，提案必须留在 v2。
只有以下情况才允许提出 v3：

- frozen Layout 字节无法继续安全解析。
- `mediaType + digest + size` 不再足以形成 typed reference。
- 未来权威内容无法表示成有限 immutable payload 与显式强依赖。
- sealed Graph root 的闭包或不可变语义必须改变。
- core parser、canonicalization 或 object-ID 信任存在无法用新 payload 隔离的安全缺陷。

增加 digest 算法不是自动升版理由；旧 reader 可以识别语法并明确拒绝未知算法。
只有已经受信的 object-ID 安全含义整体失效，并且旧 reader 会继续错误信任时，才属于最后一种情况。

## 兼容性质测试

实现不能只靠评审声称兼容，至少要持续验证以下性质：

1. 未知 node 引用未知 blob 时，旧 copier 复制完整强闭包，并保持所有 bytes、digest 与 size。
2. 相同 digest、不同 media type 的两个 DescriptorV1 不得被 EvidenceRef、缓存或 visited set 混同。
3. 相同 `recordId`、不同 Graph root 的 evidence 不得交叉解析。
4. 持久化 Claim 只保存 EvidenceTarget；把最终 GraphRootRef 写进 Claim 的构造必须因内容哈希自引用而被拒绝。
5. Reader 从某个 sealed Graph root 读取 Claim 后，返回的每个 EvidenceRef 都限定到该 root。
6. 增加未知 node 后，旧 reader 的全部已知 Projection 保持相同。
7. 新 reader 读取缺少新 node 的旧 fixture 时，只有对应能力是 `not-recorded`。
8. 不支持 wrapper codec 时，verifier 与 copier 仍能处理该分支；依赖功能返回 `unsupported-capability`。
9. 签名失败只影响 authenticity 结果，不把字节完整的 sealed graph 判成 corrupt。
10. partial clone 缺对象时返回 `missing-object`，不得变成 `not-recorded`、`open` 或 `corrupt`。
11. 恶意深图、重复边和伪循环必须在预算内终止，不能无限递归或耗尽内存。
12. 两个 writer 同时更新 head 时，一个 compare-and-swap 必须失败，不能静默覆盖另一个 checkpoint。
13. core JCS 语料覆盖 duplicate key、非法 UTF-8、`-0`、指数、Unicode 排序和超安全整数。
14. `../../x`、未知算法、大小写混杂和超长 digest 必须在访问文件系统前被拒绝。
15. GC 面对两个 Graph root 共享同一 node 时，删除一个 head 不能回收仍可达的 node。
16. 迟到事实形成新 Graph root 后，旧 Report 仍解析旧 root，不能混用两个版本的 event。
17. Report 子集导出必须包含 source Graph root 到 EvidenceTarget 的有效 membership proof，以及 target 的全部强闭包。
18. membership proof 不得迫使导出无关 sibling payload，也不能携带无 strong edge 关联的秘密 node。
19. 改变 segment 或 chunk 边界只能改变物理 NodeRef，不能改变 logical digest 与 Projector 结果。

这些测试支持一个有边界、可证伪的承诺：

> 对任何能表示为有限、不可变 typed payload，并显式列出强依赖的普通 Record 或 Report 功能，v2 不升级容器。
> 旧 reader 仍能验证和复制；新 reader 读取旧数据时只缺对应能力。
