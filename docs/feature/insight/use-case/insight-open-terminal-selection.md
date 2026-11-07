# 在浏览器打开终端里看到的结果

## 用户目标

苏曼青在终端里发现 Experiment `main` 有一条失败的 Attempt，想在浏览器里连续查看它的轨迹、diff 与 Evidence，并把页面发给同事复核（[AUD-4](../../../user-story.md)）。她希望直接沿用终端里的同一个 selector，浏览器显示的范围与数字和终端一致（[AUD-5](../../../user-story.md)）。

## 起始状态

- 项目里已经发布了 Experiment `main` 的结果，其中 `@ATTEMPT-FAIL` 是一条 `failed` Attempt。
- 本机可以打开浏览器；远程机器上使用 `--no-open`。

## 完整路径

1. 在终端查看 Experiment。输出末尾给出同一 selector 的浏览器命令。{#show-experiment}

   预期输出（末尾）：

   ```text
   $ niceeval show --experiment main
   …
     Eval packaging
     Attempt         Verdict  Duration
     --------------  -------  --------
     @ATTEMPT-FAIL   failed   21.44 s
   …
   Open: niceeval view --experiment main
   ```

2. 下钻到失败的 Attempt。概览末尾同样给出浏览器命令。{#show-attempt}

   ```text
   $ niceeval show @ATTEMPT-FAIL
   …
   Open: niceeval view @ATTEMPT-FAIL
   ```

3. 把 `show` 换成 `view`、参数不变。命令在 stdout 写出一次 loopback URL，浏览器直接打开这条 Attempt 的详情，与复制的 Attempt URL 硬加载时内容相同。{#open-attempt}

   ```sh
   niceeval view @ATTEMPT-FAIL
   ```

4. 在远程机器上只要 URL、不打开浏览器时加 `--no-open`；Experiment selector 打开预选了 `main` 的 Results。{#open-experiment-remote}

   ```sh
   niceeval view --experiment main --no-open
   ```

## 结果

终端与浏览器使用同一套 selector，在同一个 `PublicationCutoff` 上读取同一组 operation，显示的范围、Verdict 与分母一致。详情页的轨迹、diff 等区段在页面内切换，不需要 `show` 的投影 flag。

| 情形 | 用户看到的结果 |
| --- | --- |
| locator 或 Experiment ID 未命中 | stderr 写英文诊断，进程非零退出，不打开浏览器 |
| `niceeval view @ATTEMPT-FAIL --source` | 用法错误：`view` 不接受 Attempt 投影 flag |
| 结果来自 `show --record <file>` | 文本输出没有 `Open` 行，因为搬迁文件没有对应的 View |

## 相关契约

- [Insight CLI · `niceeval view`](../cli.md#niceeval-view) —— selector、`--no-open` 与启动失败。
- [Inspection CLI · 在浏览器打开同一个 selection](../../inspection/cli.md#在浏览器打开同一个-selection) —— `Open` 行的生成规则。
