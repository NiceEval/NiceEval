import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  useBlocker,
  useNavigate,
  type Blocker,
  type BlockerFunction,
  type Location,
} from "react-router-dom";

interface NavigationIntent {
  readonly sequence: number;
  readonly source: "fallback" | "user";
  readonly location: Location;
}

export interface RefreshNavigationLock {
  hasUserIntent(): boolean;
  enqueueFallback(route: string): Promise<void>;
  release(): Promise<NavigationIntent["source"] | undefined>;
  recover(): void;
}

export type AcquireRefreshNavigationLock = (signal: AbortSignal) => Promise<RefreshNavigationLock>;

interface LockSession {
  readonly signal: AbortSignal;
  active: boolean;
  latestIntent?: NavigationIntent;
  release?: Promise<NavigationIntent["source"] | undefined>;
  removeAbortListener: () => void;
}

interface PendingInstall {
  readonly session: LockSession;
  readonly resolve: (lock: RefreshNavigationLock) => void;
  readonly reject: (cause: unknown) => void;
}

interface IntentWaiter {
  readonly session: LockSession;
  readonly intent: NavigationIntent;
  readonly resolve: (blocker: Extract<Blocker, { readonly state: "blocked" }> | undefined) => void;
  readonly reject: (cause: unknown) => void;
}

interface ReleaseWaiter {
  readonly session: LockSession;
  readonly resolve: () => void;
  readonly reject: (cause: unknown) => void;
}

const InteractionLockedContext = createContext(false);

export function RefreshInteractionProvider({ locked, children }: {
  readonly locked: boolean;
  readonly children: ReactNode;
}) {
  return <InteractionLockedContext.Provider value={locked}>{children}</InteractionLockedContext.Provider>;
}

export function useRefreshInteractionLocked(): boolean {
  return useContext(InteractionLockedContext);
}

export function useRefreshNavigationLock(): {
  readonly acquire: AcquireRefreshNavigationLock;
  readonly interactionLocked: boolean;
  readonly recoveryRequired: boolean;
} {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<"idle" | "locked" | "recovery">("idle");
  const ownerActive = useRef(true);
  const sequence = useRef(0);
  const enqueueingFallback = useRef(false);
  const sessionRef = useRef<LockSession | undefined>(undefined);
  const pendingInstall = useRef<PendingInstall | undefined>(undefined);
  const intentWaiters = useRef<IntentWaiter[]>([]);
  const releaseWaiters = useRef<ReleaseWaiter[]>([]);
  const blocking = phase !== "idle";
  const shouldBlock = useCallback<BlockerFunction>(({ nextLocation }) => {
    const session = sessionRef.current;
    if (!blocking || session === undefined || !session.active || session.signal.aborted || !ownerActive.current) {
      return false;
    }
    const intent = {
      sequence: ++sequence.current,
      source: enqueueingFallback.current ? "fallback" : "user",
      location: nextLocation,
    } as const;
    session.latestIntent = intent;
    const superseded = intentWaiters.current.filter((waiter) =>
      waiter.session === session && waiter.intent.sequence < intent.sequence
    );
    intentWaiters.current = intentWaiters.current.filter((waiter) =>
      waiter.session !== session || waiter.intent.sequence >= intent.sequence
    );
    for (const waiter of superseded) waiter.resolve(undefined);
    return true;
  }, [blocking]);
  const blocker = useBlocker(shouldBlock);
  const blockerRef = useRef(blocker);
  blockerRef.current = blocker;

  const requireLive = useCallback((session: LockSession): void => {
    if (!ownerActive.current || !session.active) {
      throw new Error("View refresh navigation lock owner is no longer active.");
    }
    if (session.signal.aborted) throw session.signal.reason;
  }, []);

  const waitForIntent = useCallback((session: LockSession, intent: NavigationIntent) => {
    requireLive(session);
    const current = blockerRef.current;
    if (blockerMatches(current, intent)) return Promise.resolve(current);
    return new Promise<Extract<Blocker, { readonly state: "blocked" }> | undefined>((resolve, reject) => {
      intentWaiters.current.push({ session, intent, resolve, reject });
    });
  }, [requireLive]);

  const waitForRelease = useCallback((session: LockSession) => {
    requireLive(session);
    if (blockerRef.current.state === "unblocked") return Promise.resolve();
    return new Promise<void>((resolve, reject) => releaseWaiters.current.push({ session, resolve, reject }));
  }, [requireLive]);

  const abortSession = useCallback((session: LockSession, cause: unknown) => {
    if (!session.active) return;
    session.active = false;
    session.removeAbortListener();
    if (sessionRef.current === session) sessionRef.current = undefined;
    const pending = pendingInstall.current;
    if (pending?.session === session) {
      pendingInstall.current = undefined;
      pending.reject(cause);
    }
    const rejectedIntentWaiters = intentWaiters.current.filter((waiter) => waiter.session === session);
    intentWaiters.current = intentWaiters.current.filter((waiter) => waiter.session !== session);
    for (const waiter of rejectedIntentWaiters) waiter.reject(cause);
    const rejectedReleaseWaiters = releaseWaiters.current.filter((waiter) => waiter.session === session);
    releaseWaiters.current = releaseWaiters.current.filter((waiter) => waiter.session !== session);
    for (const waiter of rejectedReleaseWaiters) waiter.reject(cause);
  }, []);

  const acquire = useCallback<AcquireRefreshNavigationLock>((signal) => {
    if (signal.aborted) return Promise.reject(signal.reason);
    if (!ownerActive.current || pendingInstall.current !== undefined || sessionRef.current !== undefined || phase !== "idle") {
      return Promise.reject(new Error("A View refresh navigation lock is already active."));
    }
    let session: LockSession;
    const abort = () => abortSession(session, signal.reason);
    session = {
      signal,
      active: true,
      removeAbortListener: () => signal.removeEventListener("abort", abort),
    };
    sessionRef.current = session;
    signal.addEventListener("abort", abort, { once: true });
    setPhase("locked");
    return new Promise((resolve, reject) => {
      pendingInstall.current = { session, resolve, reject };
    });
  }, [abortSession, phase]);

  const lockRef = useRef<RefreshNavigationLock | undefined>(undefined);
  if (lockRef.current === undefined) {
    lockRef.current = {
      hasUserIntent: () => sessionRef.current?.latestIntent?.source === "user",
      enqueueFallback: async (route) => {
        const session = sessionRef.current;
        if (session === undefined) throw new Error("View refresh navigation lock is not active.");
        requireLive(session);
        if (session.latestIntent?.source === "user") return;
        enqueueingFallback.current = true;
        try {
          await navigate(route, { replace: true, state: null });
        } finally {
          enqueueingFallback.current = false;
        }
        const intent = session.latestIntent;
        if (intent === undefined) throw new Error("View refresh fallback navigation was not blocked.");
        requireLive(session);
      },
      release: async () => {
        const session = sessionRef.current;
        if (session === undefined) throw new Error("View refresh navigation lock is not active.");
        if (session.release !== undefined) return session.release;
        session.release = (async () => {
          requireLive(session);
          let proceeded: NavigationIntent["source"] | undefined;
          while (session.latestIntent !== undefined) {
            const intent = session.latestIntent;
            const matched = await waitForIntent(session, intent);
            requireLive(session);
            if (session.latestIntent?.sequence !== intent.sequence) continue;
            const current = blockerRef.current;
            if (matched === undefined || !blockerMatches(current, intent) || current !== matched) continue;
            proceeded = intent.source;
            current.proceed();
            break;
          }
          requireLive(session);
          await waitForRelease(session);
          requireLive(session);
          setPhase("idle");
          session.active = false;
          session.removeAbortListener();
          if (sessionRef.current === session) sessionRef.current = undefined;
          return proceeded;
        })();
        return session.release;
      },
      recover: () => {
        const session = sessionRef.current;
        if (session === undefined) throw new Error("View refresh navigation lock is not active.");
        requireLive(session);
        setPhase("recovery");
      },
    };
  }

  useEffect(() => {
    if (phase !== "locked" || pendingInstall.current === undefined) return;
    const pending = pendingInstall.current;
    requireLive(pending.session);
    pendingInstall.current = undefined;
    pending.resolve(lockRef.current!);
  }, [phase, requireLive, shouldBlock]);

  useEffect(() => {
    if (blocker.state !== "blocked") return;
    const matched = intentWaiters.current.filter((waiter) => blockerMatches(blocker, waiter.intent));
    intentWaiters.current = intentWaiters.current.filter((waiter) => !blockerMatches(blocker, waiter.intent));
    for (const waiter of matched) {
      try {
        requireLive(waiter.session);
        waiter.resolve(blocker);
      } catch (cause) {
        waiter.reject(cause);
      }
    }
  }, [blocker, requireLive]);

  useEffect(() => {
    if (blocker.state !== "unblocked") return;
    const waiters = releaseWaiters.current.splice(0);
    for (const waiter of waiters) {
      try {
        requireLive(waiter.session);
        waiter.resolve();
      } catch (cause) {
        waiter.reject(cause);
      }
    }
  }, [blocker, requireLive]);

  useEffect(() => {
    ownerActive.current = true;
    return () => {
      ownerActive.current = false;
      const session = sessionRef.current;
      if (session !== undefined) abortSession(session, new Error("View refresh navigation lock owner was unmounted."));
    };
  }, [abortSession]);

  return {
    acquire,
    interactionLocked: blocking,
    recoveryRequired: phase === "recovery",
  };
}

function blockerMatches(
  blocker: Blocker,
  intent: NavigationIntent,
): blocker is Extract<Blocker, { readonly state: "blocked" }> {
  return blocker.state === "blocked" &&
    blocker.location === intent.location &&
    sameLocation(blocker.location, intent.location);
}

function sameLocation(left: Location, right: Location): boolean {
  return left.key === right.key &&
    left.pathname === right.pathname &&
    left.search === right.search &&
    left.hash === right.hash;
}
