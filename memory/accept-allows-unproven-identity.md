# 显式采用未验证身份等价，后续 dry 仍拒绝沿用

## 观察与根因

公开 query run.get 证明采用 Run 的目标 executionIdentityDigest 与当前 dry 一致，但 exact origin 的 identity 不同。显式采用只验证质量和时长，允许操作者接受任意身份差异；后续 reuse 则重新要求普通身份全等或有证据的纯改名，因此成功采用不能兑现继续沿用。

这与历史 Plugin link 前重算身份的问题不同：本次目标 digest 已一致，缺的是采用前的等价资格检查。

## 契约与修复边界

以 Experiments cache 的有限采用规则为准：同 identity 可以显式选择；跨 identity 必须有可重验的第一方证明。任务、模型、flags 或判据变化不能靠确认放行。缺少证明时整批拒绝且不写 Run，dry 不给出必然失败的采用建议。既有 accepted Record 保持可读，但不成为绕过当前规则的许可。

## 验证

加强现有 accept Journey：改动任务后不建议接受且接受命令拒绝；恢复完全相同输入后显式采用仍引用旧 Attempt，后续 dry 沿用同一 locator。真实下游的公开 query 与 dry 只用于确认原观察，不读取私有 Record 文件或启动付费实验。
