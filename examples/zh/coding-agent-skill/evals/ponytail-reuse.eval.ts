import { defineEval } from "niceeval";
import { includes, excludes } from "niceeval/expect";

// 改编自 ponytail 的 reuse-slug 质量测试。
//
// 工作区里已有一个 textutils.slugify() 工具函数，能正确处理 Unicode 和重音字母。
// 没有 ponytail skill 的 agent 通常会重新手写 slug 逻辑，遗漏 Unicode 重音处理；
// 有 skill 的 agent 先检查现有工具（"已在 codebase 里？"），发现 textutils.slugify，直接调用。
export default defineEval({
  description: "生成文章 URL slug——应复用现有 textutils.slugify 而非重写",

  async test(t) {
    await t.sandbox.uploadDirectory("../workspaces/ts-starter");

    await t.sandbox.writeFiles({
      "textutils.py": [
        "import unicodedata, re",
        "",
        "def slugify(text: str) -> str:",
        '    """将任意文本转换为 URL 友好的 slug，支持 Unicode 重音字母。"""',
        "    text = unicodedata.normalize('NFKD', text)",
        "    text = text.encode('ascii', 'ignore').decode('ascii')",
        "    text = re.sub(r'[^\\w\\s-]', '', text).strip().lower()",
        "    return re.sub(r'[-\\s]+', '-', text)",
      ].join("\n"),
      "articles.py": [
        "# TODO: implement generate_slug(title: str) -> str",
        "# 提示：项目里可能已有相关工具函数。",
      ].join("\n"),
    });

    await t
      .send(
        "在 articles.py 里实现 generate_slug(title: str) -> str，" +
          "将文章标题转换为 URL slug（小写、连字符分隔、无特殊字符）。",
      )
      .then((turn) => turn.expectOk());

    const src = await t.sandbox.readSourceFiles({ extensions: ["py"] });
    const articles = src.fileMatching(/articles/);

    await t.group("复用了 textutils.slugify 而非重写", () => {
      t.check(articles?.content ?? "", includes(/textutils|from textutils|import.*slugify/));
      t.check(articles?.content ?? "", includes(/slugify\s*\(/));
      // 没有重写 unicodedata / NFKD 逻辑
      t.check(articles?.content ?? "", excludes(/unicodedata|NFKD/));
    });

    await t.group("Unicode 重音处理正确（借力 textutils）", async () => {
      await t.sandbox.writeFiles({
        "_test_slug.py": [
          "import sys",
          "sys.path.insert(0, '.')",
          "from articles import generate_slug",
          "assert generate_slug('Café au Lait') == 'cafe-au-lait', f'got {generate_slug(\"Café au Lait\")}'",
          "assert generate_slug('Hello World!') == 'hello-world', f'got {generate_slug(\"Hello World!\")}'",
          "print('ok')",
        ].join("\n"),
      });
      const result = await t.sandbox.runCommand("python3", ["_test_slug.py"]);
      t.check(result.stdout.trim(), includes(/ok/));
    });

    t.sandbox.fileChanged("articles.py");

    t.judge.autoevals
      .closedQA(
        "是否复用了现有的 textutils.slugify 而非重写？" +
          "是否通过了 Unicode 重音测试（café → cafe）？" +
          "实现是否简洁（理想情况下只需一行）？",
        { on: articles?.content ?? "" },
      )
      .atLeast(0.8);
  },
});
