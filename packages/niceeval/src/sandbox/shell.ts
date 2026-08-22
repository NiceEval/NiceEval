// shell 拼接工具:单引号转义与 find 脚本构造,docker / vercel / e2b / checkpoint 共用。

/** 单引号包裹 + 转义,把一个参数安全嵌进 shell 命令串。 */
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/**
 * 构造 downloadDirectory 用的 find 脚本:按 basename(任意深度、不区分文件/目录)排除——
 * 命中即整支剪除,不再输出该路径,匹配的目录也不再向下递归;其余全部文件按 `./` 前缀之外
 * 的相对路径输出。与 uploadDirectory 侧 collectLocalFiles 的 ignore 语义一致。ignore 可能
 * 来自 eval 作者输入,一律走 shellQuote 转义后再拼进脚本,防止特殊字符破坏脚本结构。
 */
export function buildDownloadFindScript(opts: { ignore: readonly string[] }): string {
  if (opts.ignore.length === 0) return "find . -type f -print";
  const namePrune = opts.ignore.map((name) => `-name ${shellQuote(name)}`).join(" -o ");
  return `find . \\( ${namePrune} \\) -prune -o -type f -print`;
}
