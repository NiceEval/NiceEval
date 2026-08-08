# 收窄读取范围

Record 根里堆着十几个实验、几个月的历史,而你这次只想看两个 agent 在同一批题上的对照。
收窄就是这一步: 把 Record 根滤成**有效根**,再交给选择器出 Sample。

收窄是选择层的事,所以两个宿主用的是同一套输入 —— 在 `show` 上学会的写法,`view` 上原样成立。

## 三种收窄输入

```sh
niceeval show memory/                       # 位置参数:eval id 前缀
niceeval show --exp compare/codex           # experiment id 路径段
niceeval show --record tmp/published-run    # 换一个记录根
niceeval view --exp compare/codex memory/   # 两者组合取交集,view 上同义
```

| 输入 | 收窄什么 | 匹配方式 |
|---|---|---|
| 位置参数 | 哪些题 | eval id 前缀 |
| `--exp` | 哪些实验 | experiment id 路径段 |
| `--record` / `--run` | 从哪读 | 换 Record 根 / 只开一份 Run |

位置参数永远只有「eval id 前缀」一种含义,文件与目录走 `--record` / `--run` —— 位置参数的含义不随文件系统里有没有同名目录而改变。
逐条 flag 契约见 [Show · 选择结果范围](../../reports/show.md#选择结果范围) 与 [View · 打开与收窄](../../reports/view.md#打开与收窄)。

## 收窄之后分母跟着变

收窄会先改变 Sample 的总体，再让命中范围事实随同一范围重算。
当前范围内没有结果的题进入结构化 `coverage[].missing`，原因明确区分为 `never-run` 或 `previous-result`；范围之外的实验与题不再属于这份 Sample。
所以一屏上的通过率永远配着一个说得清的当前分母，不会用旧配置判定补数。

跨历史拼题另有前提:`currentSample` 只把 `configHash` 相同的 Run 拼进来。
改过 model 或 flags 之后只补跑了一部分题,旧配置那些题不冒充新配置的当前结果,直接进缺口。

## 两个 `--exp` 是对照,不是并集

`show` 上重复给 `--exp` 进入对照语义:每个 `--exp` 是一个对照条件,必须恰好定位到一个 experiment。
前缀匹配到多个时按用法错误退出并列出候选,不猜。
契约见[对照矩阵](../../reports/show/compare.md)。

想要「这两个实验放一起看」的并集视角,给一个能同时命中的前缀,或者在报告文件里表达。

## 命令行表达不了的挑选

命令行收窄只有前缀语义。
要按任意条件挑 —— 「只要上周之后的」「排掉那个已知坏掉的实验」「只带一部分证据种类」 —— 有两条路,按目的分:

| 目的 | 用什么 |
|---|---|
| 临时看一眼 | `sample.pipe(dropExperiments(…) / filterAttempts(…))`,在脚本或报告文件里 |
| 构一份要发出去、要签进仓库的数据 | [`publish()`](../../record/library.md#发布publish) 构发布根,再让宿主读它 |

不给 CLI 加谓词语法,理由在[跨层不变量](../README.md#跨三层的不变量)第四条:自由度必须是闭集, 一旦命令行能写表达式,它就开始长成半门查询语言。

## 报告聚焦,证据全量

还有一种需求长得像收窄,其实不是:**页面上只想突出某个实验,但证据要保持全量。
** 那是看法层的事, 在报告文件里把收窄后的 Sample 传给组件的 `input`,命令行不收窄。

判据:收窄决定**站点里有什么**,报告的 `input` 决定**这一块看什么**。
收窄之外的 attempt 在导出站里深链不可达,报告 `input` 之外的 attempt 仍在站内、仍可点开。
