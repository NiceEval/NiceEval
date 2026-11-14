# 去掉不需要的版本号、协议标识与迁移

## 要决定什么

按 [T-40](../taste.md#t-40)，NiceEval 改了格式或行为时旧结果直接拒绝并重跑。代码与契约里仍有约 87 处版本号、协议标识、revision 计数与迁移设施，大部分只为让旧数据继续可读或为同一安装的读写两端互相核对。
本设计决定每一组怎样处理。逐项位置与依据见盘点报告（父 agent 保存的 `/tmp/version-inventory.md`，条目编号沿用该报告）。

非目标：不改变第三方按契约构建的边界；不删除本来就不是格式版本的计数（发布 revision、租约代数、文件内容 revision）。

## 处理

### Record 存储（#01–#28）

- 整个 Record 只有一个格式标记，写在存储本身。打开时标记不符就在建立 reader / writer 之前拒绝，消息说明这是旧版本 NiceEval 写下的结果、需要重跑或删除该存储；不自动清空。
- 删除 SQLite 的历史 baseline、旧 DDL、自动迁移、备份与迁移状态机，以及 legacy RunContext、旧 Evaluation bridge 与 Record maintenance 的迁移 API。新库仍原子初始化。
- 官方 Attachment family 不再各自带 persistence revision 或 `schemaVersion`；保留稳定的 family 名、owner、精确的当前 payload 校验、完整度与内容闭包。第三方 persistence 不受影响。
- 删除 Assertions、AgentTurns、AdapterUsage 等族的 v1…vN codec、历史 entry 与相邻 transform。
- 内建 criterion 的 identity 去掉 `/vN` 后缀；当前同时存在、含义不同的变体（例如 occurrence 的两种）用描述含义的名字区分，不用数字。
- 普通 Judge、Agent Judge、模拟用户审计里的多层 protocol / schemaVersion 标记删除，形状由当前 Schema 决定。
- Record 内部哈希的域分隔字符串保留分隔作用，去掉 `/v1` 后缀。

### 身份（#29–#48）

- 删除身份域登记表、`encoding-only` 重建、发布快照与旧域样例守护。NiceEval 改变身份计算时，身份自然变化，所有受影响结果重跑。
- manifest 仍按组件列出身份输入；NiceEval 自身计算方式变化时，`--dry` 显示为 NiceEval 身份变化，而不是用户输入变化。
- Agent Judge 的 prompt 与工具 schema、普通 Judge 的渲染与安全指令、内置 preset 与 binary 判据文本改为直接哈希实际文本与 schema，不再手写 revision。
- 保留无法由内容表达的代码行为计数，且只在用到该能力的 Eval 身份里出现：Agent Judge 与普通 Judge 的算法、模拟用户的行为、`EVALUATION_ALGORITHM`、执行时长策略。
- Before cache 的 replacement 算法标签、声明与计划的编码版本、interpreter 与 ledger 默认排除表改为内容哈希或删除；Provider planner、opaque command 与 installer 的 revision 属于作者或第三方声明，保留。

### 机器输出（#49–#55、#65、#69、#75、#83）

`show --json`、`exp --json` 的 receipt 与 NDJSON、`exp --dry --json`、cache inventory、View 内部 wire、continuation token 与 Judge profile 都不带 `protocol`、`format` 或 `schemaVersion`。同一安装的读写两端天然一致。

### 用户级持久数据（#40、#56–#62）

UserDatabase、Docker / Incus 注册表、远端 snapshot 存储与账本、OTLP 内部存储各自只有一个格式标记，不符时拒绝并说明需要清理哪一份数据；删除各自的迁移链与历史 baseline。

### 保留（D）

第三方按契约构建的边界保留各自的标识：adapter 契约 `niceeval.agent/v1`、plugin、第三方 criterion 与 Attachment persistence、远端 Issue 来源标记与 Concord 标记。
外部标准与真实版本同样保留：标准 OTLP、外部 SDK 版本、Incus descriptor、Docker Profile 协议，以及模型与工具的版本。
发布 revision、写入与租约代数、文件内容 revision、托管 JSONL 的唤醒序列不是格式版本，保留。

## 验收

- 用旧版本 NiceEval 写下的 `.niceeval` 运行 `show` 与 `exp --dry`：明确拒绝并提示重跑，不尝试读取或迁移。
- 新写入的 Record 只有一个格式标记；源码中不再有 family revision、迁移实现与 legacy codec。
- 改 Agent Judge prompt 的一个字：只有用 Agent Judge 的 Eval 失效。
- `show --json`、`exp --json`、`exp --dry --json` 的输出不含 `protocol`、`format`、`schemaVersion`。
- 第三方 adapter 与 plugin 的契约检查不变。
