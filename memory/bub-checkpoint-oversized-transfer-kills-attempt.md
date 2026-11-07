# bub checkpoint 100MB+ 单次传输在 e2b 上不可靠,且缓存回填失败会杀掉已就绪的 attempt

## 现象

e2b 上跑 bub 的 eval 大面积 error(非 fail),错误栈几乎都停在 `createCheckpoint → E2BSandbox.downloadFile`——即 bub 已经装好、正在下载刚打包的 checkpoint 时超时/连接重置。压 `maxConcurrency` 到 2 无效(曾按「并发扎堆上传」误诊),失败概率与并发数基本无关。本地磁盘缓存里成功生成过的 checkpoint 文件 100~113MB。

## 根因

两层叠加:

1. **checkpoint 打包了不该打的东西**:`checkpointPaths` 曾是 `[~/.local, ~/.cache/uv]`。`~/.cache/uv` 是 uv 的 wheel/构建缓存,只在「下一次安装」有用;而 restore 场景 bub 已装好、不会再装,这部分纯属死重,把单次 HTTP 传输撑到 100MB+。bub 因钉 git 分支(`BUB_PINNED`)每沙箱都走真装 + checkpoint,放大了暴露面。
2. **缓存回填失败被当成 attempt 失败**:`ensureBub` 里 install 成功后 `createCheckpoint` 一抛就把整个 attempt 打死——但那只是给后续沙箱的缓存回填,本沙箱的 bub 已经可用。

## 修法

修在 `src/agents/bub.ts`(2026-07-11):

1. `CHECKPOINT_SUBDIRS = [".local"]`——uv 装的 python 工具链、bub tool venv、bin shim 全在 `~/.local`,restore 后即可运行;`~/.cache/uv` 不再打包,体积大约砍半。子目录列表并入 `INSTALL_SPEC` 参与 `INSTALL_HASH`,所以改动自动换缓存文件名,不会继续复用老的大 checkpoint(不用手动清 `~/.cache/niceeval/bub-checkpoint-*.bin`)。
2. `createCheckpoint` 失败降级为 `console.error` 警告(i18n `bub.checkpointCaptureFailed`),attempt 继续跑;waiter 看到 `memCheckpoints` 为空会走自己的安装路径,代价是慢、不是 error。
3. mem 命中的 `restoreCheckpoint` 失败同样不终结 attempt(`bub.checkpointRestoreFailed`),往下落到 disk 恢复 → 全量安装。

适用场景:任何沙箱 provider 的文件 API 对大 buffer 一次性传输都可能瞬态失败;缓存类操作(回填/恢复)一律降级,不让缓存失败升格为任务失败。

## 待复盘

- 剩余体积(`~/.local` 含 uv 管理的 CPython 3.12,压缩后仍有几十 MB)如果继续出问题,下一步是 checkpoint.ts 里对 download/upload 做分块或重试,或模板里预烘焙 python 工具链。
- 上游退役 `BUB_OVERRIDE` fork(tool-call 丢文本修复进上游)后 `BUB_PINNED` 变 false,预制模板捷径恢复,checkpoint 路径的暴露面会大幅缩小,见 [[bub-tapestore-otel-tapeentry-drift]]。
