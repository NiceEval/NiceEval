# 计分软分项的零分不应以 PASS 作为主要标记

## 当前观察

计分评估的软分项在 0 分时仍显示 PASS，例如：

```text
[PASS] install.first-turn.protocol · 核对接入协议 (0/2)
Passed 35, Failed 2, Total 37 (score: 34/72)
```

Judge 给 0 分的软分项与满分项显示同样的 PASS，读者容易把“35 passed”理解为 35 项达标。

## 期望工作流与影响

作者希望按得分理解计分条目的完成质量，以得分作为这类条目的主要标记；PASS/FAIL 用于影响判定的 gate。具体版式尚未定稿，需要 maintainer 收敛契约。当前输出影响 rubric 校准和人工解读，并不要求修改已经保存的 score 或判定事实。

公开复现入口是 `niceeval show <包含 0 分软分项的 locator> --assertions`。例子来自 NiceEval-Eval 安装评估的真实公开 CLI 输出，由父 agent 核实，不需要重跑 agent。

## 来源与身份

来源：NiceEval-Eval dogfood，本轮第三批作者 API 工作；NiceEval main Feature 基线 `8b7e32505`，包开发版本 `0.0.0-development`，Linux、Node 24、pnpm 11。内容已脱敏，不含 credential、私有文件内容或漏洞细节。

搜重：2026-11-12 完整枚举 GitHub open 与 closed Issues（51 条）及本地 drafts。#218 讨论纯 score 实验的总体 Verdict / Pass rate，本项是逐 Assertion 的软计分标记，相关但不同，保留关联供分诊。

建议标签：enhancement、area:cli、area:report、needs-triage。
