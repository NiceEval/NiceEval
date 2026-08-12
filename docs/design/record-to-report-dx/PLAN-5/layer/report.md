# Report 子设计

**上游**：[Relations](relations.md) 或 [Derivation](derivation.md) ·
**整体作者面候选**：[PLAN-1](../../PLAN-1/README.md) · [PLAN-2](../../PLAN-2/README.md) ·
[PLAN-3](../../PLAN-3/README.md)

Report 把已闭合的 typed results 交付为 Page、PageFamily、Download、terminal、web 或 static
output。它回答“哪个 consumer 展示什么”，不回答“去 Record 的哪条 path 找数据”。

## 拥有的契约

Report definition 拥有 consumer identity、route keys、Page/PageFamily/Download composition 与 closed
output schema。Host 在任何 I/O 前从 definition 闭合需要的 declarations，再绑定一次 immutable
execution。Terminal、web 和 static 交付同一 execution，不各自重新查询或计算。

Page 消费 typed relation 或 derivation values。Download 消费同一份 machine-readable value，不从渲染
文本反推 JSON/CSV。Dynamic PageFamily 只能按 durable key 展开，不用 array index 充当 identity。

## 作者 DX

普通 Report 作者使用 facade 声明需要的字段、relations 或 derivations，不手工搬运每个
package result。高级作者可以组合 public projections 和 relation builders，但同样不获得 arbitrary
path、owner lookup 或 private legacy evidence。

PLAN-1～3 可以继续比较 query DAG、scoped loader 或 semantic query language。无论选哪种语法，
都必须消费 PLAN-5 的 Sample-aligned public results，不能绕过 Projection/Relations 再建一条官方
私有读取路径。

## 不拥有的责任

- 不打开 Record、执行 migration 或 materialize blob closure。
- 不从 package path、legacy files 或私有 built-in context 回填字段。
- 不重建 population、跨包 join 或 metric 公式。
- 不返回任意 HTML、React DOM 或浏览器 fetch；output 必须是 package-defined semantic tree。

## 失败与交付

没有 managed Derivation 时，普通函数失败的最小边界是整个 Report execution。采用 managed
Derivation 后，host 可以只阻断依赖失败节点的 consumers。Renderer 失败不改写 data result，一个
delivery adapter 的失败也不触发另一个 adapter 重新查询。

## 验收条件

- Built-in Attempt page 与第三方 Page 使用同一 public declaration 取得 Assertions、Verdict、
  Score、source 与 Observability relations。
- Overview 与 Download 可共享同一 immutable typed value。
- 未请求 package 的 invalid 状态不影响报告；已请求的状态可诊断且不冒充零值。
- Official Report 不获得任何第三方 Report 无法调用的 reader 或 host API。
