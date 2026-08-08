# 多容器拓扑 —— 现状约束与候选清单

**相关文档**:[README](README.md) · [GOALS](GOALS.md) ·
[PLAN-1](PLAN-1/README.md) · [PLAN-2](PLAN-2/README.md) · [PLAN-3](PLAN-3/README.md) ·
[PLAN-4](PLAN-4/README.md) · [DECISION](DECISION.md)

---

## 目的

记载候选方案依赖的组件与契约的真实限制。只写现状与影响,
不下裁决。

---

# niceeval 现有 Sandbox 契约

## 产品特性

`environment` 是 eval 上的不透明 profile id;spec 工厂的
`environments` 表把 profile 翻译成单个预构建输出
(Docker image / E2B template / Vercel snapshot)。

## 当前支持

- profile 逐 eval 读取,缺表项启动期报错,一次穷举。
- 读取结果计入 eval fingerprint,输出变化触发重跑。
- 预构建输出 + `sandbox.setup` Hook 两层分工清晰。

## 当前不支持

- 一个 profile 只能是一个输出,表达不了「一组容器加一张网」。
- 没有能力协商:Sandbox 不满足时的结局是运行期假 `failed`,
  不是计划期 `skipped`。
- 服务类资源没有回收、留存、孤儿核对故事。

## 直接影响

各候选方案都要回答:profile 的值升格成什么、缺能力时
判什么、新资源怎么纳入回收与留存。

---

# Docker(本地 provider 的运行载体)

## 当前支持

- 每 attempt 建一张 bridge 网络,内置 DNS 按容器别名寻址,
  服务名语义免费。
- `docker build` 原生支持从任务仓库的 Dockerfile 构建,
  layer cache 天然按内容命中。
- 容器级 healthcheck 与 `docker exec` 探测都可做就绪门。

## 当前不支持

- 默认 bridge 网络地址池有限,数百并发 attempt 同时建网
  会耗尽地址段,需要收敛网络参数或复用地址池。
- compose 文件不是 dockerd 的原语:要么翻译成容器/网络
  API 调用,要么依赖 `docker compose` CLI 插件在场。

## 直接影响

Docker 是各方案里构建与启动成本最低的一档;差异集中在「谁来
翻译声明」。PLAN-1 由 niceeval 翻译 typed 表;PLAN-2 由
niceeval 读取 compose 子集;PLAN-3 用户自己跑 compose;
PLAN-4 由 Docker provider 原生消费 compose,不翻译。

---

# E2B / Vercel Sandbox(云 provider 的运行载体)

## 当前支持

- 两家都是完整 Linux microVM,模板/镜像里预装 docker 后,
  VM 内起容器编排在原理上可行。
- 单 VM 形态下「整组留存」「suspend / resume」语义天然一体,
  不新增注册表资源面。

## 当前不支持

- 官方基础模板未预装 docker;VM 内 docker 的可用性、
  嵌套开销与网络形态**需真机验证**,未验证前不能默认打开。
- Vercel 运行用户非 root,docker daemon 权限路径待验证。
- VM 内容器的服务名寻址要额外做(如 `/etc/hosts` 指向
  容器 IP),不像 Docker provider 那样免费。

## 直接影响

云 provider 在各方案里都是「能力位默认关、验证后打开」;
方案间差异是这条路以什么形态存在——中性声明的翻译目标,
还是 provider 自己的完整 case。

---

# Local provider

## 当前支持

宿主即沙箱,零隔离,独占串行。

## 当前不支持

niceeval 不接管宿主机的容器编排——在用户机器上起一组
容器加网络超出 local 档「不动你的机器」的安全边界。

## 直接影响

带服务的 profile 在 local 的结局只能是 `skipped`
(或用户走外部编排自担语义)。

---

# 共通限制

- **核心中立**:构建与启动差异只能落 provider 侧,任何方案不得
  让 runner / 评分按 provider 名分支。
- **缓存沿用门表**:`failed` 是可携带终态——凡是可能把
  基建失败记成 `failed` 的路径,都会被缓存永久固化,
  这是「宁 `skipped` / `errored` 不假 `failed`」的硬理由。
- **compose 规范体量**:Compose Spec 字段上百,任何
  「支持 compose」的方案实际都是子集;子集边界本身就是
  契约面,越界字段的结局(报错还是忽略)必须显式。
