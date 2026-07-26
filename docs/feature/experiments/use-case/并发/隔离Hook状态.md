# 并发下隔离 Hook 状态

同一模块会同时服务多个 Sandbox，不能用一个普通模块变量保存 setup 产物，否则并发 Attempt
会互相覆盖。以 Sandbox 实例为键使用 `WeakMap` 保存每份状态，并在 teardown 后删除。

如果这些 Attempt 本来就必须按顺序读写同一份业务状态，不要用 `WeakMap` 掩盖语义，直接采用
[串行共享状态](串行保护共享状态.md)。
