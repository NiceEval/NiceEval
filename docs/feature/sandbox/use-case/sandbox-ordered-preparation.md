# 按书写顺序准备一个多步 Sandbox

## 用户目标

评估作者要在空白的云 Sandbox 里依次完成几步准备：装工具链、上传项目种子、安装被测版本。
他希望照着写的顺序执行，把长脚本放在独立文件里，并在进度里看到每一步的名字。

## 起始状态

项目已有一个使用云 Sandbox 的 Experiment，`scripts/` 下放着两段准备脚本。
本篇是预期用法，输出均为预期结果。

## 完整路径

1. 把三步写成一条 `.before()` 链。 {#declare}

   ```typescript
   import { instaboxSandbox, shell, uploadDirectory } from "niceeval/sandbox";

   export const sandbox = instaboxSandbox({ templateId: "universal" })
     .before(shell({
       id: "toolchain",
       label: "安装 Node 与 pnpm",
       script: new URL("./scripts/toolchain.sh", import.meta.url),
       user: "root",
     }))
     .before(uploadDirectory({
       id: "seed",
       label: "上传项目种子",
       source: new URL("./seed/", import.meta.url),
       to: "/data/seed",
     }))
     .before(shell({
       id: "candidate",
       label: "安装被测版本",
       script: new URL("./scripts/candidate.sh", import.meta.url),
       env: { CANDIDATE_VERSION: "0.20.0" },
     }));
   ```

   预期结果：三步按书写顺序执行。链上没有 `dependsOn`，也没有为排序而写的 `changeFrequency`。

2. 运行前查看计划。 {#debug}

   ```sh
   niceeval debug <experiment> <eval>
   ```

   预期结果：三步依次列出，后一步的依赖里有前一步，`schedulingReason` 写明来自同一 layer 的书写顺序。
   两个脚本各显示项目相对路径与内容摘要。

3. 运行并观察进度。 {#run}

   ```sh
   niceeval exp <experiment> <eval>
   ```

   预期结果：进度行依次显示“安装 Node 与 pnpm”“上传项目种子”“安装被测版本”，不显示脚本正文。
   第二条 Attempt 从 before 缓存恢复这三步，不再执行脚本。

4. 修改 `scripts/candidate.sh` 后再次运行。 {#edit}

   预期结果：前两步仍从缓存恢复，第三步因脚本内容变化重新执行。作者没有改任何 `id`。

## 结果

准备顺序、缓存失效和进度显示都由声明本身决定，作者不再维护依赖边、排序数字或版本后缀。

| 情形 | 用户看到的结果与下一步 |
|---|---|
| `script` 指向的文件不存在 | planning 失败并写出路径；不创建 Sandbox |
| 同时给了 `command` 与 `script` | planning 失败，指出二选一 |
| 需要让另一个 owner 的步骤排在某一步之前 | 在那一步上写 `dependsOn`，或给两边声明 capability |

## 相关契约

- [Sandbox Layer](../library/layers.md#顺序与依赖方向)：链的书写顺序与跨 owner 排序。
- [内置 before action](../library/prepare-commands.md#脚本文件与显示名)：`script`、`label` 与进度显示。
- [Before cache](../architecture/before-cache.md)：前缀身份与恢复。
