# `--source`：把判定放回源码调用树

`--source` 是 attempt-detail 源码区块的深度 text 投影。
它显示本次 Attempt 首次引用各文件时保存的源码，不读取工作树里可能已经改过的版本。
入口文件构成主干；共享 helper 中的断言、给分记录和 send 按运行时调用路径挂到主干或上一层 helper 的调用行下。

```sh
niceeval show @1qrdcfq8 --source
```

```text
evals/install/gpt-researcher.eval.ts
 75    async test(t) {
 ... 12 lines
 89✓     const turn = await t.send(
       turn1 · completed · 12m 04s
 ... 6 lines
 97      await evalInteraction(t, { clarify: CLARIFY, turn });
       ↳ evals/install/share/eval-install.ts · 6 checks · 6 ✓ · 4/4 pts
 98      await evalInstall(t, { version, standaloneWorkspace: true });
       ↳ evals/install/share/eval-install.ts · 11 checks · 9 ✓ 2 ✗ · 7/11 pts
       │ 243    await t.group("评估安装", async () => {
       │ 245✓     t.check(root !== null, isTrue("niceeval.config.ts 存在"));
       │ 246✗     t.check(
       │        gate · 评估安装 · satisfies(依赖解析到候选包 niceeval@0.11.0)
       │        expected 依赖解析到候选包 niceeval@0.11.0 · received "0.10.3"
       │ ... 60 lines
       │ 312✗     t.check(
       │        soft · 独立 workspace · isTrue(独立子目录有自己的 package.json)
       │        received false · 0/1 pts
 99      await evalExperiment(t);
       ↳ evals/install/share/eval-experiment.ts · 4 checks · 4 ✓ · 3/3 pts
 ... 10 lines

unmapped assertions (1) · 没有 loc，不属于任何源码行
  ◌ soft · adapter 未上报 tracing 能力 · reason: 事件流里没有 trace 关联

8 source files · 2 of 43 checks failed
full failure detail:  niceeval show @1qrdcfq8
inline every callee:  niceeval show @1qrdcfq8 --source=full
one file in full:     niceeval show @1qrdcfq8 --source=evals/install/share/eval-install.ts
```

## 行与调用片段

- **断言行**在行号后标 `✓` / `✗` / `◌`，下面按发生顺序列分组、matcher、期望值、实际值与挣分。
- **send 行**显示轮标签、status、墙钟和已有 usage。
  轮次全量内容仍在[`--execution`](execution.md)。
- **调用行**下面显示一条 `↳` 汇总。
  全通过路径默认只显示汇总；有未通过、unavailable、丢分或前置中止时默认内联调用片段。

调用片段使用被调文件自己的行号，每层增加一个 `│` 缩进。
同一调用行循环进入同一个 helper 时，各次标注按发生顺序合并；运行时帧没有 invocation 身份，因此输出不声称调用了多少次。

默认投影折叠连续的无关源码行，并在 400 个源码行预算内优先展开严重失败。
主干行、调用汇总和完整证据树不受预算影响；收起的路径在当前投影只留汇总，并提示 `--source=full`。
完整规则见[源码树投影](../eval-source/display.md)。

## 展开入口

```sh
niceeval show @1qrdcfq8 --source=full
niceeval show @1qrdcfq8 --source=evals/install/share/eval-install.ts
```

`--source=full` 内联全部调用路径，包括全通过路径；每个节点内部仍折叠连续的无关行。

`--source=<path>` 切换到单文件模式：指定文件全文显示，本次 Attempt 落在它上面的标注全部标出。
能回到主干的标注附主干调用行；detached 标注附完整项目帧路径。
参数按捕获路径的后缀匹配，命中多个文件时按用法错误退出并列出候选；`full` 是保留字。

## 不完整调用链

调用链不经过主干时，源码片段按最外层项目帧的文件分组，排在主干之后：

```text
outside the eval entry · lib/candidate.ts
 41✗     t.check(pages.length, greaterThan(0));
      gate · 候选包里存在合格落点 · greaterThan(0) · received 0
```

链中缺少源码时保留 `source unavailable: <path>`；经过第三方包时保留不可展开的`package: <name>`。
更深的项目源码仍挂在缺口下面。
只有真正没有 `loc` 的断言和给分记录进入`unmapped`。

没有任何源码时命令非零退出并报告 unavailable，不伪造空文档。

## 尾部取证

失败视图尾部给出三条路径：Attempt 首页展开完整 expected / received 预览，`--source=full` 内联全部调用路径，`--source=<path>` 读取一个文件全文。
脚本使用 `AttemptHandle.sources()` 获取带入口角色的`SourceArtifact[]`，不需要自行解引用 `sources.json`。

## 相关阅读

- [源码调用树](../eval-source/README.md) —— 多文件源码的心智模型与降级下限。
- [`toAnnotatedEvalSource(attempt)`](../components/attempt-detail/README.md) —— 同一份证据的 web 投影。
- [Assertions 展示](../../assertions/library/display.md) —— 每条标注的判定语义。
