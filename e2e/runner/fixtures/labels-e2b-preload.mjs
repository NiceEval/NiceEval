import { registerHooks } from "node:module";
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "e2b") return { url: new URL("./labels-e2b.cjs", import.meta.url).href, shortCircuit: true };
  return nextResolve(specifier, context);
} });
