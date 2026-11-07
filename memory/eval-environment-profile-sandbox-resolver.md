# Eval 声明环境 profile，Experiment 解析具体 SandboxSpec

**裁决（2026-07-16，terminal SWE-bench DX 回灌）**：`EvalDef.environment` 是非空、provider-neutral 的环境 profile id；`ExperimentDef.sandbox` 除固定 `SandboxSpec` 外支持 resolver，根据 `{ eval: { id, environment } }` 为每条选中 eval 返回具体 spec。resolver 调度前每 eval 求值一次，resolved spec 同源进入创建、fingerprint、provider 推荐并发与结果审计；remote Agent 不调用。

**动机**：Astropy 2021 pin 需要 Python 3.9；E2B 模板没有 3.9，系统 Python 3.11 又编不动旧 Cython，只能用 uv 安装。把 Python 版本写进 eval setup 能跑，却无法选择已预制的 per-eval template；把 template 写进 eval 又会绑定 E2B、破坏同一 eval 跨 Docker/Vercel/remote 复用。现有「稳定大依赖进 template、具体 template 归 experiment」两条规则之间缺了一个对接身份。

**否决方案**：`EvalDef.sandbox/template` 直接覆盖——eval 绑定 provider，experiment 不再完整描述运行配置，并让并发默认、carry 指纹与快照投影失真；`environment` 直接当包约束求解器——NiceEval 不应发明跨 image/template/snapshot 的依赖解析语言。profile 是不透明 id，映射决策留给拥有 provider 知识的 experiment。

**结果纪律**：resolver 函数体 fingerprint 是快照级配置身份，防止局部重跑从旧 resolver 快照补齐；本次选中 eval 的 resolved spec 另落 `sandboxByEval` 审计。未选中的 eval 不求值，resolver 配置错误在任何 sandbox/Agent 预算发生前失败。

**后续（2026-07-17）**：resolver 解析形态被推翻——`EvalDef.environment` 与「profile 是不透明 id、映射归拥有 provider 知识的一侧」的判据保留，映射载体改为 sandbox spec 工厂的 `environments` 数据表，见 [eval-environments-map-replaces-resolver](eval-environments-map-replaces-resolver.md)。
