# 用例占用

同一项目里并行的 Invocation 共用一个 ProjectDatabase，同一个用例同一时刻只由一条运行执行：后来者等待，原运行存活或无法取证时继续等，确切终止后换代接手，见 [Experiments 架构](../architecture/README.md)与[并发续跑](../use-case/concurrency-resume-interrupted-run.md)。这一页用模型检查器核对占用、等待与释放。

## 规则

### 一个用例只被一条运行取得 {#Exclusive}

同一用例同一时刻至多被一条运行取得。

### 取得者与数据库一致 {#HandlesMatch}

已取得用例的运行一直对应数据库中的当前占用，直到释放或结束。

### 已结束运行的占用只清一次 {#ReapedOnce}

确认已结束的运行留下的同一份占用只被清除一次。

### 释放即失去占用 {#ReleasedMeansFree}

释放成功后那条运行已经失去占用；后来者已取得时，旧运行迟到的重试也不会动它。

### 等待方最终走完 {#WaiterFinishes}

当前占用能释放、或其运行可以确切证明已结束时，仍在运行的等待方最终走完。

### 释放失败可以重试 {#Retryable}

释放在提交前失败时，仍在运行的同一方可以重试释放。

### 回复丢失可以再确认 {#ReleasedReplySettles}

释放已生效而回复丢失时，仍在运行的一方可以再次确认，无论后来者是否已经取得用例。

### 请求恢复后占用被清除 {#ReclaimOnRequest}

已确切证明旧运行结束、并实际请求恢复时，它的占用最终被清除。

## 模型

```statechart spec="../tla/case-claim/fixed/Claims.tla" config="../tla/case-claim/fixed/c-fixed.cfg" view="../tla/case-claim/fixed/view.ts" out="../tla/case-claim/fixed/out/c-fixed" digest="sha256:ccfd5c045d7bb34130600e3631d2eda135747ee0baa026c34ae04f7c50ae7ab6"
```

```statechart spec="../tla/case-claim/post/Claims.tla" config="../tla/case-claim/post/c-post-diagram.cfg" view="../tla/case-claim/post/view.ts" out="../tla/case-claim/post/out/c-post-diagram" digest="sha256:9dd65d9f407b72687a906b2642eb4c31021533587aef54764c8fd48d1c61c4d9"
```

```statechart spec="../tla/case-claim/post/Claims.tla" config="../tla/case-claim/post/c-post.cfg" view="../tla/case-claim/post/view.ts" out="../tla/case-claim/post/out/c-post" digest="sha256:dde8d81ff72127ccc57575e4b5619102281735222c0c6de5361bffcec4f50065"
```

```statechart spec="../tla/case-claim/cleanup/Claims.tla" config="../tla/case-claim/cleanup/c-cleanup.cfg" view="../tla/case-claim/cleanup/view.ts" out="../tla/case-claim/cleanup/out/c-cleanup" digest="sha256:c3836ffd16a409c9b0320d9a7bba06820d9b5798f0a1042ac2a7aac8f2636cc1"
```

```statechart spec="../tla/case-claim/loss/Claims.tla" config="../tla/case-claim/loss/c-loss.cfg" view="../tla/case-claim/loss/view.ts" out="../tla/case-claim/loss/out/c-loss" digest="sha256:1df07bc36fc601ff706d9d3205389ef2e9ed98d1ef3944238633bc9e4ef50548"
```

五块依次是：两条运行、两个用例的等待与释放；释放生效而回复丢失（两条运行一个用例出图，三条运行两个用例的完整检查只显示报告）；Run 恢复与等待方的接手竞争；取得已提交而回复丢失。前四条规则在五块都成立，后四条按各块的场景检查，也都成立。

原运行退出后证据始终不足时，等待方会一直等：这是保守的预期行为，不是缺陷。

## 按路径重放的测试

- `test/process/execution-claim-recovery-tla-repro.test.ts`：等待方已确认原运行结束、接手之前，Run 恢复先清除了占用，接手曾报 `record-command-conflict`；现在从空占用直接取得。
- `test/integration/execution-claim-delivery.test.ts`：取得已提交但回复丢失时，同一个活着的 Host 曾被自己的旧占用永远挡住；现在能重新取得并释放。
- `test/process/execution-wait-tla-repro.test.ts`、`test/integration/execution-claim-tla-repro.test.ts`：原运行退出后等待方继续走完；释放提交前超时可以重试，提交后回复丢失可以再确认。

## 动作与代码

路径以 `packages/niceeval/src/` 为根。

| 动作 | 代码 |
| --- | --- |
| 取得、查看、等待、接手 | `runner/lock.ts`；`record/sqlite/case-repository.ts`；`runner/run.ts` 的等待窗口 |
| 取证 | `coordination/platform/node-process-identity.ts` |
| 释放与重试 | `runner/lock.ts`；`record/sqlite/coordination-repository.ts` |

## 模型没有覆盖的部分

PID 复用、远端取证与操作系统读取失败，以及取得后重新核对已发布结果的时机。
