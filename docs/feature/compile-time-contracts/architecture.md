# 编译期契约架构

静态契约只在作者输入边界阻止可由 TypeScript 判定的错误。factory 负责构造 Definition；discovery 负责派生身份；linker 负责跨文件、跨 selector 的实际配对。任何动态导入、JavaScript 调用或外部数据仍须在对应运行时边界验证。

| 不变量 | 类型边界 | 运行时边界 |
|---|---|---|
| 派生字段不由作者填写 | 阶段类型与模块私有诊断类型 | `defineEval` / `defineExperiment` 守卫 |
| MCP transport 互斥 | 负字段 union | `assertMcpServers` |
| HITL answer 二选一 | XOR union | adapter 输入校验 |
| Agent evidence coverage 穷尽 | 必填对象与降级判别 union | Agent factory 守卫 |
| Sandbox callback 输出边界 | 固定返回形状与 `retention?: never` | `defineSandboxCase` 输入与 `materialize` 结果校验 |
| Sandbox template 恰好一份 | layer factory 的私有品牌 | discovery 后的全矩阵 linker |

固定 Inspection catalog 由 NiceEval 自己拥有。其 operation kind、selector、comparison mode、result、issue 与 Evidence 形状既不通过 `define*` 暴露，也不接受用户注入的 renderer、Page、theme、SQL、JSON path、formula 或通用 aggregation。

运行时守卫必须在写文件、启动进程或交付结果前失败，并指出真实输入、冲突字段与下一步。类型检查不能替代数据库、JSON、文件、网络或跨行数值关系的验证。
