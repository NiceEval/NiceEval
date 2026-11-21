# INIT does not make agents confirm the evaluation target after another blocking question

## 观察

NiceEval-Eval 的 `install/concord`（2026-11-21，候选 0.21.0，被测 gpt-6.1-sol 与 gpt-6.2-sol 各 2 次）：被测 agent 首轮遇到一个阻塞问题（宿主仓库规定 Bun-only，而 NiceEval 需要 Node），只就这一点向用户提问；用户答复后，agent 直接自定评估对象（Concord CLI 的模板或 trace 命令）并开始实现，没有再与用户确认评估面、数据、判据与运行约束。用户真正想比较的是“获随包指引的 Codex 与未获指引的 Codex”，只要问到就能得到。四次采样全部如此。Attempt：`@1WYR59SS4E7ET`、`@160JB5AEYNQB6`、`@17PJ7SCY7E8MK`、`@1E3WZDGFSB6PM`（NiceEval-Eval 的 Record）。

## 期望

INIT 把“与用户确认评估对象”写成独立于其它阻塞问题的步骤：即使先解决了运行时或权限等问题，开始写 Adapter、Experiment、Eval 之前仍要确认评估面；宿主没有明显 AI 入口时更要先问。

## 影响

在先遇到环境问题的宿主上，agent 会做出用户不需要的评估，用户要么返工，要么拿到无关结果。

## 来源

NiceEval-Eval dogfooding，公开 `show @<locator>` 的 Turn 记录与判据。
