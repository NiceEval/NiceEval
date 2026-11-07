# Sandbox 身份未 pin 时默认沿用结果

## 裁决

- **裁决**: Docker image 浮动 tag、Dockerfile 未 pin 的 `FROM`、Compose 未 pin 的 image / `FROM`、checkout 浮动 ref 与 opaque custom provider callback 都可以正常执行，并把声明值、BuildKey 或 opaque marker 放进 fingerprint。
- Provider/template 不再以 `Ineligible` / `Blocked` 作为独立 carry gate；旧 `version:3` provider identity 的 top-level `carry` 只保留为 inert serialized marker，保证既有 fingerprint 不因删除 gate 而整体 stale。
- 语义变化若发生在同名外部内容内部而声明没有变化，Runner 无法自动观察；作者必须提升 revision、改变声明，或使用 `--rerun all` 明确重验。
- 终态、fingerprint、`executionMs`/timeout、`--rerun` 与 `--keep-sandbox` 仍是独立且有效的携带门；`passed` 与 `failed` 在这些门通过时都默认沿用。

## 起因与落点

此前 provider physical plan 把未 pin / opaque 身份永久标为 carry-disabled，导致本来已有确定终态的结果每次都重跑。
修法落在 `src/sandbox/layer.ts`、`src/sandbox/link.ts`、`src/sandbox/plan.ts`、`src/runner/fingerprint.ts` 与 `src/runner/accept.ts`；测试覆盖 pinned/floating Docker image、Dockerfile、Compose 与 custom provider 的旧 identity 投影和 passed/failed carry。

不要把本条重新解释成「外部内容会自动触发 stale」：同名 tag、ref 或 callback 语义暗变只能由作者声明 revision 或显式 `--rerun all` 表达。
`docs/design/environment-model/PLAN-9`、`PLAN-10` 与 `docs/design/multi-container-environments/PLAN-4` 中关于 `carryEligible = false` 或禁用携带的候选文字属于已被当前契约替代的历史方案，不得作为实现依据。
