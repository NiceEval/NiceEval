# PLAN-2 —— compose 直引:profile 引用任务自带的 compose 文件

**相关文档**:[README](README.md) · [GOALS](GOALS.md) · [LIMITS](LIMITS.md) · [PLAN-1](PLAN-1.md) · [PLAN-3](PLAN-3.md) · [PLAN-4](PLAN-4.md) · [DECISION](DECISION.md)

---

## 实现方案 2(compose 直引,是否推荐见 [DECISION](DECISION.md))

### 简述

环境 profile 的值直接引用任务仓库自带的 `docker-compose.yaml`,niceeval 解析其受支持子集并负责物化与生命周期。
TB 任务全部随仓库携带 compose 定义,这条路把迁移成本压到接近零:

```typescript
export default defineConfig({
  environments: {
    "tb-sheets": composeEnvironment({
      file: "tasks/simple-sheets-put/docker-compose.yaml",
      agentService: "client",   // compose 里哪个服务是 agent 沙箱,其余都是伴随服务
    }),
  },
});
```

`agentService` 指名的服务被抽出来当 agent 沙箱的定义来源,其余服务照 compose 声明物化。

### 优势

- **R8 满分**:TB 任务零手抄,compose 里已有的 `healthcheck`、`depends_on`、`build`、`env` 直接复用;「镜像推导有洞」这类人工翻译错误整类消失。
- 任务作者的既有心智模型(compose)原样可用,不学新词汇。
- 服务语义(依赖顺序、健康检查参数)比 PLAN-1 第一版更全,因为 compose 已经定义了这些字段。

### 缺点

- **子集边界是永久契约面**([LIMITS](LIMITS.md)):Compose Spec 字段上百,volumes 的宿主挂载、ports 的宿主发布、profiles、extends 都必须显式拒绝。
  「支持 compose」在用户预期里是全集,每个被拒字段都是一次预期落空。
- **R6 变贵**:指纹要解析 YAML、追每个服务的 build context、env_file、插值变量;compose 的求值语义(环境变量插值、override 文件)让「同一份文件」不再等于「同一个环境」。
- **agent 沙箱定义被 compose 接管**:`agentService` 的 image/build 与 spec 表的「起点产物听 provider 词汇」冲突,等于为 Docker 形态开了后门。
  E2B / Vercel 上这个服务定义翻译不过去——provider 解耦最弱的一案。
- **物化耦合**:要么运行时依赖 `docker compose` CLI 插件,要么 niceeval 自己实现 compose 子集的编排语义;前者是新的环境依赖,后者是把别人的规范抄进核心。
- eval 的环境需求(能力协商输入)要从 compose 文件推导,推导器本身就是 README 里「镜像推导有洞」问题的形状——只是从下游挪进了 niceeval。

---

### 架构 / 数据流

生命周期与 PLAN-1 相同(建网 → 服务 → ready → agent 沙箱 → … → 评分 → 销毁);差异全在声明来源:

```text
composeEnvironment(file, agentService)
 → 解析受支持子集(越界字段启动期报错,不静默忽略)
 → agentService 抽出 → 翻译成 agent 沙箱起点(仅 Docker 可直译)
 → 其余服务 → 与 PLAN-1 同一套物化路径
```

---

### 落地路线

1. compose 子集解析器与越界字段的穷举报错。
2. `agentService` 抽取与 Docker 物化。
3. 指纹:YAML 规范化 + build context 内容哈希 + 插值封闭。
4. 其余同 PLAN-1 的 3、5、7 步。

---

### 验收 / Definition of Done

1. **零手抄迁移(R8)**:任一 TB 任务只写 `file` + `agentService` 两个字段即可跑通。
2. **越界显式(LIMITS)**:含宿主 volumes 的 compose 文件在启动期报错并点名字段,不静默忽略。
3. **R2 / R3 / R7**:同 PLAN-1 验收 2、3、6。
4. **指纹(R6)**:改 compose 引用的任何 build context 文件触发重跑;改一个被拒字段之外的注释不触发。

**反指标**:

- 越界字段被静默忽略,环境与 compose 语义不一致但照常跑——正是本方案要消灭的「环境不对等假 failed」换壳回归。
- e2b 上 `agentService` 的 build 被悄悄替换成基础模板,agent 跑在与 Docker 不同的环境里,跨 provider 结果不可比。

---

### 和其它方案的关系

- **vs PLAN-1**:同一套运行时,声明来源不同。
  compose 解析以导入器身份并入 PLAN-1(`environmentFromCompose` 产出同一份规范化拓扑)——迁移收益保留,contract 实体仍是封闭字段集。
- **vs PLAN-3**:PLAN-3 里 compose 由用户自己跑,niceeval 不解析;本方案把解析义务接进 niceeval。
