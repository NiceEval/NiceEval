---
name: claude-code-e2e-session-resume-maxtokens-budget-too-tight
description: e2e/repos/claude-code 的 session-resume eval 用 t.maxTokens(80_000) 当"usage 非空"哨兵断言，真机第二次跑就在 90008 tokens 上假阳性判 regression；claude-code CLI 单轮 usage(含 cache read)本身在 24k~90k 区间正常浮动，80k 不是够用的上限
metadata:
  type: project
---

**现象**：`pnpm e2e --repo claude-code` 第一次真跑（`.niceeval/coding` 此前从未落过盘，是这条 experiment 第一次经过完整 Docker 沙箱 + 真实 DeepSeek 代理跑通)全绿；同一份代码原样第二次跑（中间只改了另一个不相关的 eval），`session-resume`（`experiments/coding.ts`）在
`t.maxTokens(80_000)` 上直接判 regression：

```
niceeval: failed locator=@1xogm53e eval=session-resume experiment=coding severity=gate
  assertion=maxTokens(80000) expected="≤ 80000 tokens" received="90008 tokens"
```

本地单独复现 `pnpm exec niceeval exp coding --force` 时又通过了（这次两轮都 < 80k）。

**根因**：`evals/session-resume.eval.ts` 的注释原写"实测简单问答也有 ~24k tokens(含 cache read)，80k 放足余量"——这个 24k 只是某一次的采样值，不是上限。claude-code CLI 每轮请求都带巨大的系统提示词与工具定义，`--resume` 续接轮还要重新读入前一轮会话上下文，cache read 量本身跨请求就会明显跳动；真实分布上探到 90008 tokens 完全正常，不是 usage 通道坏了或哪里在重复计费。80k 的阈值本意只是"usage 没被判 unavailable"的哨兵检查（真正的硬防线是 usage 通道不完整时整个 attempt 会 errored），却被写成了一个几乎贴着真实使用量上限的数字，导致真机波动直接把它当断言 gate 判 regression。

**修法**：把 `evals/session-resume.eval.ts` 里两处 `first.maxTokens(80_000)` / `recall.maxTokens(80_000)` 提到 `200_000`，并把注释改成如实描述"单轮 usage 在 24k~90k 区间浮动，resume 轮尤其会因为重读上下文而跳动，上限只用来兜底 usage 通道整个坏掉，不是卡真实 token 成本"——不再写一个贴着真实采样值的数字当上限。这个修法是靠构造成立的，不是靠"又跑绿了"证明的：唯一一次实测超过 80k 的样本是 90008，200_000 对它留了约 2 倍余量；修完后 `pnpm e2e --repo claude-code` 又真跑过一次同样是 `exit=0 category=pass`，但那一轮本身没有再撞上 >80k 的样本，绿色只说明没有引入新问题,不能当成"200k 挡住过真实超限值"的实证。

这类"usage/成本类哨兵断言"通用的排查方法：如果一个 `maxTokens`/成本上限断言是为了确认"usage 通道有数据"而不是真的要卡预算，就该把上限设得远高于任何一次真实采样值（留 2~3 倍余量），而不是刚好卡在自己第一次实测的数字上——协议本身的 token 用量在不同请求间有真实方差，样本量为 1 时不能当作上限。
