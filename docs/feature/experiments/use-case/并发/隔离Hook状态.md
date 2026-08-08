# 并发下隔离每个 Sandbox 的状态

同一模块的生命周期代码会同时服务多个 Sandbox，不能用一个普通模块变量保存逐 Attempt 的状态值，否则并发 Attempt 会互相替换。
以 Sandbox 实例为键使用 `WeakMap` 保存每份状态，并经 `context.onCleanup()` 删除。

如果这些 Attempt 本来就必须按顺序读写同一份业务状态，不要用 `WeakMap` 掩盖语义，直接采用 [串行共享状态](串行保护共享状态.md)。
