# 修改 Sandbox 环境

换 template-bearing factory，或改它任何一个参数（image、template、snapshotId、Compose file），都会改变起点身份。
起点声明在 Eval 上时只作废这一条，声明在 Experiment 上时作废它选中的全部 Eval；受影响的 Attempt 按指纹不匹配重新执行。
`command()` / `shell()` / `defineSandboxCommand()` 声明的 prepare 命令改动同样进指纹，按相同范围作废。

直接传入的 callback 不增加可追踪 identity，其它指纹输入相同时结果仍会携带。要让 callback 实现或动态输入变化自动作废结果，使用 `defineSandboxCommand()` 并同步维护 `revision` / `inputs`。

只重建同名镜像或改变镜像内部内容时，起点身份不变，指纹观察不到变化。
环境行为实际已经改变但身份未变时，用 [`--rerun all`](../重新运行/全量重验.md) 全量复验；长期需要区分的环境版本应带进产物名或 factory 参数。
