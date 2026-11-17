import * as Sentry from "@sentry/nextjs";
import { loadNodeProfiling } from "./lib/sentry-node";
import {
  privacyTransport,
  installEnvelopePrivacy,
  sentryOptions,
  productionEnabled,
  SITE_SENTRY_DSN,
} from "./lib/sentry";

if (productionEnabled(process.env.NODE_ENV, process.env.VERCEL_ENV) && !Sentry.getClient()) {
  try {
    const { policy, integrations } = await loadNodeProfiling(process.env.SENTRY_RELEASE || "");
    Sentry.init({
      ...sentryOptions(SITE_SENTRY_DSN, process.env.SENTRY_ENVIRONMENT, process.env.SENTRY_RELEASE, policy),
      profileLifecycle: "trace",
      profileSessionSampleRate: 1,
      integrations,
      transport: privacyTransport(
        Sentry.makeNodeTransport,
        SITE_SENTRY_DSN,
        process.env.SENTRY_ENVIRONMENT,
        process.env.SENTRY_RELEASE,
        policy,
      ),
    });
    installEnvelopePrivacy(Sentry.getClient(), process.env.SENTRY_ENVIRONMENT, process.env.SENTRY_RELEASE, policy);
    Sentry.logger.info("service.started");
    if (!policy.enabled) Sentry.logger.warn("operation.degraded");
  } catch {
    /* Monitoring must not prevent serving requests. */
  }
}
