# PLAN-1：Astro-first integration 与 islands

**相关文档**：[README](../README.md) · [GOALS](../GOALS.md) · [LIMITS](../LIMITS.md) · [CASES](../CASES.md) · [DECISION](../DECISION.md)

## 解决的问题

本方案把用户 benchmark 网站定义成 Astro integration。NiceEval 提供 `.astro` 组件、route 生成、静态构建 hook 与 server adapter，用户在 Astro 页面里选择 island hydration。

CLI 与 Insight 仍保持独立。公共网页能力则以 Astro 的编译和部署模型为中心。

## 核心心智

```text
Record → Analysis
           ├─ CLI
           ├─ Insight
           └─ @niceeval/astro
                ├─ generated routes
                ├─ Astro components
                └─ React islands
```

用户配置 integration，再把 NiceEval 组件放进页面：

```astro
---
import { Benchmark } from "@niceeval/astro/components";
---

<Benchmark definition="quality" client:visible />
```

静态构建由 integration 在 Astro build 时读取 Record。动态页面通过 Astro adapter 在 request time 查询 Analysis。

## CLI 与 Insight

`niceeval query` 仍提供 discovery、query 与 explain。`niceeval show` 保留人读快速查看，`niceeval insight` 提供固定排障界面。

这些命令不复用 Astro 组件，但 integration 会为网页重新定义一套查询、资源和 route 生命周期。

## 公共网页面

- integration 拥有 Astro config hook、route、数据加载、静态输出与 server adapter 接线；
- Astro component 拥有用户可见结构；
- React island 负责图表与交互；
- 用户通过 props 与 slot 调整内容。

Astro 要求 `client:*` 出现在直接 import framework component 的 `.astro` 源码里。integration 因而不能把 hydration 完全封进一个可移植数据定义，也不能让同一调用面自然进入 Next、Remix 或非 React 网站。

## 静态与动态

静态与动态各走 Astro 自己的 build / adapter 生命周期。两者可以共享 Analysis descriptor，却不天然形成同一份可保存、可校验的公共数据文件。

用户若要把数据交给 ECharts、Python 或另一个 server consumer，仍需从 integration 内部取出私有 loader，或等待第二套 data export。

## Cases

| Case | 结果 |
|---|---|
| C1–C3 | CLI 可以兑现，但与 Astro integration 没有共同公共 transport。 |
| C4–C5 | CLI 与 Insight 可以独立兑现。 |
| C6 | Astro 路径直接，但用户仍受 integration route 与 component 边界影响。 |
| C7 | 依赖 Astro adapter，无法作为任意用户 server 的中立能力。 |
| C8 | hydration 直接，但 NiceEval 组件必须进入用户编译现场。 |
| C9–C12 | 需要另补 Bundle 级协议才能稳定兑现。 |

## 代价

- 把 Astro、hydration 与部署 adapter 变成产品公共协议；
- 无法自然服务普通 React、Vue、Svelte、server script 与其它数据消费者；
- route、loader、component 和 static export 会重新形成一个 NiceEval 网页平台；
- CLI、Insight、Astro integration 容易各自产生一套 transport 与错误语义。

本方案满足 Astro 用户的最短路径，却违背 G5、G6、G7 与 G16。
