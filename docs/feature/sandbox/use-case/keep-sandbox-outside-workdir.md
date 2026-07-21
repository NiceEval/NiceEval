# `--keep-sandbox`:看 agent 在 workdir 之外做了什么

## 解决什么问题

artifact 采的是 workdir 内按 send 窗口归因的变更;agent 全局装了什么包、往 `$HOME` 写了什么配置、PATH 实际长什么样,落盘证据结构性地采不到([盲区](../cli.md))。题通过了但你怀疑它靠的是「装了个全局工具」这类越界手段,或者要核对通过环境的真实状态——需要进活现场看。

## 全流程

1. 用 `all` 档留存(passed 也留,不用故意弄挂一条 eval 才能拿到现场)。`all` 档下历史终态一律不参与携带——即使这条题上一轮刚 `passed`,本次也真实重跑,现场才存在([契约](../cli.md)):

   ```bash
   niceeval exp local onboarding/tool-first --keep-sandbox=all
   ```

2. 从收尾面板拿实例 id,进现场:

   ```bash
   niceeval sandbox enter a3f9c2d1
   ```

3. 查 workdir 之外的世界:

   ```bash
   ls -la ~ && cat ~/.npmrc 2>/dev/null     # $HOME 下写了什么
   npm ls -g --depth=0                      # 全局装了什么
   echo $PATH && which -a node              # PATH 实际形态
   ps aux | grep -v grep | tail             # 有没有留后台进程
   ```

4. workdir 之内的历史用留存现场的完整分类账回放,与窗口对照:

   ```bash
   niceeval sandbox history a3f9c2d1
   niceeval sandbox diff a3f9c2d1 --window turn2
   ```

5. 结论落进 eval(比如补一条「不得全局安装」的断言)或 adapter 修正,然后清理:

   ```bash
   niceeval sandbox stop --all
   ```

## 边界

- 留存只跳过销毁:`teardown` 链照常执行,看到的是收尾完成后的状态。
- 现场销毁后逐窗口账本随之消失;`diff.json` 等落盘 artifact 不受影响。
- `all` 档一次会留多个容器,跑完及时 `stop --all`;下次 `exp` 启动会有残留提醒兜底。

## 相关阅读

- [CLI](../cli.md) —— `history` / `diff` 的窗口语义与面板体裁。
- [Architecture · 变更归因](../architecture.md#变更归因send-窗口与分类账) —— 分类账采什么、不采什么。
