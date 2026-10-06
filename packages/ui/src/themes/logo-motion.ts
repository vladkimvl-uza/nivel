// Colors and light of the intro "Fit to tolerance", the night set only (ADR-006, R-17 of 06.10.2026).
// Raw colors are allowed only in `themes/` (tools/check-antilist.mjs): the 3D scene takes all of them from here.
// Every color is warm (R >= G >= B); no blue, no rings, no neon, no bloom.
//
// Source of the values: docs/design/logo-motion/fit/notes.md, table "Materials and light", night column.
// Changes against the concept (the "known limits" of the notes, 06.10.2026): `chamferBounce` (the bounce from the
// plate that lifts the lower chamfers: no hairline shadow under the letters) and the lamp that widens for a tall
// frame (timeline.ts `lampForAspect`, no vignette in 9:16).

export const logoScene = {
  /** Clear color of the canvas: the page background. */
  clear: "#121110",
  /** Plate: warm black; in the lamp pool about #2C2825, in the corners about #181513. */
  plate: "#1B1410",
  wall: "#130F0C",
  floor: "#0C0B0A",
  /** Parts: light "paper" ink and the signal orange of the night (brand.signalDark). */
  ink: "#EEEDEA",
  accent: "#F06A30",
  inkRoughness: 0.72,
  accentRoughness: 0.72,
  /** Chamfers: lighter than the face, not metal, they reflect the environment. */
  chamferLift: 1.12,
  chamferRoughness: 0.5,
  chamferEnv: 9,
  /** Strength of the raking glint on the chamfers of the part that has just seated. */
  glint: 3.5,
  /** Dashed layout axes scribed on the plate. */
  guide: "#F1EFEA",
  guideOpacity: 0.34,
  /** Lamp and sky. */
  lampColor: "#FFFBF6",
  skyColor: "#FFF1E4",
  groundColor: "#2A241F",
  /**
   * Warm bounce from the lit plate onto chamfers that look down (strength of the diffuse term, 0..1, times the lamp
   * level). Without it the lower chamfers of the letters stay about a quarter darker than the face: a hairline shadow
   * under every letter, which the concept listed among its limits.
   */
  chamferBounce: 0.5,
  environmentIntensity: 0.06,
  lampIntensity: 2.85,
  hemisphereBase: 0.03,
  hemisphereLamp: 0.12,
  /**
   * Page background behind the still lockup: the lamp pool as the 3D frame draws it (sampled from the frames of the
   * 1:1 and 9:16 clips along the diagonal), so the swap between the canvas and the still lockup has no jump.
   * The ellipse follows the box, so a tall frame gets a tall pool, the same ratio as the lamp cone in 3D.
   */
  stage:
    "radial-gradient(ellipse farthest-corner at 50% 50%, #2E2927 0, #2D2926 45%, #2B2724 60%, #262220 75%, #1E1B19 90%, #171413 100%)",
} as const;
