# 扩展 Fixture

## 用户目标

维护者要让多个性质复用临时项目或确定性 Agent 的准备步骤，并保持每次运行的资源隔离。

## 起始状态

- 已确定这些测试共用的初始状态，已读[共享资源与同步](../README.md#共享资源与同步)。
- 示例为目标命令，根 `package.json` 入口由实现阶段提供。

## 完整路径

1. 找已有 fixture。 {#reuse}

   从同一 Feature 的测试目录查找临时项目、确定性 Agent 或协议流。一次使用的 fixture 放在使用它的文件中，共用的 fixture 放在消费它的测试旁。

2. 生成最小项目。 {#create}

   每次取得独立临时目录和输入。经公开入口或格式所有者写配置与 Record。确定性 Agent 接受生成的动作并提供指定证据，性质断言留在测试中。

3. 把回收和等待纳入 fixture。 {#release}

   Vitest fixture 在 `use` 完成后执行清理。用 `finally` 覆盖断言失败路径，先关闭拥有的进程与 listener，再移除目录；端口由系统分配。通过真实 ready 信号或公开结果等待完成。

4. 运行使用它的测试。 {#validate}

   在相关 Vitest 文件中运行一次正常路径和可控失败路径，核对临时资源均已释放。交付说明只记录实际运行的文件与回收结果。

## 结果

各性质可以独立准备和释放状态，测试动作与公开断言仍留在原测试中。

## 模型服务

测试通过真实 HTTP 请求访问模型服务时，用 `test/integration/fixtures/model-emulator.ts` 启动 emulate 的 `ai` 服务。把客户端的 `baseUrl` 指向 `startModelEmulator` 返回的本地地址。客户端若要求 API key，传入测试占位值。

在套件的 `beforeAll` 声明匹配模型、工具和请求模式的规则。规则指定工具参数、错误状态或流中断。使用过有限次规则或查询过调用记录时，在下一次独立运行前调用 `reset()`。在 `afterAll` 关闭服务。

检查 OpenRouter 的计费字段或损坏的工具参数时，用 `test/integration/fixtures/inspection-core/judge-http.ts` 返回精确的响应。测私有 `/v1/judge` 协议、损坏的 HTTP 响应或原始连接取消时，保留对应的专用 fixture。
