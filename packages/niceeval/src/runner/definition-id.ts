import { childNodes, syntaxNode, type SyntaxNode } from "./source-normalization.ts";

export class DeclaredIdError extends Error {
  readonly start: number;
  readonly end: number;
  constructor(message: string, start: number, end: number) {
    super(message);
    this.start = start;
    this.end = end;
    this.name = "DeclaredIdError";
  }
}

const nameOf = (node: unknown): string | undefined =>
  syntaxNode(node) && (node.type === "Identifier" || node.type === "Literal")
    ? typeof node.name === "string"
      ? node.name
      : typeof node.value === "string"
        ? node.value
        : undefined
    : undefined;

function bindsId(node: unknown): boolean {
  if (!syntaxNode(node)) return false;
  if (node.type === "Identifier") return node.name === "id";
  if (node.type === "Property") return bindsId(node.value);
  if (node.type === "AssignmentPattern") return bindsId(node.left);
  return childNodes(node).some(bindsId);
}

/**
 * Reads an independent top-level `export const id = "…"` without evaluating
 * the entry. The returned range covers the entire export declaration, so an
 * identity projection can remove only this metadata statement. Unsupported
 * declarations throw an error with UTF-16 source offsets.
 */
// @concord-code
// @concord-implements docs/feature/eval/library/README.md#定义入口的-id
export function parseDeclaredId(program: SyntaxNode): { id: string; start: number; end: number } | undefined {
  let declared: { id: string; start: number; end: number } | undefined;
  const reject = (node: SyntaxNode, message: string): never => {
    throw new DeclaredIdError(message, node.start, node.end);
  };
  for (const statement of Array.isArray(program.body) ? program.body.filter(syntaxNode) : []) {
    if (statement.exportKind === "type") continue;
    if (statement.type === "ExportAllDeclaration") {
      if (statement.exported == null || nameOf(statement.exported) === "id")
        reject(statement, 'Declare id directly with export const id = "…"; re-exported IDs are not supported.');
      continue;
    }
    if (statement.type !== "ExportNamedDeclaration") continue;
    const specs = Array.isArray(statement.specifiers) ? statement.specifiers.filter(syntaxNode) : [];
    if (specs.some((spec) => spec.exportKind !== "type" && nameOf(spec.exported) === "id"))
      reject(statement, 'Declare id directly with export const id = "…"; exported aliases are not supported.');
    const declaration = statement.declaration;
    if (!syntaxNode(declaration)) continue;
    if (declaration.type !== "VariableDeclaration") {
      if (
        nameOf(declaration.id) === "id" &&
        declaration.type !== "TSInterfaceDeclaration" &&
        declaration.type !== "TSTypeAliasDeclaration"
      )
        reject(statement, 'ID must be declared with export const id = "…".');
      continue;
    }
    const bindings = Array.isArray(declaration.declarations) ? declaration.declarations.filter(syntaxNode) : [];
    if (!bindings.some((binding) => bindsId(binding.id))) continue;
    const binding = bindings[0]!;
    const value = binding.init;
    if (
      declaration.kind !== "const" ||
      declaration.declare === true ||
      bindings.length !== 1 ||
      !syntaxNode(binding.id) ||
      binding.id.type !== "Identifier" ||
      binding.id.name !== "id" ||
      !syntaxNode(value) ||
      value.type !== "Literal" ||
      typeof value.value !== "string"
    )
      reject(statement, 'ID must be an independent export const id = "…" statement with a string literal.');
    const id = (value as SyntaxNode).value as string;
    if (
      id.split("/").some((part) => part === "" || part === "." || part === "..") ||
      /[\\\u0000-\u001f\u007f-\u009f]/u.test(id)
    )
      reject(
        statement,
        "ID must contain non-empty slash-separated segments without dot segments, backslashes or control characters.",
      );
    if (declared !== undefined) reject(statement, "ID must be declared exactly once.");
    declared = { id, start: statement.start, end: statement.end };
  }
  return declared;
}
