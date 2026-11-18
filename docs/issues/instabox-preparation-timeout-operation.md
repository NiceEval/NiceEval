# Instabox 准备超时时 show 缺少超时操作

来源为 NiceEval/NiceEval-Eval 的 agent-assisted dogfood，原始 Attempt ID 为 1e871f01-26e1-48dd-9e31-e6c975576345。环境为 Linux x86_64、Instabox，复查环境为 Node v24.22.2、pnpm 11.12.0。外层 CLI 通过本地 link 加载，版本为 0.0.0-development；原运行的构建 SHA 未核验。

在保有该 Record 的项目中执行以下公开命令可复查现象：

```sh
pnpm exec niceeval show @14X87ZM3AJPCJ execution --json
pnpm exec niceeval show @14X87ZM3AJPCJ diagnostic_000000hs8h0qk27spbx1d9ex1c --json
pnpm exec niceeval show @14X87ZM3AJPCJ timing --json
```

Attempt 结果为 errored。完整 diagnostic 只给出 attempt.before / unexpected-error 和 “The operation was aborted due to timeout”。没有 cause，没有命令或对话记录。唯一 timing 为 sandbox.create，耗时 46844 ms，outcome 为 completed。凭这些信息无法判断哪一个沙箱操作超时，也无法选择应调查的 provider 操作。对这份已发布记录的读取可重复；触发最初超时的环境条件尚未复现。

期望在已知时提供发生超时的沙箱操作、阶段或可关联的请求信息；信息缺失时，在公开诊断中标明缺失范围。原始超时的责任方待查。

<!-- niceeval.issue-origin/v1
origin-key: github.com/niceeval/niceeval-eval#1e871f01-26e1-48dd-9e31-e6c975576345
payload-sha256: cfa3cf721faf59b60fc0e64f89e491097f179c097114e1034e432c7bf22a296e
-->
