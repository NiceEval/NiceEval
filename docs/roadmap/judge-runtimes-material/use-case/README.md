# Judge Material 用例

契约单源在 [Library](../library.md) 与 [Architecture](../architecture.md)。本目录只展示作者怎样为具体目标选择最小材料。

- [用最小材料评估回复](grade-reply-with-minimum-material.md) —— 区分 reply-only、task + reply 与显式 definition reference。
- [检查动作但不授权结果](inspect-actions-without-results.md) —— 只判断 Agent 做了什么，不把命令输出交给 Judge。
- [授权选中的动作结果](grant-selected-action-results.md) —— 只把精确命中的公开结果交给 Judge，并对不完整证据 fail-safe。
- [绑定自定义与参考材料](bind-custom-material.md) —— 在 Execution 或 Grading definition 的正确阶段封口 text/file。
- [拆分或显式合批维度](split-or-batch-dimensions.md) —— 可见性不同就拆调用，完全相同且 recipe 声明安全时才 batch。
