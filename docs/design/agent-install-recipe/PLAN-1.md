# PLAN-1 —— 工厂加选项:`fromImage` 参数

**相关文档**:[README](README.md) · [GOALS](GOALS.md) ·
[LIMITS](LIMITS.md) · [PLAN-2](PLAN-2.md) · [PLAN-3](PLAN-3.md) ·
[DECISION](DECISION.md)

---

## 实现方案 1(工厂加选项,是否推荐见 [DECISION](DECISION.md))

### 简述

保持工厂形态,给 `e2bCodingAgentTemplate` 加一个可选的
底座参数;省略时行为与今天完全相同:

```typescript
e2bCodingAgentTemplate("codex", {
  fromImage: "ghcr.io/laude-institute/t-bench/ubuntu-24-04:20250624",
});
```

工厂内部按底座来源分两条路:官方 agent 基线走既有归一,
`fromImage` 底座先补 Node、再走契约规范化与 agent 安装。
改动集中在一个函数,公开面只多一个字段。

### 优势

- **R2 满分**:签名向后兼容,Case A 一行不改。
- **R1 达成**:TB 底座可换,契约内容仍在 niceeval 内部,
  下游零手抄、自动跟随。
- 改动面最小,没有新导出、没有新概念。

### 缺点

- **R5 不满足**:工厂按内置 agent 名分发配方,未内置的
  agent 在这个形态里没有入口;自定义要么等 niceeval 内置,
  要么回到手抄契约的老路。
- **R6 不满足**:配方仍活在工厂函数体里,Docker 用户
  引用不到任何片段,Node 工具契约依旧没有出处。
- **R4 不推进**:构建期与运行时回退的安装命令继续各写
  一份。
- **选项轴叠加**:`bubPythonPackages` × `fromImage` ×
  将来每个新维度都进同一个 options 对象,组合语义(哪些
  选项在哪种底座下有效)藏在函数体里,契约面随选项数
  平方增长。
- 组合本来已经是分层形态(契约层、校验层都是
  builder 中间件,见 [LIMITS](LIMITS.md)),把唯一还焊着
  的一步用选项参数绕过去,是在分层旁边开旁路,不是补齐
  分层。

---

### 架构 / 数据流

```text
e2bCodingAgentTemplate(agent, { fromImage? })
 ├─ 省略 fromImage → Template().fromTemplate(官方基线) → 既有路径
 └─ 给定 fromImage → Template().fromImage(ref)
     → 补 Node(底座无 Node 时)
     → withNodeToolContract(任意底座模式)
     → 安装 agent CLI
     → verifyE2BNodeToolContract
```

---

### 落地路线

1. `withNodeToolContract` 长出任意底座模式:探测 Node、
   声明 apt 支持面、范围外构建期报错。
2. 工厂加 `fromImage` 分支。
3. TB 底座冒烟:从 `t-bench/ubuntu-24-04` 建 codex 模板,
   八道卡住的题跑通。

---

### 验收 / Definition of Done

1. **底座可换(R1)**:上面的 TB 示例建出模板,attempt 里
   `Rscript` / `sqlite3` 可用且 codex 正常起动。
2. **Case A 不回归(R2)**:既有构建脚本不改重跑,产出
   模板与改动前行为一致。
3. **支持面显式(R3)**:传入 Alpine 底座,构建期报错点名
   不支持的包管理器,不产出模板。

**反指标**:

- `fromImage` 底座上契约校验被跳过——模板建成、运行期
  `npm install -g` 才 EACCES,正是本主题要消灭的坏法。

---

### 和其它方案的关系

- **vs PLAN-2**:能力面是 PLAN-2 的严格子集;两案共享
  「契约层长出任意底座能力」这一步,差异只在这步能力以
  选项还是以导出中间件暴露。
- **vs PLAN-3**:不构成 PLAN-3 的台阶——配方没有独立
  存在,单源化要先做 PLAN-2 的拆分。
