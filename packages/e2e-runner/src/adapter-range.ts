import { createHash } from "node:crypto";
import ts from "typescript";
import type { RangeSchema } from "./adapter-wire.ts";

// Source parsing only completes a position observed by the native collector.
// It never invents a test, title, Concord ID, or a position from a title match.
export function nativeDeclarationRange(file: string, source: string, location: { readonly line: number; readonly column: number }): typeof RangeSchema.Type | undefined {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const starts = tree.getLineStarts();
  const lineStart = starts[location.line - 1];
  if (lineStart === undefined || location.column < 1) return undefined;
  const position = lineStart + location.column - 1;
  if (position >= (starts[location.line] ?? source.length)) return undefined;
  const rootName = (expression: ts.Expression): string | undefined => {
    if (ts.isIdentifier(expression)) return expression.text;
    if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) return rootName(expression.expression);
    if (ts.isCallExpression(expression) || ts.isParenthesizedExpression(expression)) return rootName(expression.expression);
    return undefined;
  };
  const matches: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ["test", "it"].includes(rootName(node.expression) ?? "")) {
      const callback = node.arguments.find(argument => ts.isArrowFunction(argument) || ts.isFunctionExpression(argument));
      // A collector's stack points at the registration header, never its body.
      if (callback && position >= node.getStart(tree) && position < callback.getStart(tree)) matches.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  if (matches.length !== 1) return undefined;
  const node = matches[0]!;
  return {
    startLine: tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1,
    endLine: tree.getLineAndCharacterOfPosition(node.getEnd() - 1).line + 1,
    sourceDigest: `sha256:${createHash("sha256").update(source).digest("hex")}`,
  };
}
