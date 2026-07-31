**相关文档**:[README](README.md) · [GOALS](GOALS.md) · [LIMITS](LIMITS.md) · [PLAN-1](PLAN-1.md) · [PLAN-3](PLAN-3.md) · [PLAN-4](PLAN-4.md) · [DECISION](DECISION.md)

---

## 实现方案 2(单 template + 统一 Layer,不推荐)

### 简述

Sandbox 的内容 = 一个 template + 一组 Layer。
template 是 provider 原生起点(Docker image、Compose 构建出的 image 组、E2B template、Vercel snapshot),整条 Attempt 只有一个来源。
所有安装内容——Experiment 工具、Eval 附加条件、Agent CLI——都用同一个 `defineLayer` 协议声明,互相独立、并行安装。
与 PLAN-1 的根本差异:概念不按来源分类,安装不排序,检查样板归框架。

### 调用形状

评估环境较重时,Eval 是 template 的来源:

```typescript
export default defineEval({
  environment: composeEnvironment({
    file: new URL("docker-compose.yaml", import.meta.url),
    workspaceService: "client",
  }),
  async test(t) {
    await t.send(TASK);
  },
});
```

实验环境较重时,Experiment 写 template 与 Layer:

```typescript
export default defineExperiment({
  agent: codexAgent({ mcpServers: [mempalMcp] }),
  sandbox: e2bSandbox({ template: BASE_TEMPLATE }),
  layers: [mempal, companyCertificates],
});
```

两边都较重时,Eval 继续声明 `environment`,Experiment 只加 `layers`,不写单个 template。

### template 只有一个来源

| Eval `environment` | Experiment 侧 | 生效 template |
| --- | --- | --- |
| 未声明 | 声明单个 template | Experiment 的 template |
| 声明 | 未声明 template | Eval environment 构建出的 template |
| 声明 | `templates` map 命中该 Eval | map 指定的预制 template |
| 声明 | 声明单个 template | 启动期配置错误,报错列出两个声明位置 |

map 是同时存在两侧时的唯一表达:

```typescript
dockerSandbox({
  templates: {
    "terminal-bench/sheets": "acme/tb-sheets@sha256:...",
  },
});
```

key 是 Eval 的环境 profile,值是 provider 原生 template。
map 不是第二种安装机制,只是同一个槽位的按题覆盖:用预制产物替换按需构建,Eval 文件不动。

### Layer:唯一的安装协议

```typescript
const mempal = defineLayer({
  name: "mempal",
  identity: {
    version: "0.9.0",
    installerDigest: MEMPAL_INSTALL_SH_SHA256,
    model: "minilm-l6@sha256:9f2c...",
  },
  install: async (sandbox, ctx) => {
    await installMempal(sandbox, MEMPAL_INSTALL_SH);
  },
});
```

- **检查样板归框架。**
  install 成功后框架把 identity 写进 Sandbox 内受管 manifest;下次同 identity 直接命中,跳过 install。
  作者不写检查代码也得到漂移防护:identity 任一项变化,旧安装不命中。
- **预制 template 命中同一条路。**
  想让 Layer 在预制 template 里直接命中,构建脚本把 identity 写进同一 manifest 路径;缺失或过期时 Layer 现场补装。
- **自定义 `inspect` 是逃生舱。**
  manifest 无法代表真实状态时(只读文件系统、外部安装源),作者自己实现检查并返回实际 identity,框架仍负责比较。
- **并行。**
  `layers` 是集合,不承诺顺序;全部未命中的 Layer 并行 install。
  有先后依赖或共享包管理器的内容合并成一个 Layer(依据见 [LIMITS](LIMITS.md) 并行安装一节)。
- **通用。**
  adapter 把 Agent CLI 表达成一个内部 Layer,与用户 Layer 同池并行;Eval 需要附加安装时同样声明 `layers`。
  安装协议只有这一个,没有平行的 adapter 安装机制或安装类生命周期 Hook。

### 优势

| GOALS 需求 | 怎么满足 |
| --- | --- |
| 1 重环境 Eval 免注册 | `composeEnvironment` 直接被 Docker Provider 消费,无转换器、无第二张表 |
| 2 一个安装单元、样板归框架 | 最小 Layer 只有 name、identity、install;manifest 读写与比较归框架 |
| 3 安装内容同一概念 | Eval、Experiment、Agent CLI 全走 `defineLayer` |
| 4 免顺序、默认并行 | `layers` 无序集合,依赖靠合并表达 |
| 5 template 来源唯一 | 一个槽位、一张裁决表,双声明报错,map 是唯一共存出口 |

### 缺点

- 顺序依赖没有表达位:跨 Layer 依赖(证书 → 内部 registry → 运行时)必须合并进一个 install 函数,复用粒度变粗。
- 框架代管 manifest 假设 Sandbox 有可写受管路径;做不到时退回自定义 `inspect`,负担回到作者。
- identity 是作者申报值:安装脚本改了、digest 忘更新,框架无从发现;digest helper 能降低出错面,消除不了。
- 并行安装的失败归因比串行难读:多个 Layer 同时失败时要逐个报,不能只报第一个。
- template 不能代表完整 Compose case:多 service、网络、ready、能力句柄与资源组没有表达位。
- manifest 只证明曾经安装,不能证明当前实际状态;把 `inspect` 设为逃生舱会弱化漂移检查。
- Agent 安装还包含 staged payload、平台探测、显式安装模式与安装事实,最小 Layer 协议无法承载。
- 内部 Agent Layer 与用户 Layer 可能争用同一包管理器,用户却无法把两个不同所有者的 Layer 合并。

### 身份与迁移

- fingerprint 侧:template 身份(image digest、template 名、Compose 内容)与全部 Layer 的 `{ name, identity }` 进入指纹;Layer 集合无序,参与哈希前按 name 排序。
- 迁移面:sandbox case 的双表配置、materializer 注册、`AgentProvisioner` 独立协议与 Environment / Provision 二分,统一改写成本模型;定稿后重写 feature 契约,不保留别名或兼容分支。
