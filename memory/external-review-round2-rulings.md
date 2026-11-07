# 设计裁决:第二轮外部契约评审的翻案清单(2026-07-14)

第一轮契约修订(见 [diff-attribution-send-window-ledger](diff-attribution-send-window-ledger.md)、[judge-missing-key-unavailable-not-silent](judge-missing-key-unavailable-not-silent.md)、[keep-dormancy-provider-forms](keep-dormancy-provider-forms.md)、[publish-redaction-copysnapshots-not-report](publish-redaction-copysnapshots-not-report.md))当日被第二轮评审再挑战,以下裁决在各自条目之外的部分记在这里:

- **coverage 省略 = complete 被推翻**:省略即完整会让旧的 / 漏实现的 Adapter 自动被当成完整采集,把新机制整个绕空。新裁决:省略 = unknown(与 unavailable 同样保守消费);Agent 级 `coverage` 声明默认值(官方适配器显式 `completeCoverage`),`Turn.coverage` 只降不升;通道补 `status` 与 `data`;正断言也走三值逻辑(非 complete 通道上找到即过、没找到 unavailable 而非 failed)。
- **AssertionResult 平铺 unavailable 字段被推翻**:`passed: false + unavailable: true + score: 0` 是任何朴素聚合都会用错的非法组合。新裁决:判别联合,`outcome: "passed" | "failed" | "unavailable"`;`group` 字符串拼 " > " 有损 → `groupPath: string[]`;`loc` 结构化为 `{ file, line, column? }`。
- **publish「显式选择」与 API 矛盾被抓实**:memory 说未消毒发布必须显式,但 `redact` 可省略。新裁决:`copySnapshots` 的 `redact: fn | false` 必填;redact 范围按排除法(全部字符串值 − 身份分类白名单),覆盖 o11y / agent-setup / snapshot 元数据 / span name;发布根补 `publish: { redacted }` 自描述标记,`view --out` 对无标记根要求 `--allow-sensitive-artifacts`;sandbox params 经 provider `publicConfig()` 投影,不靠注释承诺无 secret。
- **earlyExit 因 errored 中止被推翻**(第一轮曾裁决维持):瞬态基建错误在下个 attempt 可能自愈,停掉其余样本是放弃重试;确定性配置/作者错误另设 run 级 fail-fast,与首过即停不混用。落在 `docs/runner.md`。
- **--keep-sandbox 不留 passed 被推翻**(第一轮曾顶回):「让 eval 故意失败来拿现场」是糟糕 DX。新裁决:`--keep-sandbox=failed|all`,无值 = failed;默认仍不留(CI/并发/云资源不允许无主现场)。
- **passRate 混合口径被推翻**(第一轮曾顶回):拆成 `taskPassRate`(errored 不进分母)、`executionReliability`、`endToEndPassRate`,基建故障不再伪装成 Agent 答错。落在 `docs/feature/reports/library.md`。
- **`current()` 隐式口径标记被推翻**:Selection 物化 `mode` 与 `attempts`,消费方用 `attempts` 天然正确。
- **ExperimentRunInfo「省略函数过滤器」被推翻**:穷尽的是 resolved 投影——存 `selectedEvalIds` + `evalFilterFingerprint`,不存过滤器;`unknown` → `JsonValue`;`model`/`agent` 只留快照顶层单一权威,`config()` 桥接。
- **eval/experiments 两篇 architecture 按裁决正式化重写**:eval 的手动维护原始笔记原样迁入 [eval-architecture-original-notes](eval-architecture-original-notes.md)(「显式标记不应永久阻止架构文档成熟」)。

## 第三轮(同日)修正第二轮引入的语义错误

- **diff 压缩翻案**:第二轮把逐窗口证据压成单文件 before/after——「agent 改 A → eval 改 A → agent 再改 A」会夹带 eval 修改,「创建又删除」「改回原样」无法表达。改为落盘逐窗口 delta 序列(`DiffWindow[]`),文件级摘要(`net` 含 `"none"` 态)与 `diff.get` 是 reader 派生;`fileChanged` = 任一窗口触及。
- **redact 排除法翻案**:「全部字符串值 − 白名单」的白名单必然不完整,会改写 `format`/verdict/`artifactBase`/路径等结构字段,让发布根不可读。改为 schema 逐字段标注自由文本,只对标注字段跑 redactor;「新字段漏网」由漂移守护拦。`publish.redacted: boolean` 改 `redaction: "applied" | "none"`(只声明流程不证明结果),`"none"` 的根导出仍要 `--allow-sensitive-artifacts`。
- **schemaVersion 8**:AssertionResult 判别联合 + diff 重构是破坏性格式变化,忘了升版会让 v7 被新 reader 错误解释(升版打包清单见 [results-schema-version-history](results-schema-version-history.md))。
- 其余补口:注册表向上发现 + `--run` + 条目 lease(enter 与 stop 并发互斥);`--keep-sandbox=all` 补进 architecture 提交条件;send 静止态措辞(HITL waiting 不与「子进程全部退出」冲突);`defineEval({ diff })` 进公开形状(glob 语法 + 合成优先级);experiment flags 边界拒绝非 JSON;runner 超时从 Promise.race 改为 Effect interruption 口径;unstarted 涵盖 fail-fast。教训:破坏格式必查 schemaVersion;逐事件证据不做不可逆压缩;「按排除消毒」在含结构字段的格式上永远错。
