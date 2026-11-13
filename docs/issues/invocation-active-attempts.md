# Invocation show expands active Attempts

## 观察与期望

运行期间在另一个终端执行 `niceeval invocation show <id>` 只能看到 Experiment 级 `running` 计数，无法定位已派发、尚未发布的 Attempt 的 Eval、阶段、最近活动与 Sandbox 原生实例。

应按 Run CLI 契约输出 owner 写入的非权威观察值，不据此判断活性或执行接管。缺失实例要明确显示没有。

## 复现与影响

启动一个使用 Docker Sandbox 的长时 Eval，在等待阶段执行上述公开 CLI。作者必须翻运行日志并猜测实例才能排查。回归使用本地 Docker 与受控等待，不调用模型或云资源。

## 身份与来源

NiceEval main，Feature 基线 `2e78812fc`，包 `0.0.0-development`，Linux、Node 24、pnpm 11。来源：NiceEval-Eval dogfood，父 agent 提供并确认。观察已脱敏，不含 secret、私有文件内容或漏洞细节。2026-11-12 搜索全部 open/closed Issues，未发现相同项。
