import * as Sentry from "@sentry/nextjs";
import { productionEnabled, SITE_SENTRY_DSN, installEnvelopePrivacy, sentryOptions } from "./lib/sentry";

if (productionEnabled(process.env.NODE_ENV, process.env.NEXT_PUBLIC_VERCEL_ENV) && !Sentry.getClient()) {
  try {
    Sentry.init({
      ...sentryOptions(
        SITE_SENTRY_DSN,
        process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
        process.env.NEXT_PUBLIC_SENTRY_RELEASE,
      ),
      integrations: (defaults) =>
        defaults.filter((integration) => !["BrowserSession", "Breadcrumbs"].includes(integration.name)),
      tracePropagationTargets: [
        /^\/api(?:\/|$)/,
        new RegExp(`^${window.location.origin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/api(?:/|$)`),
      ],
    });
    installEnvelopePrivacy(
      Sentry.getClient(),
      process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
      process.env.NEXT_PUBLIC_SENTRY_RELEASE,
    );
  } catch {
    /* Monitoring must not prevent hydration. */
  }
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
