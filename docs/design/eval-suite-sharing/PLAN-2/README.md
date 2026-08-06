# PLAN-2：NiceEval registry + `eval.lock`

**相关文档**：[README](../README.md) · [GOALS](../GOALS.md) · [LIMITS](../LIMITS.md) · [CASES](../CASES.md) · [DECISION](../DECISION.md)

## 形状

NiceEval 托管自己的 Suite registry。
发布方上传 Eval 源码与资产归档，消费方用专用命令添加 Suite，并把解析结果写进 `eval.lock`。

```sh
niceeval suite add niceeval/terminal-bench@2.1
niceeval suite sync --frozen
niceeval exp codex terminal-bench/
```

```json
{
  "version": 1,
  "suites": {
    "terminal-bench": {
      "name": "niceeval/terminal-bench",
      "release": "2.1",
      "digest": "sha256:..."
    }
  }
}
```

registry 归档必须包含可执行 TypeScript、所有本地资产与一份依赖声明。
普通运行只读取 lock 与本地 content cache。

## 优点

- 用户命令最接近 Harbor，一条引用即可下载题集。
- registry 可以浏览 Suite、release、许可证与题目清单。
- 内容 digest 不依赖 Git tag 是否移动。
- cache 可按 digest 跨项目复用。

## 代价

- `eval.lock` 只能锁 Suite 归档，不能独立安装它 import 的 TypeScript dependencies。
- registry 必须重新实现账号、私有权限、发布、撤回、镜像、限流与供应链策略。
- 项目同时拥有 package lock 与 `eval.lock`；两者对同一 Eval 代码的解释可能分叉。
- Suite import 的 package 由谁安装、NiceEval runtime 由谁提供，没有单一答案。
- 本地 Git Suite、workspace Suite 与 npm Suite 需要三套接入或继续回落到包管理器。

## 对固定 Case 的结果

PLAN-2 可以满足 S2、S3 与来源 digest，但不满足 S1 的发布仓库零改动。
若只保存 Suite 总 digest，S6 会让全套题失效；若逐题建依赖图，registry 又开始复制 NiceEval 指纹系统。

S9 可以在发布时拦截，但 S10 仍需要 JavaScript runtime 归属规则。
它没有消除包管理器，只在包管理器外再增加一条分发链。

## 结论

这个方案适合语言中立任务归档，不适合原生 NiceEval Eval。
未来可以建立只读目录来索引公开 Suite package，但目录不应成为第二个安装器或依赖锁 owner。
