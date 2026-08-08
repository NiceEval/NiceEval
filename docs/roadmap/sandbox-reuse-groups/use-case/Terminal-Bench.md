# Terminal-Bench：没有组就是每题 fresh

契约单源始终在 [Library](../library.md) 与 [Architecture](../architecture.md)。
本例说明共享构建输出为什么不等于共享运行中的 Sandbox。

Terminal-Bench 的每个 Eval 自带 Dockerfile 或 Compose Sandbox。
题目相互独立，agent 的进程、用户目录、包缓存与服务状态都不应流入下一题。

仓库不添加任何 `sandbox-group.ts`。
这些 Eval 的 definition 是 template-owning；即使作者误把其中一道导入 `defineSandboxGroup()`，TypeScript 也会在组文件拒绝，而不是等到批次创建资源时才发现。
每条 Attempt 使用全新 Sandbox，并受 Invocation 的全局并发限制；不同 Eval 的 template 与 Provider 继续由各自 Sandbox Layer 声明。

同一 BuildKey 的 Docker build 可以由 Run 级构建协调 single-flight，并让多个 Case 使用同一构建输出。
这种共享发生在不可变构建层，不保留某道题运行后的容器、卷或服务状态，因此不需要复用组。
