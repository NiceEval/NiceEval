import { registerHooks } from 'node:module';
registerHooks({
  resolve(specifier, context, next) {
    return specifier === 'e2b'
      ? { url: new URL('./sdk.mjs', import.meta.url).href, shortCircuit: true }
      : next(specifier, context);
  },
});
