# Hermes 是「secret 不落盘」的唯一例外

裁决日期 2026-07-26。

## 现象

`docs/feature/adapters/sdk/hermes/README.md` 同一篇里两套答案:接入字段段说
「secret 写进 `~/.hermes/.env`」,驱动面段末尾又留着「secret 走环境变量,
不写进配置文件」。后一句是建页时(`a2fd0e36`)从姊妹 Agent 页抄来的跨适配器不变量,
`0d0a3e46` 补落盘时没回头改。

代码比两句都更宽:`src/agents/hermes.ts` 的 setup 在写了 `baseUrl` 时,把 key
同时写进 `~/.hermes/config.yaml` 的 `custom_providers[].api_key` 和
`~/.hermes/.env` 两个文件。

## 根因

上游 `hermes-agent` 0.19.0 的自定义 provider 鉴权解析
(`hermes_cli/runtime_provider.py`)对进程环境是 **host-gated**:只有 `base_url`
命中 `openai.com` / `openrouter.ai` 这类可识别 host,才会取进程里的
`OPENAI_API_KEY` / `OPENROUTER_API_KEY`;其余候选是 inline `api_key`、
`key_env` 指名的变量、以及按 host 派生的 `<VENDOR>_API_KEY`。通用 OpenAI 兼容网关
一条都不命中,所以 `send()` 每次注入的那组环境变量不足以鉴权。CLI 启动时
`load_hermes_dotenv()` 把 `~/.hermes/.env` 读进 `os.environ`——落盘是上游自己的
凭据面,不是 NiceEval 发明的绕法。

## 修法

docs 侧承认例外,不改代码:Hermes 页写清落盘的是哪两个文件、为什么必须落盘、
两个文件随沙箱销毁且不进 manifest;`docs/feature/adapters/library/coding-agent-extensions.md`
的不变量句开一个具名口子指过来。

## 没走的那条路

上游推荐 `custom_providers[].key_env: <VAR>`,运行时用 `_getenv` 读进程环境,
能做到 config.yaml 不含明文、也不需要 `.env`。没有采纳:Adapter 现在传的是裸
`--provider custom`,而 bare-custom + explicit base_url 分支
(`runtime_provider.py` 约 947 行)根本不查 `key_env`——要改得连
`--provider custom:<name>` 一起动,且只能在带 Docker 与真网关 key 的 e2e 里验。
后续真要收掉明文,从这条线起手。
