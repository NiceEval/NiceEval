---
format: niceeval.docs-node/v1
kind: design-plan
relations: {}
---

# 声明材料工厂并绑定 reader

材料工厂 token 声明材料类型，Adapter assertions factory 把 token 绑定到应用 reader。
业务通过 token 和单项 predicate 生成 selector，check 与 closeQA 消费 selector。

公开形状见 [Library](library.md)，所有权见 [Architecture](architecture.md)，时序见 [Lifecycle](lifecycle.md)。
本候选保留重复接线用于比较，不满足用户要求的最小作者 API。
