// The effect of LogoIntro without a DOM: the hooks are replaced, so the effect body runs as a plain function.
import { afterEach, describe, expect, it, vi } from "vitest";

const effects: (() => (() => void) | undefined)[] = [];
const refs: { current: unknown }[] = [];
const setPhase = vi.fn();

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: (initial: unknown) => [initial, setPhase],
    useRef: (initial: unknown) => {
      const ref = { current: initial };
      refs.push(ref);
      return ref;
    },
    useEffect: (effect: () => (() => void) | undefined) => {
      effects.push(effect);
    },
  };
});

const { LogoIntro } = await import("./LogoIntro.tsx");
const { createIntroSession } = await import("./intro-session.ts");

/** Renders the component function once and returns its refs (canvas, caption) and the effect. */
function mount(props: Parameters<typeof LogoIntro>[0], canvas: unknown = { id: "canvas" }) {
  effects.length = 0;
  refs.length = 0;
  LogoIntro(props);
  const [canvasRef, captionRef] = refs;
  if (canvasRef) canvasRef.current = canvas;
  if (captionRef) captionRef.current = { id: "caption" };
  return { effect: effects[0] as () => (() => void) | undefined, refs: { canvasRef, captionRef } };
}

afterEach(() => {
  setPhase.mockClear();
  vi.useRealTimers();
});

describe("LogoIntro effect", () => {
  it("does nothing when there is no canvas yet", () => {
    const { effect } = mount({}, null);
    expect(effect()).toBeUndefined();
  });

  it("under reduced motion the core is not requested at all (zero requests to three)", () => {
    const load = vi.fn();
    const whenIdle = vi.fn(() => () => {});
    const { effect } = mount({ deps: { reducedMotion: () => true, load, whenIdle } });
    const cleanup = effect();
    expect(whenIdle).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
    expect(() => cleanup?.()).not.toThrow();
  });

  it("with a played session: still lockup, no load", () => {
    const session = createIntroSession(() => null);
    session.markPlayed();
    const load = vi.fn();
    const { effect } = mount({ deps: { session, reducedMotion: () => false, load, whenIdle: () => () => {} } });
    effect()?.();
    expect(load).not.toHaveBeenCalled();
  });

  it("requests the core after idle, passes the canvas and the caption, and reports the phase to the state", async () => {
    let idle: () => void = () => {};
    const handle = { ready: Promise.resolve(), play: vi.fn(), dispose: vi.fn() };
    const createLogoMotion = vi.fn(() => handle);
    const load = vi.fn(async () => ({ createLogoMotion, INTRO_DURATION: 3.3 }));
    const cancel = vi.fn();
    const onDone = vi.fn();
    const props = {
      mode: "hero" as const,
      onDone,
      deps: {
        load: load as never,
        whenIdle: (cb: () => void) => {
          idle = cb;
          return cancel;
        },
        session: createIntroSession(() => null),
        reducedMotion: () => false,
        now: () => 0,
      },
    };
    const { effect, refs: r } = mount(props);
    const cleanup = effect();
    expect(load).not.toHaveBeenCalled();
    idle();
    await vi.waitFor(() => expect(setPhase).toHaveBeenCalledWith("playing"));
    const call = createLogoMotion.mock.calls[0] as unknown as [
      unknown,
      { mode: string; caption: unknown; onDone(): void },
    ];
    expect(call[0]).toBe(r.canvasRef?.current);
    expect(call[1].mode).toBe("hero");
    expect(call[1].caption).toBe(r.captionRef?.current);
    expect(handle.play).toHaveBeenCalledWith(0);
    call[1].onDone();
    expect(onDone).toHaveBeenCalledTimes(1);
    cleanup?.();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(handle.dispose).toHaveBeenCalled();
  });

  it("reports an error through onError and stays on the still lockup", async () => {
    let idle: () => void = () => {};
    const onError = vi.fn();
    const error = new Error("offline");
    const { effect } = mount({
      onError,
      deps: {
        load: (async () => {
          throw error;
        }) as never,
        whenIdle: (cb: () => void) => {
          idle = cb;
          return () => {};
        },
        session: createIntroSession(() => null),
        reducedMotion: () => false,
      },
    });
    effect();
    idle();
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(error));
    expect(setPhase).not.toHaveBeenCalled();
  });

  it("with the real defaults: loads the real core by import() after the idle timer, and where WebGL is missing it ends on the still lockup", async () => {
    const onError = vi.fn();
    const canvas = { getContext: () => null, addEventListener: () => {}, removeEventListener: () => {} };
    const { effect } = mount({ onError, deps: { session: createIntroSession(() => null) } }, canvas);
    const cleanup = effect();
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1), { timeout: 10_000 });
    const reported = onError.mock.calls[0]?.[0] as Error | undefined;
    expect(String(reported?.message)).toMatch(/WebGL/i);
    expect(setPhase).not.toHaveBeenCalled();
    cleanup?.();
  });
});
