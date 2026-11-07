---
relations:
  - role: supports
    target: docs/feature/experiments/use-case/cache-niceeval-upgrade.md
---

# NiceEval 身份计算变更用具名域变更证明沿用

## 背景

8 月 Record 重写（`c9853a2d4`）删除了 cache 契约中的「manifest：哈希做比较，清单做解释」一节，连同“跨版本的等价性只能由明确迁移规则证明”。实现仍保留具名差异与 `algorithmVersion` / `coverageVersion`，但版本不同时只能给出 unexplained，没有迁移路径。
#300 的收紧修复让 `accept` 拒绝无法证明的跨 identity 采用；工作区规则却要求核心改动后用 `accept` 重锚下游结果。两条规则相加，NiceEval 自身的身份计算变化只能变成整批付费重跑，且 dry 只给 reason code。

## 裁决

- 恢复差异说明契约：identity 不相等的比较必须带 `IdentityExplanation`，采用后仍不沿用时比较 exact origin。
- NiceEval 每次更换身份 domain 都登记具名 `IdentityDomainChange`。`encoding-only` 保留旧域纯计算，用当前冻结输入重建 origin digest，逐字相等即直接 carried；`behavior-changing` 必须重跑。
- 未登记的 domain 差异与同域 digest 漂移是 NiceEval 缺陷，由发布校验阻断，不让下游用重跑或 `accept` 掩盖。

## 被否决的方向

- 让操作者用 `accept` 确认 NiceEval 升级后的等价：确认不能证明行为未变，与有限采用规则冲突。
- 把旧输入迁移到新域：需要持久化旧计算原料并引入第二份资格事实；从当前输入重建旧 digest 与 `experiment-rename/v1` 同构，不需要新事实。
- `encoding-only` 也要求 accepted 见证：重建相等与 digest 相等同等强度，多一步采用只增加升级成本。
- 只靠现有 Run context 与 Sources 识别 domain：实现核对发现 Record 不保存 Eval manifest、domain 版本、完整 config、plan 与数据哈希，历史 Run 无从识别 domain。改为新增 Run 级 `niceeval.identity-manifests`，只用于解释与识别 domain；缺少它的历史 Run 给出 `identity-manifest-missing` 部分解释，不经域变更沿用。

契约：[Cache · 差异说明与 NiceEval 身份域变更](../docs/feature/experiments/architecture/cache.md#niceeval-身份域变更)，用例：[升级 NiceEval 后沿用已有结果](../docs/feature/experiments/use-case/cache-niceeval-upgrade.md)。
