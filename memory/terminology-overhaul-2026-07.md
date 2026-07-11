# 设计裁决:2026-07-11 术语大改名(Verdict / Provider / 首过即停等)

**裁决**(2026-07-11,用户逐项拍板):

| 旧词(中 \| 英) | 定名(中 \| 英) | 代码面 |
| --- | --- | --- |
| 判决 \| Outcome | **判定 \| Verdict** | `ResultOutcome` → `Verdict`,`outcome` 字段 → `verdict`(含 artifact JSON、summary.json);`src/scoring/verdict.ts` / `src/shared/verdict.ts` / `src/view/app/lib/verdict.ts` |
| 评判模型 \| Judge | **Judge(中文直用)**,解释词「裁判模型」 | 无 |
| 后端 \| Backend | **Provider** | `SandboxBackend` → `SandboxProvider`,spec 判别字段 `backend` → `provider`,`sandbox.backendNotImplemented` → `providerNotImplemented`;公开页 `zh/guides/sandbox-backends.mdx` → `sandbox-providers.mdx`(docs.json 加 redirect) |
| 沙箱作者 API \| Sandbox author API | **`t.sandbox`**(代码标识当词条) | 无 |
| 接入 Tier \| Integration tier | **接入等级**(档位照写 Tier 1/2/3) | 无 |
| 模型档 \| Model tier | **删掉专名**,就叫「模型(`model` 字段)」 | 无 |
| 尝试 \| Attempt | **Attempt(中文直用)** | 无 |
| 轮 \| Turn | **Turn(中文直用)**;「多轮对话」等形容词性用法不受限 | 无 |
| 早停 \| EarlyExit | **首过即停**(只改中文) | `earlyExit` / `--early-exit` 保持不动(用户明确选了破坏面最小项) |

**曾选方案与否决理由**:

- Outcome:pytest 同名先例,但语义空泛,用户否决。第一轮裁决选了 **Conclusion**(GitHub Actions `conclusion` 先例),已经落了半仓;同日用户要求再研究,查 `/Users/ctrdh/Code/eve` 发现 eve 用 `EveEvalVerdict`/`verdict`(niceeval 的评分模型本就对齐 eve,`scoring/verdict.ts` 文件名即来源于此),加上 TTCN-3 测试标准的 verdict(pass/fail/error/inconc)先例、代码里已有 "Current verdicts" 表头/`traces-verdict` CSS 类的自发漂移,同日翻案为 **Verdict**。Verdict 曾因「LLM-as-judge 文献里 judge 输出也叫 verdict」被我压过一轮——实际本库 judge 只产分数,不撞。
- 判决→中文:判决(法庭味)否决;判定 vs 结论,随英文翻案从「结论」改「判定」。
- Backend:Runtime(与 agent runtime 重叠)、Implementation(字段名太长)否决;「后端」死穴是用户拿 niceeval 评的对象经常就是自己的 web 后端,必然撞车。
- EarlyExit 英文:曾提 `stopOnPass`,用户选「只改中文」,代码名不动。

**波及与纪律**:「后端」「轮」「结论」都是多义词,替换必须逐语境甄别——应用后端/协议后端/观测后端(`src/agents/*` 注释、connect-otel、tier1 示例文案)不改;「多轮/单轮」形容词不改;「实测结论」等日常语不改。字段改名 = artifact schema 破坏(旧 `.niceeval` 目录里 `outcome` 字段的落盘不再可读),beta 原则下不做读取别名(同 [experiment-flags-naming-reversal](experiment-flags-naming-reversal.md) 的先例)。

**遗留未裁决**(下次迭代候选):快照 Snapshot(与 snapshot testing 撞)、选集 Selection(中文歧义)、值级断言(「值级」不自然)、双面组件 dual-face(英文非标准)、严重级 Severity(小问题)。
