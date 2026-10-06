// "The intro plays once per session" (R-17) and "reduced motion means a still logo". No React, no three.
// The only use of sessionStorage in the package: one flag, never an appearance setting (the site has one look: ADR-006).

/** The part of Storage that is used. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Gives the storage or nothing; the call itself may throw (a blocked storage throws on access). */
export type StorageSource = () => StorageLike | null | undefined;

export const INTRO_SESSION_KEY = "nivel:logo-intro";

/** `globalThis.sessionStorage`, or `null` where it is missing or blocked (SecurityError in a sandboxed frame). */
export const sessionStorageSource: () => StorageLike | null = () => {
  try {
    return (globalThis as { sessionStorage?: StorageLike }).sessionStorage ?? null;
  } catch {
    return null;
  }
};

export interface IntroSession {
  hasPlayed(): boolean;
  markPlayed(): void;
}

/**
 * The flag lives in sessionStorage; every access is in try/catch. When the storage is blocked, missing or full, the
 * flag lives in memory of this object: the intro still plays once per page life and nothing throws.
 */
export function createIntroSession(source: StorageSource = sessionStorageSource): IntroSession {
  let inMemory = false;
  const storage = (): StorageLike | null => {
    try {
      return source() ?? null;
    } catch {
      return null;
    }
  };
  return {
    hasPlayed() {
      if (inMemory) return true;
      try {
        return storage()?.getItem(INTRO_SESSION_KEY) === "1";
      } catch {
        return false;
      }
    },
    markPlayed() {
      inMemory = true;
      try {
        storage()?.setItem(INTRO_SESSION_KEY, "1");
      } catch {
        // a full or blocked storage: the memory flag above is enough for this page life
      }
    },
  };
}

/** One session for the site: every LogoIntro of the page shares it. */
export const introSession: IntroSession = createIntroSession();

type MatchMedia = (query: string) => { matches: boolean };

/**
 * `prefers-reduced-motion: reduce`. No `matchMedia` (server, old browser) means no preference; a `matchMedia` that
 * throws counts as reduced, so a doubtful environment never gets the 3D intro.
 */
export function prefersReducedMotion(
  matchMedia: MatchMedia | undefined = (globalThis as { matchMedia?: MatchMedia }).matchMedia?.bind(globalThis),
): boolean {
  if (!matchMedia) return false;
  try {
    return matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return true;
  }
}
