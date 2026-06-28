// 小工具。

/** 读必需的环境变量,缺了就清晰报错(agent 鉴权用)。 */
export function requireEnv(name: string): string {
  const v = process.env[name];
  if (v === undefined || v === "") {
    throw new Error(`缺少必需的环境变量 ${name}(请在 .env 里配置)。`);
  }
  return v;
}

/** 取环境变量,缺了返回 undefined。 */
export function getEnv(name: string): string | undefined {
  const v = process.env[name];
  return v === undefined || v === "" ? undefined : v;
}

/** 零填充到 4 位(数据集扇出的 id:sql/0000)。 */
export function pad4(n: number): string {
  return String(n).padStart(4, "0");
}

/** 把任意值安全地转成简短字符串(报告 / 日志用)。 */
export function brief(value: unknown, max = 200): string {
  let s: string;
  try {
    s = typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    s = String(value);
  }
  if (s.length > max) return s.slice(0, max) + "…";
  return s;
}
