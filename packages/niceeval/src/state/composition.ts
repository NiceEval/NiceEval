import { makeUserStateStoreHost } from "./runtime.ts";
import type { StateServiceModule } from "./types.ts";

/**
 * The application-owned catalog is static: individual services declare only
 * their namespace, schema transitions, fixed operations, and decoders. The
 * Host alone owns database connections, transactions, and SQL authority.
 */
export const firstPartyStateModules: readonly StateServiceModule[] = Object.freeze([]);

export const userStateStoreHost = makeUserStateStoreHost({
  modules: firstPartyStateModules,
});
