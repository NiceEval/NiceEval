# 检查工作目录外状态：利用原生命令核对全局变更

## 解决什么问题

评测框架的常规采集通常只关注评测工作区（`workdir`）内的文件变动。如果被测 Agent 在工作区之外改动了系统全局配置（例如往 `$HOME` 注入了隐秘配置、全局安装了未声明的工具包、篡改了系统全局 `PATH` 或遗留了后台常驻守护进程），评测用例虽然通过，但可能依赖了这类非预期的越界行为。

当评测通过或异常但需要审计系统全局状态时，开发者可以通过留存现场并使用底层 Provider 的原生 CLI 连入容器，运用标准的 Linux / Git 工具直接排查工作区内外的全部变动。

## 全流程

1. 启动评测并指定保留现场（包括通过的 Attempt）：

   ```bash
   niceeval exp local onboarding/tool-first --keep-sandbox=all
   ```

2. 运行结束后，收尾面板输出实例信息与原生直连命令：

   ```text
   ╭─ KEPT SANDBOXES ─────────────────────────────────────────────────── 1 kept ─╮
   │ @1VE05BR7061YN  onboarding/tool-first #1  passed  docker · a3f9c2d1          │
   │            debug: docker exec -it a3f9c2d1 /bin/bash                       │
   │            clean: docker rm -f a3f9c2d1                                    │
   ╰────────────────────────────────────────────────────────────────────────────╯
   ```

3. 使用底层 Provider 的原生 CLI 连入沙箱：

   ```bash
   docker exec -it a3f9c2d1 /bin/bash
   ```

4. 在沙箱现场内使用标准系统工具检查工作目录之外的状态：

   ```bash
   # 1. 检查用户主目录是否被写入配置
   ls -la ~ && cat ~/.npmrc 2>/dev/null

   # 2. 检查是否有未声明的全局 npm/pip 包被安装
   npm ls -g --depth=0
   pip list

   # 3. 检查全局环境变量与 PATH 劫持
   echo $PATH && which -a node

   # 4. 检查是否遗留未经管制的后台进程
   ps aux | grep -v grep
   ```

5. 在工作目录内直接利用 Git 原生机制核对代码改动：

   ```bash
   cd /workspace
   git status
   git diff
   ```

6. 审计完成后，使用底层命令销毁现场：

   ```bash
   docker rm -f a3f9c2d1
   ```

   如果是云端 Instabox 沙箱，直接使用 `instabox rm niceeval-97511d9a`。

## 边界

- 现场保留了收尾后的真实状态，适合做越界行为的事后安全审计。
- 工作区内的规范化变更应以已落盘的运行事实（`niceeval show attempt.sources` 或 `niceeval view`）为准；现场直接使用原生 `git diff` 可提供细粒度的补丁排查。
- 留存的容器由底层 Provider 原生管理，审计完毕后使用 `docker rm` 或 `instabox rm` 及时释放。

## 相关阅读

- [Sandbox CLI](../cli.md) —— 原生 CLI 现场接入与资源管理。
- [在现场反复验证假设](sandbox-retain-validate-scene.md) —— 调试定位与假设检验。
