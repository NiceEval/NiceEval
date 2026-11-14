# Attempt diff 标记正文可用却没有公开出口读取改动内容

公开 Attempt @1RSAXZ5EHJH2V（NiceEval-Eval，experiment harness/canary，eval terminal-bench/log-summary-repair）的保护路径 gate 失败，Received 为 `evals/terminal-bench/log-summary.test.py`。`niceeval show @1RSAXZ5EHJH2V --diff` 与 `query run` 的 `attempt.diff` 都只给出每个 change 的 before/after 字节数、sha256 与 `content: available`，没有逐行差异或正文；`attempt.artifacts` 为 not-recorded；`attempt.diff` 不接受 `changeId` 之类的选择参数，`show --diff --expand <changeId>` 同样不支持。

影响：判断 agent 是否放宽了官方判据（这一格的核心问题）必须看改动内容，但公开 CLI 无法回答；使用者只能转去读私有 Record 或源码，违背只经公开出口诊断的约定。

期望：既然正文已捕获且标为 available，`show @<locator> --diff` 能按 change 展示有界的统一 diff（或提供按 changeId 读取 before/after 正文的固定 operation），并保留 binary、oversized、capture failure 边界。

环境：Linux / Node 24 / Instabox；宿主为本地 link 的 NiceEval main（a23a7bf08 前后），Record Run 060eae75-704f-423b-bd55-e1545e17f258 所在 Invocation。证据只来自公开 `show` 与 `query run`。未含凭据。
