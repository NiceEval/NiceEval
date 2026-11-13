---
relations:
  - role: root-cause
    target: memory/cli-diagnostic-projections-lose-saved-evidence.md
---

# Dry preview collapses structured differences into identical placeholders

## Observation
Installed candidate 45e7381bc on Linux / Node / pnpm: `niceeval exp <experiment> --dry` prints `structured value (summary incomplete) → structured value (summary incomplete)` for changed structured configuration. The two sides are indistinguishable. Bundled Chinese docs do not explain locked or source-member-missing.

## Reproduction
Run a deterministic Experiment whose flags include a string longer than 512 characters. Change one flag and run `niceeval exp <experiment> --dry`.

## Expected
Distinguish available summaries using short display digests, or explain once why the saved summaries cannot distinguish the values. Document all dry status words and gap codes, user action and next commands. Do not change execution identity or persisted manifests.

## Provenance
Sanitized local dogfood report through public CLI. No secrets or private material. Suggested labels: bug, area:cli, needs-triage. Open and closed Issues searched; #300 concerns accepted current identity rather than this presentation defect.

## Agent 版本比较的现存边界

2026-11-12 的上游默认版本升级加入了仅用于呈现的 Agent 安装差异行：当两侧 `config:agentInstalls` 摘要都是完整 JSON 时，明确显示 Agent 名、旧版本、新版本与配方修订，不改变身份摘要或落盘内容。公开 CLI 的确定性回归已验证 Codex 0.144.1 到 0.167.2 是普通 identity-mismatch gap，且不出现身份域未登记诊断。

同日对 NiceEval-Eval 执行 `niceeval exp harness/v0.20.0 --dry`，六题均返回 identity-mismatch，但诊断为 identity-manifest-missing。历史一侧没有完整 manifest，无法仅靠呈现层恢复旧 Agent 版本；对超长且已截断的数组摘要也继续如实说明比较局限。下游历史记录没有被改写，没有付费重跑。本地 draft 保留这部分未满足的可读性边界，不把摘要相同解释成身份相同。
