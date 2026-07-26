# 导出与发布

结果要发给别人:贴给同事、挂到内网、签进仓库长期托管。终点都是一个静态目录,但到那个目录有两条路,
差别在于**挑选能不能用前缀说清楚**。

## 直接导出

按实验或题挑得清楚时,一条命令:

```sh
niceeval view --exp compare/codex --out site
```

`--out` 就是 build:建一次、写盘、退出。**出站的就是收窄到的** —— 页面 Sample 与 `artifact/` 证据树
跟随同一份收窄,被滤掉的 attempt 的证据文件不出站。产物形状与托管约束见
[View · 静态导出](../../reports/view.md#静态导出)。

导出没有体积档位:收窄范围内前端会读的证据文件全部随站复制。要瘦,在下一节构根时决定。

## 先构一个发布根

三种情况前缀说不清,先用 [`publish()`](../../record/library.md#发布publish) 构一份新的记录根,
再让宿主读它:

| 情况 | 为什么命令行不够 |
|---|---|
| 只带一部分证据种类 | 收窄挑的是「哪些 attempt」,不是「每个 attempt 带什么」 |
| 按任意条件挑 Run | 命令行只有前缀语义 |
| 把数据签进仓库长期托管 | 产物必须自包含,不能依赖原记录根还在 |

```ts
const record = await openRecord(".niceeval");
await publish(latestRuns(record), "site-data/run", {
  artifacts: ["commands", "sources", "events", "trace"],   // 瘦身:不带 diff
});
```

```sh
niceeval view --record site-data/run --out site
```

## 为什么发布必须物化

[携带条目](../../record/library.md#携带条目与-evidencestate)的证据字节留在原 Run 目录里,靠
`artifactBase` 指过去 —— 省的是同一份对话和 trace 不被复制很多遍。这在本地是纯赚,跨出这台机器就是
个坑:原 Run 一删,借来的证据静默消失。

`publish()` 做的就是物化:解引用、复制、产物自包含,不带回退指针。所以「离开本地之前先 publish」
不是可选优化,是[跨层不变量](../README.md#跨三层的不变量)第六条。

## 发出去之前看一眼

发布前想确认页面长什么样,不用先导出再打开文件 —— 本地模式和 `--out` 是同一条管线的两种模式,
同一份收窄下逐字节一致:

```sh
niceeval view --record site-data/run        # 看
niceeval view --record site-data/run --out site   # 发
```

## 内容边界

导出的产物包含收窄范围内**完整的原始证据**:prompt、工具参数、完整输出、源码,深链一点开就是原文。
发布给谁、内容适不适合公开,在选收窄和构记录根这两步决定,导出层不再过滤。运行环境注入的秘密由格式
在采集侧挡在结果文件之外。
