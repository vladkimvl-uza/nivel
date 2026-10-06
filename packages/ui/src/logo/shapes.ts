// Shapes of the nivel-1 logo ("level mark"): copied verbatim from docs/brand/logos-v2/nivel-1*.svg (a test compares
// them with the files). No colors here: a shape has a role, and the color comes from the tokens (themes/tokens.ts),
// so raw HEX never leaves `themes/`. Owner: WP-09.

/** `ink` is the body of the mark and the word, `accent` is the orange triangle and the dot over i. */
export type LogoRole = "ink" | "accent";

export interface LogoShape {
  readonly role: LogoRole;
  readonly d: string;
}

/** The mark, a 64 x 64 box: shelf, level triangle (two halves, the accent one on the left) and the level line. */
export const markViewBox = "0 0 64 64";
export const markShapes: readonly LogoShape[] = [
  { role: "ink", d: "M8 16h52v8h-52Z" },
  { role: "accent", d: "M8 24L24 24L24 40Z" },
  { role: "ink", d: "M24 24L40 24L24 40Z" },
  { role: "ink", d: "M4 40h56v8h-56Z" },
];
/** How many leading shapes of the mark rock around the apex in the loader; the level line stays. */
export const markRockingCount = 3;
/** The apex of the triangle in mark units: the loader rocks the shelf and the triangle around it. */
export const markApex = { x: 24, y: 40 } as const;

/** The lockup: mark and word "nivel" in one 348.6 x 83 box. */
export const lockupViewBox = "-4.0 -77.5 348.6 83.0";
export const lockupSize = { width: 348.6, height: 83.0 } as const;
export const lockupMarkTransform = "translate(-6.25 -74.97) scale(1.5619)";
export const lockupWordTransform = "translate(111.56 0)";
export const wordShapes: readonly LogoShape[] = [
  {
    role: "ink",
    d: "M44.35 0V-26Q44.35 -28.55 44 -31.65Q43.65 -34.75 42.38 -37.62Q41.1 -40.5 38.58 -42.35Q36.05 -44.2 31.75 -44.2Q29.45 -44.2 27.2 -43.45Q24.95 -42.7 23.12 -40.88Q21.3 -39.05 20.2 -35.88Q19.1 -32.7 19.1 -27.75L11.95 -30.8Q11.95 -37.7 14.62 -43.3Q17.3 -48.9 22.5 -52.23Q27.7 -55.55 35.3 -55.55Q41.3 -55.55 45.2 -53.55Q49.1 -51.55 51.4 -48.45Q53.7 -45.35 54.8 -41.85Q55.9 -38.35 56.23 -35.23Q56.55 -32.1 56.55 -30.15V0ZM6.9 0V-54H17.65V-37.25H19.1V0ZM69.95 0V-54H82V0ZM111 0 91.4 -54H103.45L117.05 -14.85L130.6 -54H142.7L123.1 0ZM172.95 1.5Q164.75 1.5 158.55 -2.05Q152.35 -5.6 148.88 -11.9Q145.4 -18.2 145.4 -26.4Q145.4 -35.25 148.8 -41.78Q152.2 -48.3 158.25 -51.9Q164.3 -55.5 172.25 -55.5Q180.65 -55.5 186.53 -51.58Q192.4 -47.65 195.25 -40.5Q198.1 -33.35 197.4 -23.65H185.45V-28.05Q185.4 -36.85 182.35 -40.9Q179.3 -44.95 172.75 -44.95Q165.35 -44.95 161.75 -40.38Q158.15 -35.8 158.15 -27Q158.15 -18.8 161.75 -14.3Q165.35 -9.8 172.25 -9.8Q176.7 -9.8 179.93 -11.78Q183.15 -13.75 184.9 -17.5L196.8 -13.9Q193.7 -6.6 187.23 -2.55Q180.75 1.5 172.95 1.5ZM154.35 -23.65V-32.75H191.5V-23.65ZM209 0V-73.5H221.05V0Z",
  },
  { role: "accent", d: "M64.53 -73.25L87.42 -73.25L75.98 -61.8Z" },
];
