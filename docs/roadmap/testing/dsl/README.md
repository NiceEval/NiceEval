# 验收 DSL 已退出目标方案

旧稿计划用 `cli()`、`reportView()`、`Observed<T>` 和领域 matcher 统一测试作者面。
该方案已经移到 [Design · PLAN-2](../../../design/user-readable-testing/PLAN-2/README.md) 作为被比较但未采用的候选。

目标 Roadmap 使用原生 Vitest / Playwright：结构化输出严格 parse，浏览器使用 role / label / web-first assertion，
共享层只保留进程、server、parser、浏览器、artifact 与 cleanup 等机械 helper。规则见
[Architecture · Helper 预算](../architecture.md#helper-预算)和 [Example](../example/README.md)。

保留本入口是为了让旧链接明确落到决策结果；这里不再定义可实现的 DSL。
