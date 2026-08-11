# 源码调用树

一个 attempt 的判定痕迹可以分布在 eval 入口文件和多个项目内的辅助文件中。
源码视图以调用路径组织这些痕迹，不把全部文件平铺，也不把辅助文件中的断言降级成未映射条目。

展示从入口文件开始：

- **主干**是整个 eval 入口文件。
  默认视图可以折叠连续的无关行，但文件顶部的 import、Match 常量和 `defineEval` / `defineScoreEval` 外的声明都属于主干。
- **调用片段**挂在发起调用的源码行下。
  片段只显示 Assertion、direct score、`t.send`、下一层调用和少量上下文。
- **汇总行**先说明被调文件、Assertion evaluation 和 score contribution。
  默认只展开 mismatched、unavailable、计分项未取得完整 contribution 或触发 `.orStop()` 的路径。

例如入口文件第 98 行调用共享安装检查时，读者先看到这一步的汇总，再在同一位置展开失败证据：

```text
 98      await evalInstall(t, { version, standaloneWorkspace: true });
       ↳ evals/install/share/eval-install.ts · 11 assertions · 9 matched · 2 mismatched · score +7
       │ 245✓     t.check(root !== null, isTrue("niceeval.config.ts 存在"));
       │ 246✗     t.check(
       │        mismatched · 评估安装 · satisfies(依赖解析到候选包 niceeval@0.11.0)
       │        expected 依赖解析到候选包 niceeval@0.11.0 · received "0.10.3"
```

调用链是展示精度的增强，不是源码证据可用的前提。
只有声明位置而没有调用链时，入口文件仍作为主干，其它文件按项目相对路径分组显示在主干之后。
这个下限形态保证跨文件断言始终能回到源码。

## 三层模型

源码视图分成三层，上一层不携带下一层的展示选择：

```text
CapturedSourceEvidence
  入口角色、源码正文、每条痕迹的运行时帧路径
                  │
                  ▼
AnnotatedEvalSource
  完整源码调用树、detached 片段与 unmapped 记录
                  │
                  ▼
SourceContent
  按终端或 web 选项裁行、折叠和展开后的投影
```

[`AttemptEvidence`](../../record/library.md) 携带完整的 `AnnotatedEvalSource`。
预算、上下文半径、 `--source=full` 和 web 的默认展开态只影响 `AnnotatedSourceResult`，不改变 evidence。

## 三种回退

调用路径无法完整恢复时，事实仍按下面的顺序保留：

1. 有声明位置和源码，但链不经过主干：进入 `detached`，按最外层项目帧所在文件分组。
2. 有声明位置但源码不可用：保留路径与行号，在相邻可用节点下显示不可展开的缺口。
3. 没有声明位置：断言与给分条目进入 `unmapped`，按 [`toAttemptAssertions(attempt)`](../components/attempt-detail/README.md) 的条目形态平铺。

没有位置的 Turn 不进入 `unmapped`。
Turn 的完整诊断面始终是 [`--execution`](../show/execution.md)，源码上的 send 标注只是跨面指针。

## 边界

- 源码树只承载断言、给分条目和 `t.send` 的归属，不展示任意运行时栈。
- 用户代码直接抛出的错误由 `AttemptNotices` 展示，不伪造成源码标注。
- `node_modules` 中的帧只保留包名标记，不捕获包内源码。
- 树只描述一个 attempt，不负责跨 attempt 源码对照。
- 调用帧没有 invocation 身份，因此同一行循环调用同一辅助文件时合并标注，不报告无法证明的调用次数。

## 相关阅读

- [Architecture](architecture.md) —— 调用链采集、源码快照与完整树的数据形状。
- [Display](display.md) —— 归属、建树和面相关投影。
- [`show --source`](../show/eval-source.md) —— 终端命令、输出和展开入口。
- [`toAttemptSource(attempt)`](../components/primitives/source-view.md) —— web 面交互与视觉规范。
