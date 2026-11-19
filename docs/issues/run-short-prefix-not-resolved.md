# show cannot resolve the short Run prefix that invocation prints

## 观察

`niceeval invocation list` 与 `invocation show` 以 `@run:edacf85d` 的短前缀显示 Run，但 `niceeval show run:edacf85d` 报 `Run edacf85d was not found`，必须使用完整 UUID。

## 期望

CLI 显示的 Run 标识都能原样作为 `show` / `view` 的输入；短前缀唯一时解析为对应 Run，不唯一时报歧义并列出候选。
