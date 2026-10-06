// The 3D scene of the intro "Fit to tolerance": a milled plate with pockets along the lockup contour and five parts
// that come in along their own axes, line up over their pockets and drop in flush. Night only (ADR-006).
// The scene knows nothing about the DOM and the clock: `draw(plan)` renders one frame of the timeline, so the same
// code serves the site (rAF), the tests (a stub renderer) and the clips (frame by frame).
import {
  BufferGeometry,
  DataTexture,
  Euler,
  Group,
  HemisphereLight,
  Line,
  LinearFilter,
  LinearMipmapLinearFilter,
  LineDashedMaterial,
  Mesh,
  MeshStandardMaterial,
  NoToneMapping,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  RepeatWrapping,
  RGBAFormat,
  Scene,
  SpotLight,
  SRGBColorSpace,
  type Texture,
  UnsignedByteType,
  Vector3,
  type WebGLRenderer,
} from "three";
import { logoScene } from "../themes/logo-motion.ts";
import { buildLogoGeometry, type LogoGeometry } from "./geometry.ts";
import {
  AXES,
  CAMERA_FOV_DEG,
  captionAlpha,
  type FramePlan,
  frameFraction,
  glintAt,
  guideAlpha,
  introCameraAt,
  LAMP_BASE,
  LOCK_CENTER,
  LOCKUP_SIZE,
  lampForAspect,
  lampOn,
  loopCameraAt,
  MARK_CENTER,
  PART_IDS,
  type PartId,
  partPose,
  recoilAt,
} from "./timeline.ts";

const D2R = Math.PI / 180;
/** The i-dot never starts closer than this to its pocket, whatever the frame. */
const DOT_MIN_DISTANCE = 260;

export interface CaptionState {
  /** 0..1; 0 hides the caption. */
  alpha: number;
  /** Position of the right end of the caption baseline, CSS px from the top left of the canvas. */
  x: number;
  y: number;
  fontPx: number;
}

export interface FrameInfo {
  caption: CaptionState;
}

export interface LogoScene {
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  /** Size in CSS px; the renderer's own size and pixel ratio are set by the caller. */
  setSize(width: number, height: number): void;
  /** Renders the frame of the plan and returns what the DOM has to show over it. */
  draw(plan: FramePlan): FrameInfo;
  /** Compiles every program (shadow depth too) before the first visible frame. */
  compile(): Promise<void>;
  dispose(): void;
}

export interface LogoSceneOptions {
  /** Phones: shadow maps 1024 instead of 2048. */
  lite: boolean;
  /** Image-based light (a blurred room); the scene has none without it. */
  environment: Texture | null;
}

/** Procedural noise texture of the plate and the floor of the pockets (milling rows), no canvas needed. */
export function noiseTexture(size: number, lo: number, hi: number, seed: number, lines?: number): DataTexture {
  const data = new Uint8Array(size * size * 4);
  let s = seed;
  const rnd = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  for (let i = 0; i < data.length; i += 4) {
    let v = lo + rnd() * (hi - lo);
    if (lines) v -= Math.floor(i / 4 / size) % lines === 0 ? 10 : 0; // milling toolpath rows
    data[i] = data[i + 1] = data[i + 2] = Math.max(0, Math.min(255, Math.round(v)));
    data[i + 3] = 255;
  }
  const tex = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.colorSpace = SRGBColorSpace;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

interface GlintUniforms {
  strength: { value: number };
  dir: { value: Vector3 };
  /** Warm bounce from the plate onto chamfers that look down, 0 with the lamp off. */
  bounce: { value: number };
}

/**
 * Light of the chamfers beyond the three.js lights: a narrow raking source that acts on the chamfers of one part only
 * (a real specular highlight, not emission) and the bounce of the lit plate onto the chamfers that look down.
 */
function withGlint(mat: MeshStandardMaterial): MeshStandardMaterial & { glint: GlintUniforms } {
  const glint: GlintUniforms = { strength: { value: 0 }, dir: { value: new Vector3(0, 1, 0) }, bounce: { value: 0 } };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uGlint = glint.strength;
    shader.uniforms.uGlintDir = glint.dir;
    shader.uniforms.uBounce = glint.bounce;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform float uGlint;\nuniform vec3 uGlintDir;\nuniform float uBounce;",
      )
      .replace(
        "#include <lights_fragment_end>",
        `#include <lights_fragment_end>
          vec3 gUp = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
          reflectedLight.directDiffuse += diffuseColor.rgb * (uBounce * max(dot(normal, -gUp), 0.0));
          if (uGlint > 0.0) {
            vec3 gL = normalize((viewMatrix * vec4(uGlintDir, 0.0)).xyz);
            vec3 gV = normalize(vViewPosition);
            vec3 gH = normalize(gL + gV);
            float gs = pow(max(dot(normal, gH), 0.0), 60.0) * max(dot(normal, gL), 0.0);
            reflectedLight.directSpecular += vec3(1.0, 0.97, 0.93) * (uGlint * gs);
          }`,
      );
  };
  mat.customProgramCacheKey = () => "nv-logo-glint";
  return Object.assign(mat, { glint });
}

type GlintMaterial = ReturnType<typeof withGlint>;

interface PartRig {
  id: PartId;
  mesh: Mesh;
  center: Vector3;
  chamfers: GlintMaterial[];
}

function partMaterials(kind: "ink" | "acc" | "split") {
  const T = logoScene;
  const ink = new MeshStandardMaterial({ color: T.ink, roughness: T.inkRoughness, metalness: 0 });
  const wall = new MeshStandardMaterial({ color: T.ink, roughness: Math.min(1, T.inkRoughness + 0.1), metalness: 0 });
  const acc = new MeshStandardMaterial({ color: T.accent, roughness: T.accentRoughness, metalness: 0 });
  const chamfer = (color: string) => {
    const m = withGlint(
      new MeshStandardMaterial({ roughness: T.chamferRoughness, metalness: 0, envMapIntensity: T.chamferEnv }),
    );
    m.color.set(color).multiplyScalar(T.chamferLift);
    return m;
  };
  const bev = chamfer(T.ink);
  const bevAcc = chamfer(T.accent);
  const list = kind === "acc" ? [acc, acc, bevAcc, acc, bevAcc] : [ink, acc, bev, wall, bevAcc];
  return { list, chamfers: [bev, bevAcc], all: [ink, wall, acc, bev, bevAcc] };
}

/** Builds the scene on a renderer (a real WebGLRenderer, or a stub in tests); `geometry` is built when not given. */
export function createLogoScene(
  renderer: WebGLRenderer,
  options: LogoSceneOptions,
  geometry: LogoGeometry = buildLogoGeometry(),
): LogoScene {
  const T = logoScene;
  const scene = new Scene();
  const camera = new PerspectiveCamera(CAMERA_FOV_DEG, 1, 10, 6000);
  const disposables: { dispose(): void }[] = [];
  const own = <D extends { dispose(): void }>(d: D): D => {
    disposables.push(d);
    return d;
  };

  renderer.setClearColor(T.clear);
  renderer.toneMapping = NoToneMapping; // Neutral tone mapping over-saturates a dark warm scene
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  scene.environment = options.environment;
  scene.environmentIntensity = T.environmentIntensity;

  // the assembly (plate and parts) is one rig: a seat shakes it as a whole
  const rig = new Group();
  scene.add(rig);

  const plateTex = own(noiseTexture(256, 246, 255, 7));
  plateTex.repeat.set(1 / 40, 1 / 40); // the UV of ExtrudeGeometry are world units
  const floorTex = own(noiseTexture(128, 236, 255, 11, 4));
  floorTex.repeat.set(26, 8);
  const plateMat = own(new MeshStandardMaterial({ color: T.plate, roughness: 0.9, metalness: 0, map: plateTex }));
  const wallMat = own(new MeshStandardMaterial({ color: T.wall, roughness: 0.75, metalness: 0 }));
  const floorMat = own(new MeshStandardMaterial({ color: T.floor, roughness: 0.7, metalness: 0, map: floorTex }));
  own(geometry.plate);

  const plate = new Mesh(geometry.plate, [plateMat, wallMat]);
  plate.receiveShadow = true;
  plate.castShadow = true;
  rig.add(plate);
  const floorGeo = own(new PlaneGeometry(420, 140));
  const floor = new Mesh(floorGeo, floorMat);
  floor.position.set(LOCK_CENTER.x, LOCK_CENTER.y, -6);
  floor.receiveShadow = true;
  rig.add(floor);

  const kinds: Record<PartId, "ink" | "acc" | "split"> = {
    line: "ink",
    tri: "split",
    shelf: "ink",
    word: "ink",
    dot: "acc",
  };
  const parts = {} as Record<PartId, PartRig>;
  for (const id of PART_IDS) {
    const geo = own(geometry.parts[id]);
    const m = partMaterials(kinds[id]);
    for (const mat of m.all) own(mat);
    const mesh = new Mesh(geo, m.list);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = id;
    rig.add(mesh);
    const bb = geo.boundingBox;
    if (!bb) throw new Error(`createLogoScene: part ${id} has no bounding box`);
    parts[id] = {
      id,
      mesh,
      center: new Vector3((bb.min.x + bb.max.x) / 2, (bb.min.y + bb.max.y) / 2, 0),
      chamfers: m.chamfers,
    };
  }
  const box = (id: PartId) => parts[id].mesh.geometry.boundingBox as NonNullable<BufferGeometry["boundingBox"]>;

  // dashed layout axes scribed on the plate: they lead into the pockets (assembly-drawing axes) and go out after the seat
  const GZ = 0.12;
  const guide = (from: Vector3, to: Vector3) => {
    const geo = own(new BufferGeometry().setFromPoints([from, to]));
    const mat = own(
      new LineDashedMaterial({
        color: T.guide,
        dashSize: 5,
        gapSize: 3,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
    );
    const line = new Line(geo, mat);
    line.computeLineDistances();
    line.visible = false;
    rig.add(line);
    return line;
  };
  const guides: Partial<Record<PartId, Line>> = {
    line: guide(
      new Vector3(box("line").min.x - 170, parts.line.center.y, GZ),
      new Vector3(box("line").min.x - 1, parts.line.center.y, GZ),
    ),
    tri: guide(
      new Vector3(geometry.apexX, box("shelf").max.y + 1, GZ),
      new Vector3(geometry.apexX, box("shelf").max.y + 120, GZ),
    ),
    shelf: guide(
      new Vector3(box("shelf").max.x + 1, parts.shelf.center.y, GZ),
      new Vector3(box("shelf").max.x + 190, parts.shelf.center.y, GZ),
    ),
    dot: guide(
      new Vector3(parts.dot.center.x, box("dot").max.y + 1, GZ),
      new Vector3(parts.dot.center.x, box("dot").max.y + 260, GZ),
    ),
  };

  // light: a desk lamp high over the table (aimed between the mark and the word) and a faint sky
  const hemi = new HemisphereLight(T.skyColor, T.groundColor, T.hemisphereBase);
  scene.add(hemi);
  const lamp = new SpotLight(T.lampColor, 0, 0, LAMP_BASE.angle, LAMP_BASE.penumbra, 0);
  lamp.castShadow = true;
  const shadowSize = options.lite ? 1024 : 2048;
  lamp.shadow.mapSize.set(shadowSize, shadowSize);
  lamp.shadow.bias = -0.0004;
  lamp.shadow.normalBias = 0.35;
  lamp.shadow.camera.near = 300;
  lamp.shadow.camera.far = 2400;
  scene.add(lamp, lamp.target);
  disposables.push({ dispose: () => lamp.shadow.dispose() });

  let W = 1;
  let H = 1;
  let dotDistance: number = AXES.dot.dist;
  const target = new Vector3();
  const tmp = new Vector3();
  const euler = new Euler();
  const mark = new Vector3(MARK_CENTER.x, MARK_CENTER.y, 0);
  const lock = new Vector3(LOCK_CENTER.x, LOCK_CENTER.y, 0);
  const fov = CAMERA_FOV_DEG * D2R;

  /** Camera distance at which a box of the lockup fills `fw` of the width and `fh` of the height. */
  const fitDistance = (cw: number, ch: number, fw: number, fh: number) => {
    const asp = W / H;
    return Math.max(cw / fw / 2 / (Math.tan(fov / 2) * asp), ch / fh / 2 / Math.tan(fov / 2));
  };
  const lockDistance = () => fitDistance(LOCKUP_SIZE.width, LOCKUP_SIZE.height, frameFraction(W), 0.5);
  const orbit = (to: Vector3, dist: number, yawDeg: number, pitchDeg: number) => {
    const yaw = yawDeg * D2R;
    const pitch = pitchDeg * D2R;
    camera.position.set(
      to.x + dist * Math.sin(yaw) * Math.cos(pitch),
      to.y + dist * Math.sin(pitch),
      to.z + dist * Math.cos(yaw) * Math.cos(pitch),
    );
    camera.lookAt(to);
    camera.updateMatrixWorld();
  };

  function setSize(width: number, height: number) {
    W = Math.max(1, width);
    H = Math.max(1, height);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    // the i-dot starts above the top edge of the final frame, whatever the aspect (1:1, 9:16, phone)
    dotDistance = Math.max(
      DOT_MIN_DISTANCE,
      lockDistance() * Math.tan(fov / 2) - (box("dot").min.y - LOCK_CENTER.y) + 40,
    );
    // the pool of light follows the frame: a tall frame gets a wider cone (no vignette)
    const cone = lampForAspect(W / H, W);
    lamp.angle = cone.angle;
    lamp.penumbra = cone.penumbra;
  }

  function reset() {
    for (const id of PART_IDS) {
      const p = parts[id];
      p.mesh.position.set(0, 0, 0);
      p.mesh.quaternion.identity();
      p.mesh.visible = true;
      for (const c of p.chamfers) c.glint.strength.value = 0;
    }
    for (const g of Object.values(guides)) if (g) g.visible = false;
    rig.position.set(0, 0, 0);
  }

  function lights(level: number) {
    lamp.position.set(
      LOCK_CENTER.x + LAMP_BASE.position[0],
      LOCK_CENTER.y + LAMP_BASE.position[1],
      LAMP_BASE.position[2],
    );
    lamp.target.position.set(
      LOCK_CENTER.x + LAMP_BASE.target[0],
      LOCK_CENTER.y + LAMP_BASE.target[1],
      LAMP_BASE.target[2],
    );
    lamp.intensity = T.lampIntensity * level;
    hemi.intensity = T.hemisphereBase + T.hemisphereLamp * level;
    for (const id of PART_IDS) for (const c of parts[id].chamfers) c.glint.bounce.value = T.chamferBounce * level;
  }

  function place(id: PartId, t: number) {
    const p = parts[id];
    const pose = partPose(id, t, { dotDistance });
    p.mesh.position.set(pose.x, pose.y, pose.z);
    if (pose.axis && pose.angleDeg !== 0) {
      const a = pose.angleDeg * D2R;
      euler.set(0, pose.axis === "y" ? a : 0, pose.axis === "z" ? a : 0);
      p.mesh.quaternion.setFromEuler(euler);
      // turn about the centre of the part, not about the origin of the plate
      tmp.copy(p.center).applyQuaternion(p.mesh.quaternion);
      p.mesh.position.add(p.center).sub(tmp);
    }
  }

  /** Aims the narrow source so that its reflection off a 45 degree chamfer at the azimuth enters the lens. */
  function glint(id: PartId, t: number) {
    const p = parts[id];
    const g = glintAt(t, AXES[id].t1);
    for (const c of p.chamfers) c.glint.strength.value = T.glint * g.strength;
    if (!g.on) return;
    const phi = g.azimuthDeg * D2R;
    const view = tmp.copy(camera.position).sub(p.center).sub(p.mesh.position).sub(rig.position).normalize();
    const normal = new Vector3(Math.cos(phi), Math.sin(phi), 1).normalize();
    const dir = normal
      .clone()
      .multiplyScalar(2 * normal.dot(view))
      .sub(view)
      .normalize();
    for (const c of p.chamfers) c.glint.dir.value.copy(dir);
  }

  const shelfCorner = new Vector3();
  const shelfAside = new Vector3();
  function caption(t: number): CaptionState {
    const alpha = captionAlpha(t);
    if (alpha <= 0.001) return { alpha: 0, x: 0, y: 0, fontPx: 0 };
    const bb = box("shelf");
    shelfCorner.set(bb.max.x, bb.max.y + 3.2, 0).project(camera);
    shelfAside.set(bb.max.x - 10, bb.max.y + 3.2, 0).project(camera);
    const ppu = ((Math.abs(shelfCorner.x - shelfAside.x) / 2) * W) / 10; // px per unit at the shelf
    return {
      alpha: 0.9 * alpha,
      x: ((shelfCorner.x + 1) / 2) * W,
      y: ((1 - shelfCorner.y) / 2) * H,
      fontPx: 8.6 * ppu,
    };
  }

  function intro(t: number): FrameInfo {
    const cam = introCameraAt(t);
    target.copy(mark).lerp(lock, cam.targetBlend);
    target.y += cam.targetLift;
    orbit(target, lockDistance() * cam.distanceFactor, cam.yawDeg, cam.pitchDeg);
    for (const id of PART_IDS) {
      place(id, t);
      glint(id, t);
      if (id === "dot") parts.dot.mesh.visible = t > AXES.dot.t0 - 0.05;
    }
    const [rx, ry] = recoilAt(t);
    rig.position.set(rx, ry, 0);
    for (const id of ["line", "tri", "shelf"] as const) {
      setGuide(id, guideAlpha(t, -1, AXES[id].t1 - AXES[id].drop - 0.16));
    }
    setGuide("dot", guideAlpha(t, AXES.dot.t0 - 0.35, AXES.dot.t1 - AXES.dot.drop - 0.16));
    lights(lampOn(t));
    return { caption: caption(t) };
  }
  function setGuide(id: PartId, a: number) {
    const g = guides[id];
    if (!g) return;
    (g.material as LineDashedMaterial).opacity = T.guideOpacity * a;
    g.visible = a > 0.002;
  }

  function loop(tau: number, ramp: boolean): FrameInfo {
    const cam = loopCameraAt(tau, ramp);
    orbit(lock, lockDistance(), cam.yawDeg, cam.pitchDeg);
    lights(1);
    return { caption: { alpha: 0, x: 0, y: 0, fontPx: 0 } };
  }

  setSize(1, 1);
  reset();
  lights(1);

  return {
    scene,
    camera,
    setSize,
    draw(plan) {
      reset();
      const info = plan.phase === "intro" ? intro(plan.t) : loop(plan.t, plan.ramp === true);
      renderer.render(scene, camera);
      return info;
    },
    compile: async () => {
      await renderer.compileAsync(scene, camera);
    },
    dispose() {
      for (const d of disposables) d.dispose();
      scene.clear();
    },
  };
}
