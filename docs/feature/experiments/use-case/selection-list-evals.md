# 列出已发现的 Eval

场景：你先要确认项目能发现哪些评估用例，或只检查某个 tag 的目录。此时不需要先选择 Experiment，使用
Eval catalog 命令：

```console
$ niceeval list --tag smoke
Discovered 2 evals:
  onboarding/tool-first  — installs the tool before the first request
  onboarding/tool-retry  — retries after a transient tool failure
```

`list` 只发现 Eval 并显示稳定 ID 与描述。它不形成 Experiment 选择、Sandbox link、Invocation、Run 或
Record。没有匹配项时仍完成 discovery，并显示空 catalog。

要检查“哪个 Experiment 会运行这些 Eval”，继续使用 `niceeval exp list`。要验证其中一个 Experiment 与
Sandbox 的选择和 link，使用 `niceeval check <experiment>`；要预览实际 Attempt 计划，使用
`niceeval exp <experiment> --dry`。这三步拥有不同输入和输出，不能用同一个 flag 互相替代。
