// What the visitor said about motion, as the server can see it: the switch of the site (the cookie `nv-motion=off`) and the
// header `Save-Data: on` of a browser that saves traffic. `prefers-reduced-motion` is seen only in the browser (CSS and the
// script in the head).

export const MOTION_COOKIE = "nv-motion";

export interface MotionPrefs {
  /** The visitor pressed «Without animation» on this site. */
  motionOff: boolean;
  /** The browser asked to save traffic. */
  saveData: boolean;
  /** Either of the two: the page is served static, with no video. */
  reduced: boolean;
}

export function readMotionPrefs(
  motionCookie: string | undefined,
  saveDataHeader: string | null | undefined,
): MotionPrefs {
  const motionOff = motionCookie === "off";
  const saveData = (saveDataHeader ?? "").trim().toLowerCase() === "on";
  return { motionOff, saveData, reduced: motionOff || saveData };
}

const YEAR_S = 365 * 24 * 60 * 60;

/** The value to assign to `document.cookie` for the switch «Without animation»; `off = false` removes the cookie. */
export function motionCookie(off: boolean): string {
  return off
    ? `${MOTION_COOKIE}=off; path=/; max-age=${YEAR_S}; samesite=lax`
    : `${MOTION_COOKIE}=; path=/; max-age=0; samesite=lax`;
}
