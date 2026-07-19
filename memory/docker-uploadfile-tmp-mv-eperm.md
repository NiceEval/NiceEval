---
name: docker-uploadfile-tmp-mv-eperm
description: "Docker sandbox 的 uploadFile() 不 chown 上传文件，随后对它的 mv/rm 类操作只要落在 sticky-bit 目录（如 /tmp）就会 EPERM——claude-code 的 settingsFile 真机 e2e 首跑发现"
metadata:
  type: infra-bug
---

**现象**：`e2e/repos/claude-code` 的 `websearch-denied` Eval（挂了 `settingsFile:
"configs/claude-code/no-web.json"` 的 claude-code agent）真机跑 Docker 沙箱时,
`agent.setup` 阶段 100% 复现 `errored`：

```
Could not upload native config file "configs/claude-code/no-web.json" into the sandbox (~/.claude/settings.json):
mv: cannot move '/tmp/niceeval-native-config-mrqamkdy-6bw8my' to '/home/node/.claude/settings.json': Operation not permitted
```

单测(`FakeSandbox`)从未复现——`settingsFile`/`configFile` 这条安装路径此前只有 mock 沙箱覆盖,
没有真实 Docker 容器跑过。

**根因**：`src/agents/native-config.ts` 的 `uploadNativeConfigFile()` 先 `sb.uploadFile(tmp,
bytes)` 把内容写到容器内 `/tmp/niceeval-native-config-*`,再用非 root 身份 `mv` 到目标路径。
`src/sandbox/docker.ts` 的 `uploadFile()` 用 `putArchive` 以 **root** 身份解包写入,但
（与同文件的 `uploadFiles()` 不同）从未调用 `chownToSandboxUser()` 把属主改回沙箱的非 root 用户
（`node`,uid 1000）。于是这个临时文件在容器里保持 root 属主。Linux 对 sticky-bit 目录
（`/tmp` 默认 `drwxrwxrwt`）的语义是:即使目录本身对所有人可写,**只有文件属主或 root 能
`rename`/`unlink` 该目录下的项**——非 root 沙箱用户对着一个 root 拥有的文件跑 `mv`,内核直接拒成
`EPERM`,与目标路径 `~/.claude/settings.json` 所在目录的权限无关（这也是为什么报错字面是
"cannot move ... Operation not permitted",不是 "No such file or directory" 或写目标的权限错）。

`appendNativeConfigFile()`(codex 的 `configFile` 用这条路径)调用同一个 `uploadFile()`,
同样受影响,只是 codex 的 e2e 尚未在这次任务前真机跑过这条路径,没有独立复现记录。

**修法**：`src/sandbox/docker.ts` 的 `uploadFile()` 在 `putArchive` 之后补一次
`await this.chownToSandboxUser(absPath)`(chown 精确到这一个文件,不像 `uploadFiles()`
那样对整个目标目录递归——没必要牵连 `/tmp` 下其它无关文件)。E2B / Vercel 的 `uploadFile()`
走各自 SDK 原生的 `files.write`,不经过「root 写入再 chown」这道工序,不受此限,不需要同等修复。

**适用场景**：任何经 `Sandbox.uploadFile()`(而非 `uploadFiles()`/`writeFiles()`)写入 Docker
沙箱**任意路径**(尤其容器内 `/tmp` 这类 sticky-bit 目录)、随后又要对该文件做
`mv`/`rm`/`cp --preserve` 等改动目录项操作的场景——`native-config.ts` 的
`settingsFile`/`configFile` 机制是目前唯一的调用方,claude-code 与 codex 两个 adapter 共用。
真机复现见本条目开头的错误文本(本机 Docker/OrbStack,claude CLI 2.1.214 镜像)。
