/**
 * HumanoidAvatar.tsx
 *
 * A real-time 3D humanoid avatar driven by MediaPipe pose landmarks.
 * Body parts are built from scaled unit geometries — no mesh files required.
 *
 * VISIBILITY POLICY
 *   Each body part is shown only when MediaPipe actually detects all its
 *   anchor landmarks with sufficient confidence (staleFrames < SHORT_HOLD_FRAMES).
 *   Parts fade out smoothly (FADE_SPEED per frame) when landmarks are lost,
 *   and fade back in when they reappear.
 *
 *   There is NO inference, NO symmetry mirroring, NO T-pose drift.
 *
 * GEOMETRY TRICK
 *   All limbs reuse the same unit CylinderGeometry(1,1,1) and SphereGeometry(1).
 *   Each frame, mesh.scale is set to (radius, boneLength, radius) for cylinders
 *   or to a uniform radius for spheres.  No geometry is allocated per frame.
 *
 * PROPORTIONS
 *   All radii are a fraction of the live shoulder width so the avatar scales
 *   with the person's distance from the camera.
 */

import { useRef, useEffect, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import { useSmoothLandmarks } from '../hooks/useSmoothLandmarks';
import type { AppearanceColors } from '../hooks/useBodyCapture';

// ── Visibility constants ──────────────────────────────────────────────────────

/** staleFrames must be below this to count as "currently detected". */
const SHORT_HOLD_FRAMES = 8;

/** Lerp factor applied each frame toward target opacity (0 or 1). */
const FADE_SPEED = 0.18;

// ── Default colours ────────────────────────────────────────────────────────────
const DEFAULTS: AppearanceColors = {
  skin:   '#D4956A',
  hair:   '#2E1C0E',
  top:    '#1565C0',
  bottom: '#1A2535',
};

// ── Coordinate conversion ─────────────────────────────────────────────────────
function lm2v(lm: { x: number; y: number; z: number }): THREE.Vector3 {
  return new THREE.Vector3(
    -(lm.x - 0.5) * 3,
    -(lm.y - 0.5) * 3,
    (lm.z ?? 0) * 2,
  );
}

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const _tmp   = new THREE.Vector3();

function avg3(a: THREE.Vector3, b: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
  return out.addVectors(a, b).multiplyScalar(0.5);
}

// ── AvatarBody ────────────────────────────────────────────────────────────────
interface AvatarBodyProps {
  landmarks: NormalizedLandmark[] | null;
  colors: AppearanceColors | null;
}

function AvatarBody({ landmarks, colors }: AvatarBodyProps) {
  const c: AppearanceColors = {
    skin:   colors?.skin   || DEFAULTS.skin,
    hair:   colors?.hair   || DEFAULTS.hair,
    top:    colors?.top    || DEFAULTS.top,
    bottom: colors?.bottom || DEFAULTS.bottom,
  };

  const smoothLM = useSmoothLandmarks();

  const lmRef = useRef(landmarks);
  useEffect(() => { lmRef.current = landmarks; }, [landmarks]);

  // ── Unit geometries ───────────────────────────────────────────────────────
  const cylGeo = useMemo(() => new THREE.CylinderGeometry(1, 1, 1, 12), []);
  const sphGeo = useMemo(() => new THREE.SphereGeometry(1, 16, 12), []);
  const boxGeo = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);

  // ── Per-mesh materials (transparent: true required for opacity animation) ─
  // Each mesh gets its own material instance so opacity can differ per part.
  const mk = (color: string, roughness = 0.65) =>
    new THREE.MeshStandardMaterial({ color, roughness, transparent: true, opacity: 0 });

  const headMat      = useMemo(() => mk(c.skin,    0.70), [c.skin]);
  const hairMat      = useMemo(() => mk(c.hair,    0.85), [c.hair]);
  const neckMat      = useMemo(() => mk(c.skin,    0.70), [c.skin]);
  const torsoMat     = useMemo(() => mk(c.top,     0.55), [c.top]);
  const lUpArmMat    = useMemo(() => mk(c.top,     0.55), [c.top]);
  const rUpArmMat    = useMemo(() => mk(c.top,     0.55), [c.top]);
  const lForeArmMat  = useMemo(() => mk(c.skin,    0.70), [c.skin]);
  const rForeArmMat  = useMemo(() => mk(c.skin,    0.70), [c.skin]);
  const lHandMat     = useMemo(() => mk(c.skin,    0.70), [c.skin]);
  const rHandMat     = useMemo(() => mk(c.skin,    0.70), [c.skin]);
  const lThighMat    = useMemo(() => mk(c.bottom,  0.60), [c.bottom]);
  const rThighMat    = useMemo(() => mk(c.bottom,  0.60), [c.bottom]);
  const lCalfMat     = useMemo(() => mk(c.bottom,  0.60), [c.bottom]);
  const rCalfMat     = useMemo(() => mk(c.bottom,  0.60), [c.bottom]);
  const lFootMat     = useMemo(() => mk('#111111', 0.50), []);
  const rFootMat     = useMemo(() => mk('#111111', 0.50), []);

  // ── Mesh refs ─────────────────────────────────────────────────────────────
  const headRef      = useRef<THREE.Mesh | null>(null);
  const hairCapRef   = useRef<THREE.Mesh | null>(null);
  const neckRef      = useRef<THREE.Mesh | null>(null);
  const torsoRef     = useRef<THREE.Mesh | null>(null);
  const lUpperArmRef = useRef<THREE.Mesh | null>(null);
  const rUpperArmRef = useRef<THREE.Mesh | null>(null);
  const lForearmRef  = useRef<THREE.Mesh | null>(null);
  const rForearmRef  = useRef<THREE.Mesh | null>(null);
  const lHandRef     = useRef<THREE.Mesh | null>(null);
  const rHandRef     = useRef<THREE.Mesh | null>(null);
  const lThighRef    = useRef<THREE.Mesh | null>(null);
  const rThighRef    = useRef<THREE.Mesh | null>(null);
  const lCalfRef     = useRef<THREE.Mesh | null>(null);
  const rCalfRef     = useRef<THREE.Mesh | null>(null);
  const lFootRef     = useRef<THREE.Mesh | null>(null);
  const rFootRef     = useRef<THREE.Mesh | null>(null);

  // ── Opacity state refs (per part, updated in useFrame) ───────────────────
  const oHead     = useRef(0);
  const oHair     = useRef(0);
  const oNeck     = useRef(0);
  const oTorso    = useRef(0);
  const oLUpArm   = useRef(0);
  const oRUpArm   = useRef(0);
  const oLFArm    = useRef(0);
  const oRFArm    = useRef(0);
  const oLHand    = useRef(0);
  const oRHand    = useRef(0);
  const oLThigh   = useRef(0);
  const oRThigh   = useRef(0);
  const oLCalf    = useRef(0);
  const oRCalf    = useRef(0);
  const oLFoot    = useRef(0);
  const oRFoot    = useRef(0);

  // ── Transform helpers ─────────────────────────────────────────────────────
  function setCylinder(
    ref: React.RefObject<THREE.Mesh | null>,
    a: THREE.Vector3, b: THREE.Vector3,
    radius: number,
  ) {
    const m = ref.current; if (!m) return;
    const len = a.distanceTo(b); if (len < 0.001) return;
    _tmp.subVectors(b, a).normalize();
    avg3(a, b, m.position);
    m.scale.set(radius, len, radius);
    m.quaternion.setFromUnitVectors(Y_AXIS, _tmp);
  }

  function setSphere(ref: React.RefObject<THREE.Mesh | null>, pos: THREE.Vector3, radius: number) {
    const m = ref.current; if (!m) return;
    m.position.copy(pos);
    m.scale.setScalar(Math.max(radius, 0.01));
  }

  /**
   * Fade a material toward target opacity.
   * Returns the new opacity (also writes to the opRef).
   */
  function fade(
    opRef: React.MutableRefObject<number>,
    mat: THREE.MeshStandardMaterial,
    target: number,
  ) {
    opRef.current += (target - opRef.current) * FADE_SPEED;
    const op = Math.max(0, Math.min(1, opRef.current));
    mat.opacity = op;
    // Disable object entirely when fully invisible to skip rasterization
    if (mat.opacity < 0.01 && target === 0) mat.visible = false;
    else mat.visible = true;
    return op;
  }

  // ── Animation loop ────────────────────────────────────────────────────────
  useFrame(() => {
    const smoothed = smoothLM.update(lmRef.current);

    // Helper: true if landmark[i] has staleFrames < SHORT_HOLD_FRAMES
    const conf = (i: number) => smoothed[i]?.staleFrames < SHORT_HOLD_FRAMES;

    // Convert to 3D positions
    const p = smoothed.map(lm2v);

    const lS = p[11], rS = p[12];
    const lE = p[13], rE = p[14];
    const lW = p[15], rW = p[16];
    const lH = p[23], rH = p[24];
    const lK = p[25], rK = p[26];
    const lA = p[27], rA = p[28];
    const lEar = p[7],  rEar = p[8];
    const nose  = p[0];

    const shoulderMid = avg3(lS, rS);
    const hipMid      = avg3(lH, rH);
    const earMid      = avg3(lEar, rEar);

    const sw = Math.max(lS.distanceTo(rS), 0.3);

    // ── Head ──────────────────────────────────────────────────────────────
    const headVisible = conf(0) || (conf(7) && conf(8));
    {
      const earDist    = lEar.distanceTo(rEar);
      const headRadius = Math.max(earDist * 0.56, sw * 0.18);
      const headPos    = earMid.clone().add(new THREE.Vector3(0, headRadius * 0.2, 0.04));
      setSphere(headRef, headPos, headRadius);
      setSphere(hairCapRef, headPos.clone().add(new THREE.Vector3(0, headRadius * 0.48, -0.01)), headRadius * 0.70);
      fade(oHead, headMat, headVisible ? 1 : 0);
      fade(oHair, hairMat, headVisible ? 1 : 0);
    }

    // ── Neck ──────────────────────────────────────────────────────────────
    {
      const neckVisible = conf(11) && conf(12);
      setCylinder(neckRef, shoulderMid, earMid, sw * 0.10);
      fade(oNeck, neckMat, neckVisible ? 1 : 0);
    }

    // ── Torso ─────────────────────────────────────────────────────────────
    {
      const torsoVisible = conf(11) && conf(12) && conf(23) && conf(24);
      setCylinder(torsoRef, shoulderMid, hipMid, sw * 0.36);
      fade(oTorso, torsoMat, torsoVisible ? 1 : 0);
    }

    // ── Arms ──────────────────────────────────────────────────────────────
    const armR = sw * 0.090, forearmR = sw * 0.075;
    setCylinder(lUpperArmRef, lS, lE, armR);
    setCylinder(rUpperArmRef, rS, rE, armR);
    setCylinder(lForearmRef,  lE, lW, forearmR);
    setCylinder(rForearmRef,  rE, rW, forearmR);
    fade(oLUpArm, lUpArmMat,   conf(11) && conf(13) ? 1 : 0);
    fade(oRUpArm, rUpArmMat,   conf(12) && conf(14) ? 1 : 0);
    fade(oLFArm,  lForeArmMat, conf(13) && conf(15) ? 1 : 0);
    fade(oRFArm,  rForeArmMat, conf(14) && conf(16) ? 1 : 0);

    // ── Hands ─────────────────────────────────────────────────────────────
    const handR = sw * 0.065;
    setSphere(lHandRef, lW, handR);
    setSphere(rHandRef, rW, handR);
    fade(oLHand, lHandMat, conf(15) ? 1 : 0);
    fade(oRHand, rHandMat, conf(16) ? 1 : 0);

    // ── Legs ──────────────────────────────────────────────────────────────
    const thighR = sw * 0.115, calfR = sw * 0.090;
    setCylinder(lThighRef, lH, lK, thighR);
    setCylinder(rThighRef, rH, rK, thighR);
    setCylinder(lCalfRef,  lK, lA, calfR);
    setCylinder(rCalfRef,  rK, rA, calfR);
    fade(oLThigh, lThighMat, conf(23) && conf(25) ? 1 : 0);
    fade(oRThigh, rThighMat, conf(24) && conf(26) ? 1 : 0);
    fade(oLCalf,  lCalfMat,  conf(25) && conf(27) ? 1 : 0);
    fade(oRCalf,  rCalfMat,  conf(26) && conf(28) ? 1 : 0);

    // ── Feet ──────────────────────────────────────────────────────────────
    const fh = sw * 0.09;
    const lFm = lFootRef.current;
    if (lFm) { lFm.position.copy(lA); lFm.scale.set(fh, fh * 0.45, fh * 1.5); }
    const rFm = rFootRef.current;
    if (rFm) { rFm.position.copy(rA); rFm.scale.set(fh, fh * 0.45, fh * 1.5); }
    fade(oLFoot, lFootMat, conf(27) ? 1 : 0);
    fade(oRFoot, rFootMat, conf(28) ? 1 : 0);
  });

  return (
    <group>
      <mesh ref={headRef}      geometry={sphGeo} material={headMat} />
      <mesh ref={hairCapRef}   geometry={sphGeo} material={hairMat} />
      <mesh ref={neckRef}      geometry={cylGeo} material={neckMat} />
      <mesh ref={torsoRef}     geometry={cylGeo} material={torsoMat} />
      <mesh ref={lUpperArmRef} geometry={cylGeo} material={lUpArmMat} />
      <mesh ref={rUpperArmRef} geometry={cylGeo} material={rUpArmMat} />
      <mesh ref={lForearmRef}  geometry={cylGeo} material={lForeArmMat} />
      <mesh ref={rForearmRef}  geometry={cylGeo} material={rForeArmMat} />
      <mesh ref={lHandRef}     geometry={sphGeo} material={lHandMat} />
      <mesh ref={rHandRef}     geometry={sphGeo} material={rHandMat} />
      <mesh ref={lThighRef}    geometry={cylGeo} material={lThighMat} />
      <mesh ref={rThighRef}    geometry={cylGeo} material={rThighMat} />
      <mesh ref={lCalfRef}     geometry={cylGeo} material={lCalfMat} />
      <mesh ref={rCalfRef}     geometry={cylGeo} material={rCalfMat} />
      <mesh ref={lFootRef}     geometry={boxGeo} material={lFootMat} />
      <mesh ref={rFootRef}     geometry={boxGeo} material={rFootMat} />
    </group>
  );
}

// ── Public component ──────────────────────────────────────────────────────────
interface Props {
  landmarks: NormalizedLandmark[] | null;
  colors: AppearanceColors | null;
}

export function HumanoidAvatar({ landmarks, colors }: Props) {
  return (
    <Canvas
      camera={{ position: [0, 0, 4], fov: 50 }}
      style={{ background: 'transparent' }}
    >
      <ambientLight intensity={0.65} />
      <directionalLight position={[3, 5, 3]}  intensity={1.1} />
      <directionalLight position={[-3, 2, -2]} intensity={0.3} />
      <pointLight       position={[0, -2, 2]}  intensity={0.3} color="#7c4dff" />

      <AvatarBody landmarks={landmarks} colors={colors} />

      <OrbitControls enablePan={false} enableZoom />
      <gridHelper args={[6, 12, '#2a2a3a', '#1a1a2a']} position={[0, -1.8, 0]} />
    </Canvas>
  );
}
