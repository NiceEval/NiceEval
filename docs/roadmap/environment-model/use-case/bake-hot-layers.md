# 把热路径烘进产物

## 解决什么问题

逐层计时显示 mempal 的 warmup 每次要 90 秒、[记忆对照实验](memory-condition-layer.md)天天跑,这就是构建预装 mempal 的新 image / template / snapshot 的信号。

## 全流程

```typescript
// 构建一次:官方 codex 基线 + mempal,用 provider 原生工具(e2b template build)
// experiments/compare/codex--mempal.ts 只改一行:
sandbox: e2bSandbox({ template: "acme/codex-mempal-0.9.0" }),
```

`layers: [mempal]` 保持不动,它在新产物上的职责变成**漂移防护**:template 里烘的版本落后于声明时 check 不命中,现场补齐到 `0.9.0`,不会静默用旧版。

## 代价要说清

**换 image / template / snapshot 就是换环境身份**,旧结果不携带,冷安装那版与命中这版也不算同一环境的两次运行——Layer 检查覆盖不了系统包与运行时配置,niceeval 不做「复检通过即语义等价」的投机(裁决理由见 [README](../README.md#产物与身份不被迫造产物但产物不是免费换的))。
所以切换产物放在**实验代际之间**:先纯运行时把实验跑对、拿计时,烘完切换、接受一次全量重跑,新代际内享受命中。
层原语的承诺是「你永远不**被迫**造产物」,不是「换产物免费」。
