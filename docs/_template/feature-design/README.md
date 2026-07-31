# <功能或候选名> —— Feature Design Package

这是 Feature、Roadmap 与 Design 候选共用的起始模板。
复制到下面任一位置后,按所属目录的成熟度规则写作:

- `docs/feature/<name>/`:已定稿的目标契约。
- `docs/roadmap/<name>/`:尚未定稿的候选契约。
- `docs/design/<decision>/PLAN-N/`:参与同一决策比较的自包含候选。

只有 `README.md` 必备。
`architecture.md`、`cli.md`、`library.md` 与 `use-case/` 按功能形态选用,不为凑结构留空文档。
写完删掉本说明段。

## 解决的问题

用户面对什么问题,为什么值得建立这个功能或候选。

## 核心心智

用户需要理解哪些概念,这些概念分别归谁声明和拥有。

## 范围

写清包含什么、不包含什么。
Roadmap 在这里列待裁决分歧;Design 候选在这里说明相对其它 PLAN 的边界与代价。

## 入口

链接实际存在的 Library、CLI、Architecture 与 Use Case 页面。
