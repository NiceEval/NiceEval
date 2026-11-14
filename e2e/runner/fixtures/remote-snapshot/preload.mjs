import { registerHooks } from 'node:module';
import './instabox.mjs';
const modules = { e2b: './sdk.mjs', '@alibaba-group/opensandbox': './opensandbox.mjs', ssh2: './ssh.mjs' };
registerHooks({
  resolve(specifier, context, next) {
    return modules[specifier]
      ? { url: new URL(modules[specifier], import.meta.url).href, shortCircuit: true }
      : next(specifier, context);
  },
});
