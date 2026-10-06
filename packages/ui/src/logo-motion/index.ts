// Entry `@nivel/ui/logo-motion`: the 3D core of the intro "Fit to tolerance" (R-17). Plain TypeScript, no React.
// It imports three, so no other entry of the package may import it statically: LogoIntro (`@nivel/ui/react`) loads it
// with import() after idle time, and a test (entries.test.ts) keeps three out of the graph of the other entries.

export { LAMP_CLICK_AT, renderClickTrack, SAMPLE_RATE, wavBytes } from "./click-sound.ts";
export { applyCaption, createLogoMotion, type LogoMotion, type LogoMotionOptions, type MotionDeps } from "./create.ts";
export type { FrameInfo, LogoScene } from "./scene.ts";
export {
  AXES,
  CLICKS,
  frameAt,
  INTRO_DURATION,
  LOOP_DURATION,
  type MotionMode,
  type PartId,
  partPose,
} from "./timeline.ts";
