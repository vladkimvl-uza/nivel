import {
  type BufferGeometry,
  type Line,
  type LineDashedMaterial,
  type Mesh,
  type MeshStandardMaterial,
  NoToneMapping,
  PCFShadowMap,
  type SpotLight,
  SRGBColorSpace,
  Vector3,
  type WebGLRenderer,
} from "three";
import { describe, expect, it, vi } from "vitest";
import { logoScene } from "../themes/logo-motion.ts";
import { buildLogoGeometry } from "./geometry.ts";
import { createLogoScene, noiseTexture } from "./scene.ts";
import {
  AXES,
  CLICKS,
  frameAt,
  INTRO_DURATION,
  LAMP_BASE,
  LOCK_CENTER,
  PART_IDS,
  type PartId,
  visibleHalfExtents,
} from "./timeline.ts";

/** A renderer without a GPU: it records what the scene asks of it. */
function fakeRenderer() {
  const renderer = {
    shadowMap: { enabled: false, type: -1 },
    toneMapping: -1,
    outputColorSpace: "",
    setClearColor: vi.fn(),
    render: vi.fn(),
    compileAsync: vi.fn(async () => {}),
  };
  return renderer as typeof renderer & WebGLRenderer;
}

// The meshes are built once for the file: building them is the slow part, and the scene only reads them.
const geometry = buildLogoGeometry();

function setup(width = 1080, height = 1080) {
  const renderer = fakeRenderer();
  const logo = createLogoScene(renderer, { lite: false, environment: null }, geometry);
  logo.setSize(width, height);
  const mesh = (id: PartId) => logo.scene.getObjectByName(id) as Mesh;
  const lamp = () => logo.scene.children.find((c) => (c as SpotLight).isSpotLight) as SpotLight;
  const rig = () => logo.scene.children.find((c) => c.type === "Group") as Mesh;
  const chamfer = (id: PartId) => (mesh(id).material as MeshStandardMaterial[])[2] as MeshStandardMaterial;
  return { renderer, logo, mesh, lamp, rig, chamfer };
}

const intro = (t: number) => frameAt("intro", t);

describe("scene: renderer set-up (night only, three 0.186)", () => {
  it("clears to the page background, no tone mapping, sRGB output", () => {
    const { renderer } = setup();
    expect(renderer.setClearColor).toHaveBeenCalledWith(logoScene.clear);
    expect(renderer.toneMapping).toBe(NoToneMapping);
    expect(renderer.outputColorSpace).toBe(SRGBColorSpace);
  });

  it("casts shadows with PCFShadowMap (PCFSoftShadowMap is removed in three 0.186 and only warns)", () => {
    const { renderer } = setup();
    expect(renderer.shadowMap.enabled).toBe(true);
    expect(renderer.shadowMap.type).toBe(PCFShadowMap);
  });

  it("compiles programs through compileAsync before the first frame (cold start)", async () => {
    const s = setup();
    await s.logo.compile();
    expect(s.renderer.compileAsync).toHaveBeenCalledWith(s.logo.scene, s.logo.camera);
  });
});

describe("scene: the lamp pool does not band", () => {
  it("dithers the plate, its pocket walls and the floor of the pockets (8 bits band a dark gradient into rings)", () => {
    const s = setup();
    const dithered: MeshStandardMaterial[] = [];
    s.logo.scene.traverse((o) => {
      const m = (o as Mesh).material as MeshStandardMaterial | MeshStandardMaterial[] | undefined;
      for (const x of Array.isArray(m) ? m : m ? [m] : []) if (x.dithering) dithered.push(x);
    });
    expect(dithered).toHaveLength(3);
    expect(new Set(dithered.map((m) => m.color.getHexString())).size).toBe(3);
  });
});

describe("scene: frames of the intro", () => {
  it("t = 0: the line is 92 units left of its pocket, the lamp is off, the dot waits above the frame", () => {
    const s = setup();
    s.logo.draw(intro(0));
    expect(s.mesh("line").position.x).toBeCloseTo(-92, 6);
    expect(s.mesh("line").position.z).toBe(AXES.line.zFrom);
    expect(s.lamp().intensity).toBe(0);
    expect(s.mesh("dot").visible).toBe(false);
    expect(s.renderer.render).toHaveBeenCalledTimes(1);
    expect(s.renderer.render).toHaveBeenCalledWith(s.logo.scene, s.logo.camera);
  });

  it("turns the triangle about its own centre, not about the origin (its centre stays where the pose puts it)", () => {
    const s = setup();
    s.logo.draw(intro(0));
    const tri = s.mesh("tri");
    expect(tri.quaternion.z).not.toBe(0);
    const box = tri.geometry.boundingBox as NonNullable<BufferGeometry["boundingBox"]>;
    const centre = box.getCenter(new Vector3());
    const moved = centre.clone().applyMatrix4(tri.matrix.compose(tri.position, tri.quaternion, tri.scale));
    // pose: offset (0, 62) up, height 9; the turn keeps the centre where it is
    expect(moved.x).toBeCloseTo(centre.x, 6);
    expect(moved.y).toBeCloseTo(centre.y + AXES.tri.dist, 6);
  });

  it("the lamp comes on with the click of the switch: off before 0.06 s, full from 0.4 s", () => {
    const s = setup();
    s.logo.draw(intro(0.05));
    expect(s.lamp().intensity).toBe(0);
    s.logo.draw(intro(0.06));
    expect(s.lamp().intensity).toBeCloseTo(logoScene.lampIntensity * 0.62, 6);
    s.logo.draw(intro(0.4));
    expect(s.lamp().intensity).toBeCloseTo(logoScene.lampIntensity, 6);
  });

  it("t = 3.3: every part is flush with the plate, the camera looks straight at the middle of the lockup", () => {
    const s = setup();
    s.logo.draw(intro(INTRO_DURATION));
    for (const id of PART_IDS) {
      const p = s.mesh(id).position;
      expect([p.x, p.y, p.z]).toEqual([0, 0, 0]);
      expect(s.mesh(id).visible).toBe(true);
    }
    const cam = s.logo.camera.position;
    expect(cam.x).toBeCloseTo(LOCK_CENTER.x, 6);
    expect(cam.y).toBeCloseTo(LOCK_CENTER.y, 6);
    expect(cam.z).toBeGreaterThan(300);
    expect(s.rig().position.length()).toBe(0);
  });

  it("the final frame is the same from 2.5 s on (the still lockup does not move)", () => {
    const s = setup();
    s.logo.draw(intro(2.5));
    const a = s.logo.camera.position.clone();
    s.logo.draw(intro(INTRO_DURATION));
    expect(s.logo.camera.position.distanceTo(a)).toBe(0);
  });

  it("the shock of a seat moves the whole assembly, and it comes back", () => {
    const s = setup();
    s.logo.draw(intro(AXES.line.t1));
    expect(s.rig().position.x).toBeCloseTo(AXES.line.recoil[0], 6);
    s.logo.draw(intro(AXES.line.t1 + 0.13));
    expect(s.rig().position.x).toBe(0);
  });

  it("the dot bounces out of its pocket after the seat", () => {
    const s = setup();
    s.logo.draw(intro(AXES.dot.t1 + 0.0375));
    expect(s.mesh("dot").position.z).toBeGreaterThan(0.1);
    expect(s.mesh("dot").visible).toBe(true);
  });

  it("the dot starts above the top edge of the frame, in a square and in a tall frame", () => {
    for (const [w, h] of [
      [1080, 1080],
      [1080, 1920],
      [390, 844],
    ] as const) {
      const s = setup(w, h);
      s.logo.draw(intro(1.7)); // the dot is on its way, still far above
      const top = LOCK_CENTER.y + visibleHalfExtents(w / h, w).halfH;
      s.logo.draw(intro(AXES.dot.t0));
      const centre = s.mesh("dot").geometry.boundingBox?.min.y ?? 0;
      expect(s.mesh("dot").position.y + centre).toBeGreaterThan(top);
    }
  });

  it("scribes dashed layout axes that lead into the pockets and are gone after the seat", () => {
    const s = setup();
    s.logo.draw(intro(0.2));
    const guides = s.logo.scene.getObjectByProperty("type", "Group")?.children.filter((c) => (c as Line).isLine) ?? [];
    expect(guides).toHaveLength(4);
    expect(guides.some((g) => g.visible)).toBe(true);
    expect((guides[0] as Line).material).toHaveProperty("dashSize", 5);
    expect(((guides[0] as Line).material as LineDashedMaterial).opacity).toBeLessThanOrEqual(logoScene.guideOpacity);
    s.logo.draw(intro(INTRO_DURATION));
    expect(guides.every((g) => !g.visible)).toBe(true);
  });
});

describe("scene: light on the chamfers", () => {
  it("runs the glint over the chamfers of the part that has just seated, and only over it", () => {
    const s = setup();
    const t = AXES.shelf.t1 + 0.1;
    s.logo.draw(intro(t));
    const strength = (id: PartId) => glintStrength(s.chamfer(id));
    expect(strength("shelf")).toBeGreaterThan(0);
    expect(strength("word")).toBe(0);
    expect(strength("line")).toBe(0);
    s.logo.draw(intro(INTRO_DURATION));
    expect(strength("shelf")).toBe(0);
  });

  it("aims the glint source with a unit vector", () => {
    const s = setup();
    s.logo.draw(intro(AXES.tri.t1 + 0.1));
    const dir = glintDirection(s.chamfer("tri"));
    expect(dir.length()).toBeCloseTo(1, 6);
  });

  it("patches the standard shader: the glint, and the bounce of the plate on the chamfers that look down", () => {
    const s = setup();
    const material = s.chamfer("word");
    const shader = {
      uniforms: {} as Record<string, unknown>,
      fragmentShader: "#include <common>\n#include <lights_fragment_end>\n",
    };
    (material.onBeforeCompile as (shader: unknown, renderer: unknown) => void)(shader, null);
    expect(Object.keys(shader.uniforms).sort()).toEqual(["uBounce", "uGlint", "uGlintDir"]);
    expect(shader.fragmentShader).toContain("uniform float uGlint;");
    expect(shader.fragmentShader).toContain("uniform float uBounce;");
    expect(shader.fragmentShader).toContain("reflectedLight.directDiffuse += diffuseColor.rgb * (uBounce *");
    expect(shader.fragmentShader).toContain("reflectedLight.directSpecular +=");
    expect(material.customProgramCacheKey()).toBe("nv-logo-glint");
  });

  it("lifts the lower chamfers with the lamp: no bounce with the lamp off, the full bounce with it on", () => {
    const s = setup();
    s.logo.draw(intro(0));
    expect(bounce(s.chamfer("word"))).toBe(0);
    s.logo.draw(intro(INTRO_DURATION));
    expect(bounce(s.chamfer("word"))).toBeCloseTo(logoScene.chamferBounce, 9);
    expect(logoScene.chamferBounce).toBeGreaterThan(0);
  });

  it("gives the chamfers a lighter color than the face and no metal (they reflect the room)", () => {
    const s = setup();
    const face = (s.mesh("word").material as MeshStandardMaterial[])[0] as MeshStandardMaterial;
    const bevel = s.chamfer("word");
    expect(bevel.color.r).toBeGreaterThan(face.color.r);
    expect(bevel.metalness).toBe(0);
    expect(bevel.envMapIntensity).toBe(logoScene.chamferEnv);
  });
});

describe("scene: caption over the shelf", () => {
  it("is shown only while the shelf seats and sits above the right end of the shelf", () => {
    const s = setup();
    expect(s.logo.draw(intro(0)).caption.alpha).toBe(0);
    const c = s.logo.draw(intro(1.4)).caption;
    expect(c.alpha).toBeGreaterThan(0.5);
    expect(c.alpha).toBeLessThanOrEqual(0.9);
    expect(c.fontPx).toBeGreaterThan(3);
    expect(c.x).toBeGreaterThan(0);
    expect(c.x).toBeLessThan(1080);
    expect(c.y).toBeGreaterThan(0);
    expect(c.y).toBeLessThan(1080);
    expect(s.logo.draw(intro(2.5)).caption.alpha).toBe(0);
  });

  it("is hidden in the loop", () => {
    const s = setup();
    expect(s.logo.draw({ phase: "loop", t: 1.4 }).caption).toEqual({ alpha: 0, x: 0, y: 0, fontPx: 0 });
  });
});

describe("scene: the pool of the lamp follows the frame", () => {
  it("opens the cone for a tall frame and keeps the base one for a square", () => {
    const sq = setup(1080, 1080).lamp();
    const tall = setup(1080, 1920).lamp();
    expect(sq.angle).toBeCloseTo(LAMP_BASE.angle, 6);
    expect(tall.angle).toBeGreaterThan(sq.angle + 0.15);
    expect(tall.penumbra).toBe(LAMP_BASE.penumbra);
  });

  it("aims the lamp from above the lockup at the point between the mark and the word", () => {
    const s = setup();
    s.logo.draw(intro(INTRO_DURATION));
    expect(s.lamp().position.toArray()).toEqual([
      LOCK_CENTER.x + LAMP_BASE.position[0],
      LOCK_CENTER.y + LAMP_BASE.position[1],
      LAMP_BASE.position[2],
    ]);
    expect(s.lamp().target.position.x).toBeCloseTo(LOCK_CENTER.x + LAMP_BASE.target[0], 9);
  });
});

describe("scene: the loop and the cleanup", () => {
  it("the loop breathes: the camera swings by 2.2 degrees at a quarter of the cycle and the lamp stays on", () => {
    const s = setup();
    s.logo.draw({ phase: "loop", t: 0, ramp: false });
    const start = s.logo.camera.position.x;
    s.logo.draw({ phase: "loop", t: 3, ramp: false });
    expect(s.logo.camera.position.x).toBeGreaterThan(start + 5);
    expect(s.lamp().intensity).toBeCloseTo(logoScene.lampIntensity, 6);
    for (const id of PART_IDS) expect(s.mesh(id).position.length()).toBe(0);
  });

  it("the first loop frame equals the last intro frame (no seam in hero)", () => {
    const s = setup();
    s.logo.draw(intro(INTRO_DURATION));
    const last = s.logo.camera.position.clone();
    s.logo.draw({ phase: "loop", t: 0, ramp: true });
    expect(s.logo.camera.position.distanceTo(last)).toBeLessThan(1e-9);
  });

  it("disposes geometry, materials and textures, and empties the scene", () => {
    const s = setup();
    const geo = s.mesh("word").geometry;
    const spy = vi.spyOn(geo, "dispose");
    s.logo.dispose();
    expect(spy).toHaveBeenCalled();
    expect(s.logo.scene.children).toHaveLength(0);
  });

  it("clicks of the clips are the seats of the five parts", () => {
    expect(CLICKS.map((c) => c.t)).toEqual(PART_IDS.map((id) => AXES[id].t1));
  });
});

describe("noiseTexture", () => {
  it("is deterministic and stays inside its range", () => {
    const a = noiseTexture(16, 246, 255, 7);
    const b = noiseTexture(16, 246, 255, 7);
    expect(Buffer.from(a.image.data as Uint8Array).equals(Buffer.from(b.image.data as Uint8Array))).toBe(true);
    const data = a.image.data as Uint8Array;
    for (let i = 0; i < data.length; i += 4) {
      expect(data[i]).toBeGreaterThanOrEqual(246);
      expect(data[i]).toBeLessThanOrEqual(255);
      expect(data[i + 3]).toBe(255);
    }
  });

  it("cuts milling rows into the floor: every fourth row is darker", () => {
    const tex = noiseTexture(16, 236, 255, 11, 4);
    const data = tex.image.data as Uint8Array;
    const row = (r: number) =>
      data.slice(r * 16 * 4, (r + 1) * 16 * 4).reduce((s, v, i) => (i % 4 === 0 ? s + v : s), 0) / 16;
    expect(row(0)).toBeLessThan(row(1) - 5);
    expect(row(4)).toBeLessThan(row(5) - 5);
    expect(tex.colorSpace).toBe(SRGBColorSpace);
  });
});

// The glint uniforms live in the closure of the shader patch: they are reached through the patched shader.
function uniformsOf(material: MeshStandardMaterial): Record<string, { value: unknown }> {
  const shader = {
    uniforms: {} as Record<string, { value: unknown }>,
    fragmentShader: "#include <common>\n#include <lights_fragment_end>",
  };
  (material.onBeforeCompile as (s: unknown, r: unknown) => void)(shader, null);
  return shader.uniforms;
}
const glintStrength = (m: MeshStandardMaterial) => uniformsOf(m).uGlint?.value as number;
const bounce = (m: MeshStandardMaterial) => uniformsOf(m).uBounce?.value as number;
const glintDirection = (m: MeshStandardMaterial) => uniformsOf(m).uGlintDir?.value as Vector3;
