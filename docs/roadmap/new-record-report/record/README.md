# ① Record（持久事实层）

Record 保存一次运行已经发生、已经封口且可离线复核的事实。它不是面向用户的扩展层：attachment definition（附件定义）、writer（写入器）和 migration（迁移）都由 NiceEval 自己拥有。

```text
NiceEval 内部定义                         对外领域 API

defineInternalRecordAttachment()         Assertion / OTel / event / diff collector
        │                                           │
        ▼                                           ▼
InternalRecordAttachment<Value> ───────▶ owner-bound capture（归属者绑定采集）
        │
        ├─ current schema（当前格式）
        ├─ adjacent migrations（相邻迁移）
        └─ snapshot projection（快照投影）──▶ AnalysisInput
```

## 心智模型

Record 是“由 NiceEval 维护的事实协议”，不是“用户可增加字段的数据库”。固定 Run、Slot、Attempt、owner（归属者）、reference（引用）与 completion（完成标记）的 Record Kernel（事实最小内核）；Assertion、OTel、事件和文件差异再通过统一的内部 attachment 机制附着到 Run 或 Attempt。

这样仍保留 definition（定义）的价值：

- NiceEval 新增一种官方事实时，不必修改通用 writer 的分支逻辑；
- 每一种事实明确声明 typed schema（类型化格式）、owner、基数和大小限制；
- schema 必须改变时，由拥有该定义的 NiceEval 模块提供相邻 migration；
- Analysis 只依赖 NiceEval 发布的稳定 `AnalysisInput`，不读取 attachment payload。

但这些能力不形成公共 SPI（服务提供者接口）。外部 package 不能注册 attachment、converter（转换函数）、物理表或 migration。Adapter 只能通过 NiceEval 已发布的 OTel、event、Artifact 和 diff collector 提交受支持的数据。

## Definition 与 Operation

| Record 部分 | 可见性 | 做什么 |
|---|---|---|
| Definition（定义） | NiceEval 内部 | 定义 attachment 的 ID、owner、基数、当前 schema、限制和相邻 migration |
| Capture operation（采集操作） | 通过领域 API 间接使用 | Assertion、Adapter 与 collector 在当前 Run / Attempt 中提交事实 |
| Read operation（读取操作） | Record Host SDK | 只读取当前版本、已封口的事实，并向 Analysis 签发输入 |
| Maintenance operation（维护操作） | Record Host SDK | 按相邻版本逐步迁移，并原子发布当前格式 |

普通 Eval 作者只使用 Assertion-first（断言优先）API。Adapter 作者使用某个已有 collector；两者都不取得 root writer（根写入器）、Record reader（事实读取器）或 definition registry（定义注册表）。

## 内建 Attachment 使用同一机制

| 内部 Definition | owner | 典型字段 |
|---|---|---|
| Assertions attachment（断言附件） | Attempt | AssertionResult、Evidence refs、完整度 |
| OTel attachment（可观测性附件） | Attempt / Run | span、event、usage、diagnostic |
| File diff attachment（文件差异附件） | Attempt | path、change kind、hash、partial / elided 状态 |
| Artifact attachment（材料附件） | Run / Attempt | media type、大小、完整度和 blob ref |

这些 definition 共用 Capture、校验、封口、读取与迁移机制。这里的“通用”只表示 NiceEval 内部没有四套特殊 writer，不表示外部可以扩展持久协议。

## 保存边界

```text
sealed Run Core（已封口运行核心）
├─ Run-owned internal attachment
└─ Attempt
   └─ Attempt-owned internal attachment
      ├─ definition ID + version
      ├─ producer identity
      ├─ typed payload（类型化载荷）
      └─ ArtifactRef ──▶ content-addressed blob（内容寻址材料）
```

小型结构化字段内联在 attachment payload。大型文本、二进制、图片和多文件 diff 写入 blob，payload 只保存精确引用、媒体类型、大小与完整度。

一个 Run 只有在 Core、全部 attachment、Artifact 和引用闭包都验证成功后才原子封口。草稿、锁、verified cache（已验证缓存）和 staging（暂存区）不是持久事实。

## Migration 心智模型

一个内部 definition 只声明相邻迁移：

```text
v1 ── migration 1→2 ──▶ v2 ── migration 2→3 ──▶ v3 current
```

Record maintenance 按顺序一次运行一条 migration。每一步先用旧版本 schema 验证输入，运行纯 converter，再用下一版本 schema 验证输出。不能跳过中间版本，也不能在普通读取时临时转换。

整份 Record 的迁移过程是：

1. 从当前 NiceEval 安装版本取得完整内部 definition registry（定义注册表）。
2. 在 staging 中逐 attachment、逐版本运行相邻 migration。
3. 验证迁移后的 Core、owner、基数和引用闭包。
4. 再次检查 root identity（根身份）与计划身份。
5. 原子发布当前格式；任一步失败都保留旧 Record。

旧版本超过当前 NiceEval 的迁移支持范围，或内部迁移链缺失时，这是 NiceEval 的版本契约错误，不要求用户安装第三方 converter。普通 Analysis 不读取旧 payload；用户只能升级到包含所需迁移的 NiceEval 版本并显式运行 `niceeval migrate`。

## SDK 边界

| 入口 | 面向谁 | 提供什么 |
|---|---|---|
| NiceEval internal Record definitions（内部事实定义） | NiceEval 维护者 | attachment 与相邻 migration 定义；不从 package 导出 |
| Assertion / Adapter collector | Eval 或 Adapter 作者 | 只提交 NiceEval 已支持的领域值 |
| `niceeval/record/host` | Application Host（应用宿主） | snapshot、write session、maintenance session 与自动锁生命周期 |

Analysis 不读取物理文件或内部 attachment。Record Host SDK 把当前事实投影成 NiceEval 发布的 `AnalysisInput`。Report 不读取 Record，只消费 Analysis 的闭合结果。

## 入口

- [Library](library.md) —— 内部 definition、领域采集面、Host 读取和逐步迁移 API。
- [Use Case](use-case/README.md) —— OTel attachment 在 NiceEval 内部升级、写入、读取和迁移的完整路径。
