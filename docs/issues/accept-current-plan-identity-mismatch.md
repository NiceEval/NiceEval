# accept 成功后当前 dry plan 仍显示 identity-mismatch

## Observation

在 NiceEval-Eval 中，`accept` 成功创建当前采用记录后，未修改源码，紧接着 `exp --dry --json` 仍把对应 slot 标为 `gap` / `identity-mismatch`。旧 Attempt 没有丢失，readbacks 能定位新采用 Run，但计划不复用。

## 公开复现与证据

当前下游使用官方 dev:link 安装的本地候选，NiceEval core commit e8ec305c5（该提交的生产代码已先构建再执行）。在已有 OpenSandbox 历史结果的 NiceEval-Eval 项目运行：

```sh
pnpm --silent exec niceeval accept @180R1R435VW9N
pnpm --silent exec niceeval exp --experiment harness/v0.19.0 --experiment install/v0.19.0 --dry --json
```

实际采用操作含六条 passed locator，全部成功。该 stable Attempt 被采用到 Run `248bbeb4-65e4-447e-97b9-3eec5b596127`，CLI 显示 Current fingerprint `e0252a7da49c72070019c7d3b3921cc2371ea6384963fa7c544f8b2597fb9115`。随后的计划显示 executionIdentityDigest `5750b551fd3a80431159295645f635ba6b2fee9a4ea20478d0d5f95152fd43f4`、reused=0；readbacks.source.sourceBarrier.runId 正是新采用 Run，comparisons.core.result=mismatch、reason=identity-mismatch。

相同实现的正式 tarball 在独立无模型 runtime fixture 上接受旧结果后，`exp --dry` 正确显示 reused=1；因此目前不能推断所有 accept 都失效。尚未收敛到无历史数据的最小复现，不声称根因已经确定。

## Expected / impact

同一当前配置在显式采用成功且没有修改后应沿用；若存在阻止沿用的另一项输入，公开计划应解释它。否则按文档使用 accept 后直接运行整批可能重复付费。本次通过现有 tag 与用例 selector 精确选择缺少项，保留旧结果，未重跑已完成项。

## Environment / provenance

2026-10-26，Linux x64，Node 24.19.0，pnpm 11.12.0；宿主本地 NiceEval 候选，inner stable 0.19.0 / canary.104。来源为 NiceEval-Eval 的 OpenSandbox 迁移验收；证据来自公开 accept 和 dry 输出，未读私有 Record。下游验收文档为 `docs/validation-2026-10-26.md`。

已按 accept / reuse identity 搜索 open 与 closed GitHub Issues，没有发现相同观察。建议标签：bug、runner、needs-triage。正文已脱敏，不包含凭据。仅记录本地草稿，不授权发布远端。

## 补充：12 格完成后的再次验证

2026-10-26 12:57 UTC，12 个历史 locator 全部由 attempt.get 确认为 score.state=complete。当前 dry plan total=12、reused=4；对其余 8 个 locator 显式 accept 全部成功（包含 failed 但完整评分的稳定版 GPT Researcher），紧接着同一 exp --dry --json 仍为 total=12、reused=4，其余 8 格依旧 identity-mismatch。中间没有修改源码。

采用 Run 为 2b5b3132-ed67-42a9-9e8a-2844c42ea751（Canary Harness 四格）、ea730f27-8c91-43e6-a648-55e9a9b97007（stable authorized）、fa9b8a93-3f8b-478e-a32f-1ab125e7ffde（Canary DB-GPT）、d2d822b5-0c13-4b67-89b8-29ab76874c54（stable 安装两格）。结果 locator 保持不变。此轮没有为身份问题重跑任何已评分结果；用户必须通过固定 locator 查看完整矩阵，不能把 dry 的 gap 当成没有历史结果。
