# PLAN-2:SandboxCommand 意图分类字段(不推荐)

**相关文档**:[决策主题](../README.md) · [GOALS](../GOALS.md) · [LIMITS](../LIMITS.md) · [CASES](../CASES.md)

## 方案定位

给 SandboxCommand 协议增加意图分类(如 `kind: "materialize" | "install" | "probe"`),框架按类别推导缓存策略、`--dry` 展示与复检要求。
作者声明「这是什么类的动作」,框架决定「复用下怎么省」。

## 机制示意

- `materialize` 类:产出进 workdir,框架自动在 workdir 外建内容缓存,每题快速写入。
- `install` 类:产出在 workdir 外,框架要求提供探测,复用下先探测再执行。
- `probe` 类:只读检查,永远执行。

## 守护

| Case | 路径 |
|---|---|
| C1 | checkout 声明为 `materialize`,框架缓存产出 |
| C2 | 安装声明为 `install`,框架按探测决定执行 |
| C3 | 类别即成本视图的输入 |
| C4 | fixture 上传归为 `materialize` 的特例 |

## 缺点

- 分类是 scope 选择的变体:作者又要为每条命令回答一次「它属于哪类」,错分类的症状与放错 scope 同构——fresh 下无症状,复用下爆发。这正是 Sandbox 模型刚用单一频次消掉的负担。
- 框架要理解命令语义才能兑现类别(`materialize` 的「产出」是哪些路径?),要么靠作者再声明产出清单,要么靠观测文件系统推断;前者加负担,后者不可靠。
- 通用分类只能保留各动作的交集,与 PLAN-2(Sandbox 模型)统一 Layer 被否的理由同构:简洁来自删除领域义务。

本候选倾向否决,保留在此供对照。
