# 注入凭据的转写脱敏

已知值精确替换归属 **Record 写盘边界**，不是 o11y normalize 的语义职责。

NiceEval 的凭据只从 env 变量来，变量名由 adapter 或 sandbox 工厂声明（[配置从代码来，凭据从进程变量来](../../architecture.md)）。
Sandbox 命令已经有已知敏感值的精确脱敏：调用方在自己发起的命令里登记会出现的值，Runner 把命令摘要、timing、execution 与错误证据里的同一个值替换成 `<redacted>`（[已知敏感值与落盘边界](../../feature/sandbox/library/operations.md)）。

这条边界只涵盖 Runner 自己发起的 Sandbox 命令。
Agent 主进程按官方变量名收到凭据后，它启动的 shell 工具子进程继承同一份进程 env——[Codex CLI 的 Agent 进程 env](../../feature/adapters/sdk/codex-cli/README.md)已经声明命令子进程从该进程继承。
Agent 自己驱动、经 Transcript 归一化进入标准事件流的工具调用内容同样受 Attempt 已知敏感值集合保护。
过滤发生在这些内容进入 Record artifact 之前，不要求 o11y 理解凭据语义。

## 问题

Agent 用来侦察运行条件的常规命令会把继承到的凭据原样写进自己的 stdout，例如列出并按关键字过滤当前进程 env 的命令。
o11y 把这份工具输出逐字归一化进标准事件流；若在写盘前不做替换，凭据随 `events.json` 等 artifact 落盘，并随报告站与提交一并传播。

命中不是靠变量名比对触发，而是概率性的字符串匹配：命中过的不是变量名本身，而是随机凭据值内部恰好包含的一段子串。
命中范围因此无法靠约束 agent 的使用方式来避免——只要 agent 进程持有真实凭据，它就总能在自己的进程 env 里读到该值。
这是全部沙箱型 agent 共有的暴露面，不是某一道具体任务的特例。

## 核心心智

已知值脱敏与既有的命令级脱敏遵循同一条原则：Runner 精确知道自己写下的凭据值是什么，落盘前做精确字符串替换，不需要猜测哪一段文本像凭据。
全部落盘转写面共用这条原则：进入 artifact 之前的落盘输出都经过同一个已知值过滤器。

**NiceEval 不负责发现秘密，只负责保护自己已注入的秘密。**  
不新增 credential provider / secret manager / 第二套配置体系。

## 已知值脱敏

### 谁持有什么

| 角色 | 职责 |
|---|---|
| Runner | 为本 Attempt 注入 env；持有 **attempt 内 credential map**（变量名 → 实际值） |
| o11y | Transcript 归一化 → 标准事件流；**不**持有 secret 语义，不负责「哪些值是凭据」 |
| Record 写盘 / serializer | 在字符串进入 `events.json`、`trace.json`、日志类 artifact 之前，对 map 中的值做精确替换 |

固定数据流：

```text
Transcript
    → o11y normalize（格式统一，无 secret 语义）
    → Record serializer / write boundary
    → redactKnownSecrets(credentialMap)
    → events.json / trace.json / 日志 artifact
```

`redactKnownSecrets` 不进入 o11y 内核。o11y 只归一化协议，Record writer 才持有 Attempt 的凭据值集合并执行过滤。

### 算法

1. **精确字符串替换**：只匹配完整已知值，无启发式、无「像 key 的字段名」猜测。
2. **最长匹配优先**：避免短 token 嵌在长 token 时替换次序错误。
3. **仅处理字符串面**：不猜结构、不递归改写未知二进制。
4. **占位形状**：统一替换成 `<redacted>`，不把变量名或其它凭据出处元数据写进 artifact。
5. **credential map 生命周期**：与 Attempt 注入同步建立、随 Attempt 结束丢弃；不写入 fingerprint、不进缓存身份、不进 configHash 输入。

### 涵盖面

脱敏范围涵盖全部落盘转写面：`events.json`、`trace.json`，以及日志类 artifact。
它与既有 `CommandOptions.sensitiveValues` 命令级脱敏共用 `<redacted>` 占位和最长匹配算法。
命令级登记 Runner 发起的命令内容，Attempt 凭据集合涵盖 Agent 转写路径。

## 排除边界

- 不引入本地凭据代理；Agent 仍通过既有进程 env 取得凭据。
- 不用发布或导出阶段的启发式扫描代替已知值过滤。模式扫描无法证明没有漏网值，也不改写 artifact。

## 范围

**包含**

- 全部落盘转写面在写盘前，对 Runner 已知的注入凭据值做精确字符串替换；
- Record 写盘边界上的确定性过滤器与 attempt credential map 契约；
- 与既有 sandbox 命令级 `sensitiveValues` 的并存关系。

**不包含**

- 代理注入的完整设计；
- 启发式扫描的具体规则；
- 新的凭据配置体系或从文本「发现」秘密；
- 把脱敏结果或 credential map 写入指纹 / 缓存身份。

## 相关契约

- [Architecture · 凭据从进程变量来](../../architecture.md)定义凭据出处。
- [Sandbox · 已知敏感值与落盘边界](../../feature/sandbox/library/operations.md)定义命令级登记与占位形状。
- Record writer 负责落盘前过滤，o11y 保持协议归一化中立；源码落点由 [Source Map](../../source-map.md)定位。

## 相关阅读

- [Architecture](../../architecture.md)
- [Sandbox operations · sensitiveValues](../../feature/sandbox/library/operations.md)
- [Codex CLI · Agent 进程 env](../../feature/adapters/sdk/codex-cli/README.md)
