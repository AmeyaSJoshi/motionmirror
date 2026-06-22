/**
 * HumanoidAvatar.tsx
 *
 * A real-time 3D humanoid avatar driven by MediaPipe pose landmarks.
 * Body parts are built from scaled unit geometries — no mesh files required.
 *
 * ── VISIBILITY POLICY ─────────────────────────────────────────────────────────
 *   Each body part is shown only when MediaPipe detects all its anchor
 *   landmarks with sufficient confidence (staleFrames < SHORT_HOLD_FRAMES).
 *   Parts fade out smoothly (FADE_SPEED per frame) when landmarks are lost.
 *   There is NO inference, NO mirroring, NO T-pose drift.
 *
 *   The hiddenParts prop lets the caller force-hide named groups
 *   ('lArm' | 'rArm' | 'legs' | 'hands') independently of landmark confidence.
 *   This is used for the debug toggle buttons in App.tsx.
 *
 * ── GEOMETRY TRICK ────────────────────────────────────────────────────────────
 *   All limbs reuse the same unit CylinderGeometry(1,1,1) and SphereGeometry(1).
 *   Each frame mesh.scale is set to (radius, boneLength, radius) for cylinders
 *   or to a uniform radius for spheres.  No geometry is allocated per frame.
 *
 * ── NECK / HEAD PROPORTIONS ───────────────────────────────────────────────────
 *   MediaPipe ear landmarks (7, 8) sit at approximately head-midline height —
 *   roughly 60-70% of the way up the head.  Using them as the raw neck endpoint
 *   produced a neck that was ~4× too long (≈60% of shoulder width vs ~15% for
 *   a real human neck).
 *
 *   Fix: we compute the raw neck direction (shoulderMid → earMid) but CLAMP the
 *   length to at most MAX_NECK_LENGTH_RATIO * sw, then scale it down further by
 *   NECK_LENGTH_MULTIPLIER.  This gives a capped neck of ≈15% shoulder width
 *   regardless of how far apart the landmark positions are in 3D space.
 *
 *   The head sphere is then positioned above the computed neckTop — it is NOT
 *   placed at earMid.  HEAD_Y_OFFSET_MULTIPLIER controls how far above neckTop
 *   the head center sits as a fraction of headRadius.
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

// ── Neck / head tuning constants ─────────────────────────────────────────────
// These are applied every frame inside useFrame so changing them here
// immediately changes the rendered output.

/**
 * Raw neck direction is shoulderMid → earMid.
 * We scale the raw distance by this multiplier first.
 * 0.35 = keep only 35% of the landmark-derived neck height.
 */
const NECK_LENGTH_MULTIPLIER = 0.35;

/**
 * Hard cap: neck length cannot exceed this fraction of shoulder width.
 * A human neck is roughly 15-18% of shoulder width.
 */
const MAX_NECK_LENGTH_RATIO = 0.18;

/**
 * Head sphere radius multiplier applied on top of the ear-distance estimate.
 * 1.25 makes the head slightly larger so it looks proportional after the neck
 * is shortened (smaller neck → head needs to not look pinhead-tiny).
 */
const HEAD_SCALE_MULTIPLIER = 1.25;

/**
 * Head center Y offset above neckTop, expressed as a fraction of headRadius.
 * Positive = further up, negative = closer to neckTop.
 * -0.15 means the head center sits 0.85 × headRadius above neckTop, so the
 * bottom of the head sphere overlaps the neck tip slightly — looks connected.
 */
const HEAD_Y_OFFSET_MULTIPLIER = -0.15;

// ── Default colours ───────────────────────────────────────────────────────────
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

export type HiddenPart = 'lArm' | 'rArm' | 'legs' | 'hands';

// ── AvatarBody ────────────────────────────────────────────────────────────────
interface AvatarBodyProps {
  landmarks: NormalizedLandmark[] | null;
  colors: AppearanceColors | null;
  hiddenParts: Set<HiddenPart>;
}

function AvatarBody({ landmarks, colors, hiddenParts }: AvatarBodyProps) {
  const c: AppearanceColors = {
    skin:   colors?.skin   || DEFAULTS.skin,
    hair:   colors?.hair   || DEFAULTS.hair,
    top:    colors?.top    || DEFAULTS.top,
    bottom: colors?.bottom || DEFAULTS.bottom,
  };

  const smoothLM = useSmoothLandmarks();

  const lmRef = useRef(landmarks);
  useEffect(() => { lmRef.current = landmarks; }, [landmarks]);

  const hiddenRef = useRef(hiddenParts);
  useEffect(() => { hiddenRef.current = hiddenParts; }, [hiddenParts]);

  // ── Unit geometries — allocated once ────────────────────────────────────
  const cylGeo = useMemo(() => new THREE.CylinderGeometry(1, 1, 1, 12), []);
  const sphGeo = useMemo(() => new THREE.SphereGeometry(1, 16, 12), []);
  const boxGeo = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);

  // ── Per-mesh materials (transparent: true required for opacity animation) ─
  const mk = (color: string, roughness = 0.65) =>
    new THREE.MeshStandardMaterial({ color, roughness, transparent: true, opacity: 0 });

  const headMat     = useMemo(() => mk(c.skin,    0.70), [c.skin]);
  const hairMat     = useMemo(() => mk(c.hair,    0.85), [c.hair]);
  const neckMat     = useMemo(() => mk(c.skin,    0.70), [c.skin]);
  const torsoMat    = useMemo(() => mk(c.top,     0.55), [c.top]);
  const lUpArmMat   = useMemo(() => mk(c.top,     0.55), [c.top]);
  const rUpArmMat   = useMemo(() => mk(c.top,     0.55), [c.top]);
  const lFArmMat    = useMemo(() => mk(c.skin,    0.70), [c.skin]);
  const rFArmMat    = useMemo(() => mk(c.skin,    0.70), [c.skin]);
  const lHandMat    = useMemo(() => mk(c.skin,    0.70), [c.skin]);
  const rHandMat    = useMemo(() => mk(c.skin,    0.70), [c.skin]);
  const lThighMat   = useMemo(() => mk(c.bottom,  0.60), [c.bottom]);
  const rThighMat   = useMemo(() => mk(c.bottom,  0.60), [c.bottom]);
  const lCalfMat    = useMemo(() => mk(c.bottom,  0.60), [c.bottom]);
  const rCalfMat    = useMemo(() => mk(c.bottom,  0.60), [c.bottom]);
  const lFootMat    = useMemo(() => mk('#111111', 0.50), []);
  const rFootMat    = useMemo(() => mk('#111111', 0.50), []);

  // ── Mesh refs ────────────────────────────────────────────────────────────
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

  // ── Opacity state (per part, 0–1, interpolated each frame) ───────────────
  const oHead   = useRef(0); const oHair   = useRef(0);
  const oNeck   = useRef(0); const oTorso  = useRef(0);
  const oLUpArm = useRef(0); const oRUpArm = useRef(0);
  const oLFArm  = useRef(0); const oRFArm  = useRef(0);
  const oLHand  = useRef(0); const oRHand  = useRef(0);
  const oLThigh = useRef(0); const oRThigh = useRef(0);
  const oLCalf  = useRef(0); const oRCalf  = useRef(0);
  const oLFoot  = useRef(0); const oRFoot  = useRef(0);

  // ── Transform helpers ─────────────────────────────────────────────────────
  function setCylinder(
    ref: React.RefObject<THREE.Mesh | null>,
    a: THREE.Vector3, b: THREE.Vector3, radius: number,
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
   * Lerp part opacity toward target (0 or 1) and apply to BOTH the material
   * and the mesh's Object3D.visible flag so Three.js actually skips rendering
   * when invisible.
   *
   * NOTE: THREE.Material has no .visible property — visibility must be set on
   * the mesh (THREE.Object3D), not on the material.  The previous version
   * incorrectly set mat.visible, which Three.js silently ignored.
   */
  function fade(
    opRef: React.MutableRefObject<number>,
    mat: THREE.MeshStandardMaterial,
    mesh: THREE.Mesh | null,
    target: number,
  ) {
    opRef.current += (target - opRef.current) * FADE_SPEED;
    const op = Math.max(0, Math.min(1, opRef.current));
    mat.opacity = op;
    if (mesh) mesh.visible = op > 0.01;
  }

  // ── Animation loop ────────────────────────────────────────────────────────
  useFrame(() => {
    const smoothed = smoothLM.update(lmRef.current);
    const hidden   = hiddenRef.current;

    // conf(i): landmark i was confidently detected this frame
    const conf = (i: number) => smoothed[i]?.staleFrames < SHORT_HOLD_FRAMES;

    const p = smoothed.map(lm2v);

    const lS = p[11], rS = p[12];
    const lE = p[13], rE = p[14];
    const lW = p[15], rW = p[16];
    const lH = p[23], rH = p[24];
    const lK = p[25], rK = p[26];
    const lA = p[27], rA = p[28];
    const lEar = p[7], rEar = p[8];

    const shoulderMid = avg3(lS, rS);
    const hipMid      = avg3(lH, rH);
    const earMid      = avg3(lEar, rEar);

    // Shoulder width in 3D — drives all proportional radii
    const sw = Math.max(lS.distanceTo(rS), 0.3);

    // ── Neck — compute clamped endpoint ────────────────────────────────────
    //
    // Problem: earMid is at head-midline height (~60% up the head), so the
    // raw distance shoulderMid→earMid = full neck + most of the head height,
    // producing a neck that is ~60% of shoulder width (4× too long).
    //
    // Fix: take only NECK_LENGTH_MULTIPLIER (35%) of the raw distance, then
    // cap it at MAX_NECK_LENGTH_RATIO (18%) of shoulder width.  The result is
    // a neck of ~13-18% of shoulder width, matching real human proportions.
    const rawNeckLen = shoulderMid.distanceTo(earMid);
    const scaledNeck = rawNeckLen * NECK_LENGTH_MULTIPLIER;
    const cappedNeck = Math.min(scaledNeck, MAX_NECK_LENGTH_RATIO * sw);
    const neckDir    = _tmp.subVectors(earMid, shoulderMid).normalize();
    const neckTop    = shoulderMid.clone().addScaledVector(neckDir, cappedNeck);

    // ── Head — placed above neckTop, NOT at earMid ─────────────────────────
    //
    // Ear-to-ear distance is a reliable proxy for head width.  0.56× converts
    // it to head radius.  HEAD_SCALE_MULTIPLIER (1.25) slightly enlarges the
    // head since a shorter neck makes the head look proportionally smaller.
    //
    // HEAD_Y_OFFSET_MULTIPLIER (-0.15) moves the head center to
    //   neckTop + headRadius * (1 + -0.15) = neckTop + 0.85 * headRadius
    // so the bottom of the sphere overlaps the neck tip slightly.
    const earDist    = lEar.distanceTo(rEar);
    const headRadius = Math.max(earDist * 0.56, sw * 0.18) * HEAD_SCALE_MULTIPLIER;
    const headOffset = headRadius * (1 + HEAD_Y_OFFSET_MULTIPLIER); // 0.85 * r
    const headPos    = neckTop.clone().addScaledVector(neckDir, headOffset);

    const headVisible = conf(0) || (conf(7) && conf(8));
    setSphere(headRef,    headPos, headRadius);
    setSphere(hairCapRef, headPos.clone().addScaledVector(neckDir, headRadius * 0.40), headRadius * 0.75);
    fade(oHead, headMat, headRef.current,    headVisible ? 1 : 0);
    fade(oHair, hairMat, hairCapRef.current, headVisible ? 1 : 0);

    // ── Neck ──────────────────────────────────────────────────────────────
    setCylinder(neckRef, shoulderMid, neckTop, sw * 0.10);
    fade(oNeck, neckMat, neckRef.current, (conf(11) && conf(12)) ? 1 : 0);

    // ── Torso ─────────────────────────────────────────────────────────────
    setCylinder(torsoRef, shoulderMid, hipMid, sw * 0.36);
    fade(oTorso, torsoMat, torsoRef.current,
      (conf(11) && conf(12) && conf(23) && conf(24)) ? 1 : 0);

    // ── Arms ──────────────────────────────────────────────────────────────
    const armR = sw * 0.090, forearmR = sw * 0.075;
    setCylinder(lUpperArmRef, lS, lE, armR);
    setCylinder(rUpperArmRef, rS, rE, armR);
    setCylinder(lForearmRef,  lE, lW, forearmR);
    setCylinder(rForearmRef,  rE, rW, forearmR);
    fade(oLUpArm, lUpArmMat, lUpperArmRef.current, (!hidden.has('lArm') && conf(11) && conf(13)) ? 1 : 0);
    fade(oRUpArm, rUpArmMat, rUpperArmRef.current, (!hidden.has('rArm') && conf(12) && conf(14)) ? 1 : 0);
    fade(oLFArm,  lFArmMat,  lForearmRef.current,  (!hidden.has('lArm') && conf(13) && conf(15)) ? 1 : 0);
    fade(oRFArm,  rFArmMat,  rForearmRef.current,  (!hidden.has('rArm') && conf(14) && conf(16)) ? 1 : 0);

    // ── Hands ─────────────────────────────────────────────────────────────
    const handR = sw * 0.065;
    setSphere(lHandRef, lW, handR);
    setSphere(rHandRef, rW, handR);
    fade(oLHand, lHandMat, lHandRef.current, (!hidden.has('hands') && conf(15)) ? 1 : 0);
    fade(oRHand, rHandMat, rHandRef.current, (!hidden.has('hands') && conf(16)) ? 1 : 0);

    // ── Legs ──────────────────────────────────────────────────────────────
    const thighR = sw * 0.115, calfR = sw * 0.090;
    setCylinder(lThighRef, lH, lK, thighR);
    setCylinder(rThighRef, rH, rK, thighR);
    setCylinder(lCalfRef,  lK, lA, calfR);
    setCylinder(rCalfRef,  rK, rA, calfR);
    fade(oLThigh, lThighMat, lThighRef.current, (!hidden.has('legs') && conf(23) && conf(25)) ? 1 : 0);
    fade(oRThigh, rThighMat, rThighRef.current, (!hidden.has('legs') && conf(24) && conf(26)) ? 1 : 0);
    fade(oLCalf,  lCalfMat,  lCalfRef.current,  (!hidden.has('legs') && conf(25) && conf(27)) ? 1 : 0);
    fade(oRCalf,  rCalfMat,  rCalfRef.current,  (!hidden.has('legs') && conf(26) && conf(28)) ? 1 : 0);

    // ── Feet ──────────────────────────────────────────────────────────────
    const fh = sw * 0.09;
    const lFm = lFootRef.current;
    if (lFm) { lFm.position.copy(lA); lFm.scale.set(fh, fh * 0.45, fh * 1.5); }
    const rFm = rFootRef.current;
    if (rFm) { rFm.position.copy(rA); rFm.scale.set(fh, fh * 0.45, fh * 1.5); }
    fade(oLFoot, lFootMat, lFootRef.current, (!hidden.has('legs') && conf(27)) ? 1 : 0);
    fade(oRFoot, rFootMat, rFootRef.current, (!hidden.has('legs') && conf(28)) ? 1 : 0);
  });

  return (
    <group>
      <mesh ref={headRef}      geometry={sphGeo} material={headMat} />
      <mesh ref={hairCapRef}   geometry={sphGeo} material={hairMat} />
      <mesh ref={neckRef}      geometry={cylGeo} material={neckMat} />
      <mesh ref={torsoRef}     geometry={cylGeo} material={torsoMat} />
      <mesh ref={lUpperArmRef} geometry={cylGeo} material={lUpArmMat} />
      <mesh ref={rUpperArmRef} geometry={cylGeo} material={rUpArmMat} />
      <mesh ref={lForearmRef}  geometry={cylGeo} material={lFArmMat} />
      <mesh ref={rForearmRef}  geometry={cylGeo} material={rFArmMat} />
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
  hiddenParts: Set<HiddenPart>;
}

export function HumanoidAvatar({ landmarks, colors, hiddenParts }: Props) {
  return (
    <Canvas
      camera={{ position: [0, 0, 4], fov: 50 }}
      style={{ background: 'transparent' }}
    >
      <ambientLight intensity={0.65} />
      <directionalLight position={[3, 5, 3]}  intensity={1.1} />
      <directionalLight position={[-3, 2, -2]} intensity={0.3} />
      <pointLight       position={[0, -2, 2]}  intensity={0.3} color="#7c4dff" />

      <AvatarBody landmarks={landmarks} colors={colors} hiddenParts={hiddenParts} />

      <OrbitControls enablePan={false} enableZoom />
      <gridHelper args={[6, 12, '#2a2a3a', '#1a1a2a']} position={[0, -1.8, 0]} />
    </Canvas>
  );
}
