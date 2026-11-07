# `pnpm run docs:dev` / `docs:validate` fails with npm permission or ENOTEMPTY errors — clear the npx cache dir, don't touch the scripts

**现象**：`docs:dev` 报 `npm error code ENOTEMPTY ... rename ... @mintlify/cli -> @mintlify/.cli-xxxx`；`docs:validate` 报 `sh: .../node_modules/.bin/mint: Permission denied`。两者都指向同一个目录 `~/.npm/_npx/<hash>/node_modules/@mintlify/cli`。

**根因**：这三个 `docs:*` script（见 `package.json`）都是 `npx --yes mint@latest ...`，每次执行 npx 都会尝试用新版本原地更新那个固定 hash 目录下的缓存包。一旦某次更新中途被打断（例如上次运行被杀掉、或沙箱环境限制了执行位），缓存目录会留下没有 `+x` 权限的文件，或者半更新状态的目录树——下次 npx 想 rename 覆盖时因为目标非空而失败(ENOTEMPTY),或者直接因为 `.bin/mint` 没执行权限而 permission denied。这不是代码或 script 配置的问题,是本地 npx 缓存損坏。

**修法**：`rm -rf ~/.npm/_npx/<hash对应目录>`(从报错信息里的路径抠出这个目录,通常是 `~/.npm/_npx/45ad5ad5343d10be` 这种),让 npx 下次重新完整安装一份干净的 `mint@latest`。不要去改 `docs:dev` / `docs:validate` / `docs:links` 这三个 script 本身——它们的 `npx --yes mint@latest` 写法没问题,坏的是本地缓存。清完缓存后三个命令都能正常跑(`docs:validate` → `success build validation passed`;`docs:links` → `success no broken links found`;`docs:dev` 起本地预览服务器,端口被占用会自动挪到 3001)。
