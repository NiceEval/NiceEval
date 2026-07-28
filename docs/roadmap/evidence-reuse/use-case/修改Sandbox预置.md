# 修改 Sandbox 预置

## 系统能观察到什么

声明式 recipe、文件 digest、解析后的 immutable image/template ID 与绑定角色进入 manifest：

```typescript
sandbox: e2bSandbox({ template: "niceeval-agents" })
  .recipe([
    {
      run: {
        command: "npm",
        args: ["install", "--global", "some-cli@2.1.0"],
      },
    },
  ]);
```

把 `some-cli@2.1.0` 改成 `@3.0.0`，或 image 内容 ID 变化，是 observed Sandbox delta。
两套默认政策都重跑相关 Eval。

## 同一 URL 的冲突

recipe 或 Hook 里的下载 URL 可能只是镜像代理，也可能决定实际内容：

| 场景 | 应声明的身份 | 默认 |
|---|---|---|
| 换 npm mirror，但 lockfile 与包内容相同 | connection + lockfile/package digest | 沿用 |
| `CLI_URL` 改为另一个二进制版本 | condition 或下载产物 digest | 重跑 |
| signed URL 每次变化，内容 digest 相同 | secret/connection + artifact digest | 沿用 |
| URL 变化且无法验证下载内容 | opaque Sandbox | 证明优先重跑；复用优先沿用并标 unverified |

## 任意 Hook

`.setup(fn)` 仍可使用，但 `Function#toString()` 不能恢复闭包值、动态读取和远端内容。
没有 recipe、artifact digest 或 resource identity 时，相关 Requirement 为 opaque。

用户可以对当前计划覆盖：

```bash
# 证明优先：确认这次 Hook 未改变起步环境
niceeval exp compare/codex --accept opaque:sandbox.setup

# 复用优先：确认外部安装源已经变化
niceeval exp compare/codex --rerun sandbox:setup
```

频繁使用覆盖表示 Hook 应改造成声明式 recipe，或为产物补稳定身份。

## 精确接受已观察到的变化

镜像只是重新打包、内容语义等价时，用户可以接受当前 Sandbox delta：

```bash
niceeval exp compare/codex --accept sandbox:image
```

框架允许这项授权，但必须显示受影响 Eval 数量、旧新内容 ID 与风险说明。
未来再出现新的 image ID 时需要重新授权，不存在永久 image-name ignore。
