# bub ensureBub 的 checkpoint 警告用裸 console.error,并发下无法归属

## 现象

`bub checkpoint cache backfill failed ...` 警告(以及对称的 restore 失败警告)直接
`console.error` 打出,没有其它日志行都有的 `· <evalId> [who]` 归属前缀。并发多配置
运行时,从日志上分不清是哪个 attempt 发出的。

## 根因

`ensureBub` 在模块级共享安装锁(`installsInProgress` / `memCheckpoints`)里运行,
天然跨 attempt 共享,函数签名只有 `(sb, home)`,拿不到触发调用的 attempt 的
`AgentContext.log`——于是退化成裸 console.error。

## 修法

`ensureBub` 加 `log: AgentContext["log"]` 形参,`setup(sb)` 改 `setup(sb, ctx)` 传
`ctx.log`,两处 `console.error` 换成 `log(...)`(修在 `src/agents/bub.ts`)。归属
口径裁决为「触发安装的那个 attempt」,不追求归属到全部复用缓存的 attempt。

适用判断:agent adapter 里任何面向宿主控制台的输出都应走 `ctx.log`(自带归属前缀
且能被 Live 收编),裸 console.* 只配出现在没有 ctx 可拿的纯模块层——而那种层里
的输出本身就该怀疑是不是放错了地方。
