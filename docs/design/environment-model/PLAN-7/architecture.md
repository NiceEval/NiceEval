# PLAN-7 —— Architecture

**相关文档**:[方案](README.md) · [Library](library.md) · [Lifecycle](lifecycle.md) · [Use Cases](use-case/README.md)

## 数据模型

```text
EvalDef
├── Environment profile/source
├── setup / teardown
└── test(t)
    ├── ordinary Sandbox uploads
    ├── Agent turn(s)
    ├── ordinary Sandbox commands
    └── assertions

Attempt
├── one resolved Sandbox Case
├── Agent-visible materialization closure
├── send-window attribution ledger
└── local transfer manifest
```

文件用途不进入 EvalDef 类型。
运行顺序决定 Agent 能否看见文件，`send` 区间决定写入归因。

## Send 区间是唯一边界

Runner 只在 `t.send()` 从发出到返回的区间把 Sandbox 变化归因给 Agent。
区间前、区间间与最后一个区间后的 Eval 代码都属于 eval 归因。

因此测试脚本现建的 venv、coverage 与 cache 不进入 agent diff，也不需要特殊 phase 或 `diff.ignore`。
作者在上传后再次 `send` 时，下一轮看见这些文件是正常顺序语义。

## 动态依赖而不是声明表

本地 source 进入普通上传 API 时，Runner 在实际读取字节的同一处生成 transfer manifest。
没有模块级登记表，也没有把相同路径再写一遍的 keyed field。

第一次运行前无法完整知道任意 TypeScript 将走到哪些上传调用。
PLAN-7 不用 AST 猜路径，不用 planning mode 假执行 callback，也不把所有 folder 文件粗暴算成判据。

## 携带

历史 Attempt 同时保存 Eval 源码闭包身份与 transfer manifest。

- 源码闭包不变：规划期重算 manifest 中的本地 source，内容与匹配集不变才允许携带。
- 源码闭包变化：旧依赖集合可能已不完整，不携带，真实执行产生新 manifest。
- Buffer 上传：内容来自运行期普通代码，除非其上游本来已进入源码/数据指纹，否则不增加一个伪造的本地 source。

这是一种动态依赖缓存，与普通构建系统保存上次真实读取结果同理。

## 泄漏检查

Sandbox materializer 写入 Agent 启动前实际可见的 build context、image provenance 与 bind-mount closure。
Attempt 封口前，Runner 把 `send` 区间外上传的本地 source 与该 closure 比对。

若同一内容已经在 Agent 可见面中，Attempt `errored`，不接受跑测判分结果。
后续运行可用历史 manifest 在 Agent 启动前预检；首次运行只能事后拒绝结果，不能宣称阻止了暴露。

solution 从未被 Eval 读取时，不进入 transfer manifest，也不需要 `privateFiles` 字段。
是否把 solution 放进 image 是 Environment package 自身的安全责任；Terminal-Bench 用 `.dockerignore` 与隔离目录兑现。

## 模块求值没有运行期副作用

Compose project 名、容器名、临时目录与日志归档由 materializer 按 Attempt 创建。
顶层随机数或宿主目录创建既污染身份，也没有 lifecycle owner。

## 不建立文件子框架

PLAN-7 不增加 Fixture mount、Criteria handle、Private file、Verifier、VerifyContext 或 after-Agent context。
上传、下载、命令与断言各自只有一套普通 API。
