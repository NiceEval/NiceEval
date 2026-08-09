# 可编辑 Record 以稳定核心和局部通道替代全局 schema 升版

日期：2026-08-09

## 起因

Results Format 从 schema 1 到 15 反复因领域字段变化整体升版。每次破坏性变化都会让所有旧结果无法继续 carry 或读取；后来的 Graph、revision、hash、proof 与镜像设计又试图保存并验证每一版历史，显著增加了单条 Record 的体积和读写复杂度。

产品并不需要防止用户伪造，也允许用户在停稳时直接修改结果。继续维护不可变历史和密码学证明没有业务收益。

## 裁决

采用全新且不兼容的格式名 `niceeval.record`，拒绝 Results 1–15，不提供迁移、兼容层或“请安装旧版本”提示。

Record 是可编辑的当前数据集，不保存 revision、hash、proof 或编辑历史。落盘契约拆成两层：

1. 永久冻结的极小核心只含 root；Run identity、experiment、completedAt 与 expected membership；三种 Member；Attempt identity、eval 与 origin；channel descriptor、coverage、路径、latest 排序和原子发布规则。
2. Verdict、eligibility、assertions、conversation、usage、diff 等业务事实进入 owner-local 的具名 channel。

取消全局整数 schemaVersion 不等于取消语义代际。破坏性领域变化必须采用不可复用的新描述性 channel 或 event 名称；unknown 或 retired decoder 只让该通道 `unsupported`，不让整个 Record 失效。触及 Record Architecture 穷尽列出的格式演进边界时，才更换整个格式名。

`niceeval.verdict` 与 `niceeval.eligibility` 是 carry planner 的仅有永久依赖，精确 payload 永不扩展；破坏其语义等于破坏整个格式。identity 使用 `{ domain, value }` 不透明 token，只比较相同 domain；算法变化换 domain。无法归约到既有 identity、duration 或本次 policy 的新持久 carry gate 必须更换完整格式名。

Report 不解释磁盘。Sample 只选择核心与分母；ReportPlan 形成后，唯一 composition adapter 才按需读取 facts。Calculation、Page 与 Download 只执行一次，view 和静态 export 共用 ReportExecution。静态 artifact 只含已形成的数据与 exporter 内建 runtime，未来 NiceEval 不重新打开它。

## 否决方案

- 保留 schemaVersion 并继续整包升版：延续“一处变化、全部历史失效”。
- 删除版本字段但让核心对象自由加字段：只是隐藏版本，reader 仍无法稳定解释旧数据。
- 继续 Graph、revision、hash 与 proof：解决了产品没有要求的防伪与历史验证，增加体积和实现面。
- 让 Report 兼容所有磁盘代际：会把每个 Report 变成第二套 reader，兼容逻辑继续扩散。
- 全部改成 event log：Verdict 等可编辑单值和大 artifact 的人工编辑、随机读取体验很差；采用 document、JSONL 与 blob 的混合模型。

## 后果

- 用户可直接改 Verdict、Usage 或其它通道，后续 Sample/Report 读取当前值。
- 一个坏或未知的未请求通道不阻断其它页面；请求到 invalid 通道时必须失败，unavailable/unsupported 必须显式呈现。
- 旧 Results 数据不会被新版本打开；需要保留可读交付物时，在旧系统中导出自包含静态 Report。
- 核心冻结纪律变得关键。任何把新业务字段塞回核心文件的提案都必须拒绝或触发全新格式名。

目标契约见 `docs/feature/record/`、`docs/feature/sample/` 与 `docs/feature/reports/`。
