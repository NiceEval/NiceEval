# `AttemptDetails` 默认装配

`AttemptDetails` 接收已经生成的 `AttemptDetailsData`，并按 [公开顺序](README.md#默认内容)组合官方投影与原语。
自定义顺序只改 page instance 的 `render(data)`；不能新增读取、Projector 或 Store 访问。
