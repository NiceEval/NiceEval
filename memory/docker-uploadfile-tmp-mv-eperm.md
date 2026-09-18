---
format: concord.document/v1
id: docker-uploadfile-tmp-mv-eperm
title: docker-uploadfile-tmp-mv-eperm
createdAt: 2026-07-19T08:35:09+08:00
createdAtSource:
  kind: first-recorded
  path: memory/docker-uploadfile-tmp-mv-eperm.md
  commit: 56e51eec8d972972b4f6c74eb82a2a9b2d3e1a5c
description: Docker sandbox 的 uploadFile() 不 chown 上传文件，随后对它的 mv/rm 类操作只要落在
  sticky-bit 目录（如 /tmp）就会 EPERM——claude-code 的 settingsFile 真机 e2e 首跑发现
kind: memory
memoryKind: problem
state: resolved
epoch: 0
promotions: []
history: []
resolution:
  reason: 正文或对应 INDEX 明确使用“已修/已修复”；这是作者声明的事实，不等同于本视图验证证明。
  at: 2026-09-14T15:00:25.173Z
  epoch: 0
  kind: fixed
  evidenceLevel: attested
  attestation:
    statement: "- 已修
      [docker-uploadfile-tmp-mv-eperm](docker-uploadfile-tmp-mv-eperm.md) —
      Docker sandbox 的 `uploadFile()` 不 chown 上传文件(与 `uploadFiles()`
      不同),claude-code `settingsFile` 真机上传到 `/tmp` 后 `mv` 到
      `~/.claude/settings.json` 因 sticky-bit 目录 + root 属主 100% EPERM;修为
      putArchive 后补 `chownToSandboxUser(absPath)`(`src/sandbox/docker.ts`,同路径也影响
      codex 的 `configFile`)"
    proof: []
    source:
      path: memory/INDEX.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:67d7d964587394bf0db4632f93541d005dd00854588493e9c63fa573506473d5
---

**现象**：`e2e/adapter/claude-code` 的 `websearch-denied` Eval（挂了 `settingsFile:
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
