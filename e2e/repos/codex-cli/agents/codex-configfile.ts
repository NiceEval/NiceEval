// configFile 实验专用:同一个 codex adapter,叠加一份真实 Codex config.toml
// (configs/no-web-search.toml,`web_search = "disabled"`)。Adapter 从本地读取原始字节、
// 校验保留键、上传到隔离的 Codex 配置目录,原样并入 Sandbox 里本为空的用户级
// ~/.codex/config.toml——不解析后重写、不继承宿主机配置。
import { codexAgent } from "niceeval/adapter";

export default codexAgent({
  apiKey: process.env.CODEX_API_KEY,
  baseUrl: process.env.CODEX_BASE_URL,
  configFile: "configs/no-web-search.toml",
});
