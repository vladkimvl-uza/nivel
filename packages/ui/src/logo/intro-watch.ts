// The browser parts that keep the 3D core from working when nobody needs it. No React, no three.
//  - constrainedNetwork: a data saver, a 2g/3g link or a device with 2 GB or less: the core is not even requested
//    (ARCHITECTURE 5.8: the heavy parts are switched off for such visitors; the still lockup is the whole logo);
//  - watchVisible: the loop of the hero stops while the box is outside the viewport or the tab is hidden;
//  - watchReducedMotion: "reduce" can be switched on while the page is open (WCAG 2.2.2: motion that goes on can be stopped).

interface NetworkInfo {
  saveData?: boolean;
  effectiveType?: string;
}

/** The part of `navigator` that is read; every field may be missing (Safari, Firefox, a server). */
export interface NetworkNavigator {
  connection?: NetworkInfo;
  deviceMemory?: number;
}

const SLOW_LINKS = new Set(["slow-2g", "2g", "3g"]);

/** True for a data saver, a 2g/3g class link or a device that reports 2 GB of memory or less. */
export function constrainedNetwork(
  nav: NetworkNavigator | undefined = (globalThis as { navigator?: NetworkNavigator }).navigator,
): boolean {
  try {
    if (!nav) return false;
    const link = nav.connection;
    if (link?.saveData === true) return true;
    if (link?.effectiveType !== undefined && SLOW_LINKS.has(link.effectiveType)) return true;
    return typeof nav.deviceMemory === "number" && nav.deviceMemory <= 2;
  } catch {
    // a blocked or exotic navigator: the check must never break the page
    return false;
  }
}

/** The part of the environment that `watchVisible` uses; replaced in tests. */
export interface VisibilityEnv {
  IntersectionObserver?:
    | undefined
    | (new (
        callback: (entries: { isIntersecting: boolean }[]) => void,
      ) => { observe(target: Element): void; disconnect(): void });
  doc?:
    | undefined
    | {
        visibilityState: string;
        addEventListener(type: "visibilitychange", listener: () => void): void;
        removeEventListener(type: "visibilitychange", listener: () => void): void;
      };
}

const browserVisibilityEnv = (): VisibilityEnv => {
  const host = globalThis as {
    IntersectionObserver?: VisibilityEnv["IntersectionObserver"];
    document?: VisibilityEnv["doc"];
  };
  return { IntersectionObserver: host.IntersectionObserver, doc: host.document };
};

/**
 * Tells `true` when `target` is in the viewport and the tab is shown, `false` otherwise (only when the value changes).
 * Returns the function that stops watching. Without IntersectionObserver the tab alone decides.
 */
export function watchVisible(
  target: Element,
  onChange: (visible: boolean) => void,
  env: VisibilityEnv = browserVisibilityEnv(),
): () => void {
  let inView = true;
  let last: boolean | null = null;
  const emit = () => {
    const now = inView && env.doc?.visibilityState !== "hidden";
    if (now === last) return;
    last = now;
    onChange(now);
  };
  const observer = env.IntersectionObserver
    ? new env.IntersectionObserver((entries) => {
        const entry = entries[entries.length - 1];
        if (!entry) return;
        inView = entry.isIntersecting;
        emit();
      })
    : null;
  observer?.observe(target);
  const onTab = () => emit();
  env.doc?.addEventListener("visibilitychange", onTab);
  return () => {
    observer?.disconnect();
    env.doc?.removeEventListener("visibilitychange", onTab);
  };
}

type QueryList = {
  matches: boolean;
  addEventListener?(type: "change", listener: (event: { matches: boolean }) => void): void;
  removeEventListener?(type: "change", listener: (event: { matches: boolean }) => void): void;
  addListener?(listener: (event: { matches: boolean }) => void): void;
  removeListener?(listener: (event: { matches: boolean }) => void): void;
};
type MatchMedia = (query: string) => QueryList;

/** Tells the new value whenever `prefers-reduced-motion: reduce` changes. Returns the function that stops listening. */
export function watchReducedMotion(
  onChange: (reduced: boolean) => void,
  matchMedia: MatchMedia | undefined = (globalThis as { matchMedia?: MatchMedia }).matchMedia?.bind(globalThis),
): () => void {
  if (!matchMedia) return () => {};
  let list: QueryList;
  try {
    list = matchMedia("(prefers-reduced-motion: reduce)");
  } catch {
    return () => {};
  }
  const listener = (event: { matches: boolean }) => onChange(event.matches);
  if (list.addEventListener) list.addEventListener("change", listener);
  else list.addListener?.(listener); // Safari before 14
  return () => {
    if (list.removeEventListener) list.removeEventListener("change", listener);
    else list.removeListener?.(listener);
  };
}
