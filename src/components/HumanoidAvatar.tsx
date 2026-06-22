/**
 * HumanoidAvatar.tsx
 *
 * A real-time 3D humanoid avatar driven by MediaPipe pose landmarks.
 * Body parts are built from scaled unit geometries — no mesh files required.
 *
 * ── Appearance ────────────────────────────────────────────────────────────────
 *   AppearanceColors sampled from the user's calibration frame are applied to
 *   MeshStandardMaterial instances:
 *     skin   → head, neck, forearms, hands
 *     hair   → hair-cap sphere on top of head
 *     top    → torso, upper arms (shirt colour)
 *     bottom → thighs, calves (pants colour)
 *   Default colours (blue shirt, dark pants, medium skin) are used until the
 *   user captures their appearance.  The captured image is NEVER displayed
 *   directly; only the sampled colour values are applied to the avatar materials.
 *
 * ── Geometry trick ────────────────────────────────────────────────────────────
 *   All limbs reuse the same unit CylinderGeometry(1,1,1) and SphereGeometry(1).
 *   Each frame, mesh.scale is set to (radius, boneLength, radius) for cylinders
 *   or to a uniform radius for spheres.  Quaternion is derived from
 *   setFromUnitVectors(Y_AXIS, boneDirection).  No geometry is allocated per
 *   frame — only Transform updates, which are cheap.
 *
 * ── Proportions ───────────────────────────────────────────────────────────────
 *   All radii are expressed as a fraction of the live shoulder width (distance
 *   between left-shoulder and right-shoulder landmarks in 3D world space).
 *   This keeps the avatar self-scaling: a person closer to the camera produces
 *   wider shoulders and proportionally wider limbs.
 *
 * ── Missing landmarks ─────────────────────────────────────────────────────────
 *   Raw landmarks are passed through useSmoothLandmarks() before use.
 *   That hook handles:
 *     • Exponential lerp smoothing for visible landmarks
 *     • Last-known-good freeze for temporarily invisible ones
 *     • Symmetry mirroring when one side drops out
 *     • Knee/ankle inference below the visible hip (upper-body-only frame)
 *     • Slow T-pose drift for completely absent landmarks
 *
 * ── Hand tracking note ────────────────────────────────────────────────────────
 *   Wrist positions from the pose model are used as hand positions.  A sphere
 *   represents each hand.  Full finger tracking would require a separate
 *   MediaPipe HandLandmarker model; that is a natural next step but is out of
 *   scope for this prototype.
 */

import { useRef, useEffect, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import { useSmoothLandmarks } from '../hooks/useSmoothLandmarks';
import type { AppearanceColors } from '../hooks/useBodyCapture';

// ── Default colours (used before the user captures their appearance) ──────────
const DEFAULTS: AppearanceColors = {
  skin:   '#D4956A',
  hair:   '#2E1C0E',
  top:    '#1565C0',
  bottom: '#1A2535',
};

// ── Coordinate conversion ─────────────────────────────────────────────────────
// Mirrors the transform in ThreeAvatar.tsx so both modes look consistent.
function lm2v(lm: NormalizedLandmark): THREE.Vector3 {
  return new THREE.Vector3(
    -(lm.x - 0.5) * 3,
    -(lm.y - 0.5) * 3,
    (lm.z ?? 0) * 2,
  );
}

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const _tmp   = new THREE.Vector3(); // reusable temp vector (avoids alloc in hot path)

function avg3(a: THREE.Vector3, b: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
  return out.addVectors(a, b).multiplyScalar(0.5);
}

// ── AvatarBody — the actual scene graph ───────────────────────────────────────
interface AvatarBodyProps {
  landmarks: NormalizedLandmark[] | null;
  colors: AppearanceColors | null;
}

function AvatarBody({ landmarks, colors }: AvatarBodyProps) {
  // Merge provided colours with defaults so every field is always a valid string
  const c: AppearanceColors = {
    skin:   (colors?.skin)   || DEFAULTS.skin,
    hair:   (colors?.hair)   || DEFAULTS.hair,
    top:    (colors?.top)    || DEFAULTS.top,
    bottom: (colors?.bottom) || DEFAULTS.bottom,
  };

  const smoothLM = useSmoothLandmarks();

  // Keep a ref to latest raw landmarks for access inside the useFrame closure
  // (avoids stale-closure bugs when landmark state updates asynchronously)
  const lmRef = useRef(landmarks);
  useEffect(() => { lmRef.current = landmarks; }, [landmarks]);

  // ── Shared unit geometries — allocated once, reused by every mesh ─────────
  const cylGeo = useMemo(() => new THREE.CylinderGeometry(1, 1, 1, 12), []);
  const sphGeo = useMemo(() => new THREE.SphereGeometry(1, 16, 12), []);
  const boxGeo = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);

  // ── Materials — one per colour role ──────────────────────────────────────
  const skinMat   = useMemo(() => new THREE.MeshStandardMaterial({ color: c.skin,    roughness: 0.7 }), [c.skin]);
  const topMat    = useMemo(() => new THREE.MeshStandardMaterial({ color: c.top,     roughness: 0.55 }), [c.top]);
  const bottomMat = useMemo(() => new THREE.MeshStandardMaterial({ color: c.bottom,  roughness: 0.60 }), [c.bottom]);
  const hairMat   = useMemo(() => new THREE.MeshStandardMaterial({ color: c.hair,    roughness: 0.85 }), [c.hair]);
  const footMat   = useMemo(() => new THREE.MeshStandardMaterial({ color: '#111111', roughness: 0.5 }), []);

  // ── Per-part mesh refs ────────────────────────────────────────────────────
  const headRef      = useRef<THREE.Mesh>(null);
  const hairCapRef   = useRef<THREE.Mesh>(null);
  const neckRef      = useRef<THREE.Mesh>(null);
  const torsoRef     = useRef<THREE.Mesh>(null);
  const lUpperArmRef = useRef<THREE.Mesh>(null);
  const rUpperArmRef = useRef<THREE.Mesh>(null);
  const lForearmRef  = useRef<THREE.Mesh>(null);
  const rForearmRef  = useRef<THREE.Mesh>(null);
  const lHandRef     = useRef<THREE.Mesh>(null);
  const rHandRef     = useRef<THREE.Mesh>(null);
  const lThighRef    = useRef<THREE.Mesh>(null);
  const rThighRef    = useRef<THREE.Mesh>(null);
  const lCalfRef     = useRef<THREE.Mesh>(null);
  const rCalfRef     = useRef<THREE.Mesh>(null);
  const lFootRef     = useRef<THREE.Mesh>(null);
  const rFootRef     = useRef<THREE.Mesh>(null);

  // ── Transform helpers ─────────────────────────────────────────────────────

  /**
   * Position a cylinder mesh along the bone from point A to point B.
   * Scale Y to bone length, scale X/Z to radius, rotate Y_AXIS → direction.
   */
  function setCylinder(
    ref: React.RefObject<THREE.Mesh | null>,
    a: THREE.Vector3,
    b: THREE.Vector3,
    radius: number,
  ) {
    const m = ref.current; if (!m) return;
    const len = a.distanceTo(b);  if (len < 0.001) return;
    _tmp.subVectors(b, a).normalize();
    avg3(a, b, m.position);
    m.scale.set(radius, len, radius);
    m.quaternion.setFromUnitVectors(Y_AXIS, _tmp);
  }

  /** Position a sphere mesh and set its uniform radius via scale. */
  function setSphere(ref: React.RefObject<THREE.Mesh | null>, pos: THREE.Vector3, radius: number) {
    const m = ref.current; if (!m) return;
    m.position.copy(pos);
    m.scale.setScalar(Math.max(radius, 0.01));
  }

  // ── Animation loop — runs every rendered frame ────────────────────────────
  useFrame(() => {
    // Smooth and infer missing landmarks before converting to 3D
    const smoothed = smoothLM.update(lmRef.current);
    const p = smoothed.map(lm2v);  // p[i] = 3D world position of landmark i

    // Named landmark positions
    const lS = p[11], rS = p[12];  // shoulders
    const lE = p[13], rE = p[14];  // elbows
    const lW = p[15], rW = p[16];  // wrists
    const lH = p[23], rH = p[24];  // hips
    const lK = p[25], rK = p[26];  // knees
    const lA = p[27], rA = p[28];  // ankles
    const lEar = p[7],  rEar = p[8];

    const shoulderMid = avg3(lS, rS);
    const hipMid      = avg3(lH, rH);
    const earMid      = avg3(lEar, rEar);

    // Shoulder width in 3D — drives all proportional radii
    const sw = Math.max(lS.distanceTo(rS), 0.3);

    // ── Head ───────────────────────────────────────────────────────────────
    // Radius is derived from the ear-to-ear distance in 3D space, which is a
    // reliable proxy for head width.  A 0.56× multiplier gives a sphere that
    // covers the full head width at ear level for most people.
    // Minimum is clamped to 18% of shoulder width to handle edge cases where
    // ears are not detected.
    const earDist    = lEar.distanceTo(rEar);
    const headRadius = Math.max(earDist * 0.56, sw * 0.18);

    // Shift the centre slightly up (+Y) and forward (+Z) from the ear midpoint
    // so the sphere sits naturally on top of the neck rather than between the ears.
    const headPos = earMid.clone().add(new THREE.Vector3(0, headRadius * 0.2, 0.04));
    setSphere(headRef, headPos, headRadius);

    // ── Hair cap ───────────────────────────────────────────────────────────
    // A slightly smaller sphere positioned above the head centre, coloured with
    // the sampled hair colour.  It peeks above the skin sphere to simulate a
    // hair region without needing a separate hair mesh.
    const hairPos = headPos.clone().add(new THREE.Vector3(0, headRadius * 0.48, -0.01));
    setSphere(hairCapRef, hairPos, headRadius * 0.70);

    // ── Neck ───────────────────────────────────────────────────────────────
    // Runs from shoulder midpoint up to the ear midpoint.
    // Radius = 10% of shoulder width ≈ typical neck girth.
    setCylinder(neckRef, shoulderMid, earMid, sw * 0.10);

    // ── Torso ──────────────────────────────────────────────────────────────
    // A cylinder from shoulder-midpoint to hip-midpoint.
    // Radius = 36% of shoulder width gives a believable trunk girth.
    setCylinder(torsoRef, shoulderMid, hipMid, sw * 0.36);

    // ── Arms ───────────────────────────────────────────────────────────────
    // Upper arms share the shirt colour; forearms show skin (rolled sleeves).
    const armR     = sw * 0.090;
    const forearmR = sw * 0.075;
    setCylinder(lUpperArmRef, lS, lE, armR);
    setCylinder(rUpperArmRef, rS, rE, armR);
    setCylinder(lForearmRef,  lE, lW, forearmR);
    setCylinder(rForearmRef,  rE, rW, forearmR);

    // ── Hands ──────────────────────────────────────────────────────────────
    // Simple sphere at the wrist landmark.  For full finger tracking, load
    // MediaPipe HandLandmarker in parallel and map the 21-point hand skeleton
    // to finger cylinder meshes — a natural next improvement.
    const handR = sw * 0.065;
    setSphere(lHandRef, lW, handR);
    setSphere(rHandRef, rW, handR);

    // ── Legs ───────────────────────────────────────────────────────────────
    // Thigh radius is slightly wider than calf (tapered leg shape).
    const thighR = sw * 0.115;
    const calfR  = sw * 0.090;
    setCylinder(lThighRef, lH, lK, thighR);
    setCylinder(rThighRef, rH, rK, thighR);
    setCylinder(lCalfRef,  lK, lA, calfR);
    setCylinder(rCalfRef,  rK, rA, calfR);

    // ── Feet ───────────────────────────────────────────────────────────────
    // Small flat box at the ankle landmark. Depth (Z) is 1.5× width to look
    // like a shoe pointing forward.
    const fh = sw * 0.09;
    const lFm = lFootRef.current;
    if (lFm) { lFm.position.copy(lA); lFm.scale.set(fh, fh * 0.45, fh * 1.5); }
    const rFm = rFootRef.current;
    if (rFm) { rFm.position.copy(rA); rFm.scale.set(fh, fh * 0.45, fh * 1.5); }
  });

  return (
    <group>
      {/* Head */}
      <mesh ref={headRef}    geometry={sphGeo} material={skinMat} />
      <mesh ref={hairCapRef} geometry={sphGeo} material={hairMat} />
      {/* Neck */}
      <mesh ref={neckRef}    geometry={cylGeo} material={skinMat} />
      {/* Torso */}
      <mesh ref={torsoRef}   geometry={cylGeo} material={topMat} />
      {/* Arms — upper arms share shirt colour; forearms show skin */}
      <mesh ref={lUpperArmRef} geometry={cylGeo} material={topMat} />
      <mesh ref={rUpperArmRef} geometry={cylGeo} material={topMat} />
      <mesh ref={lForearmRef}  geometry={cylGeo} material={skinMat} />
      <mesh ref={rForearmRef}  geometry={cylGeo} material={skinMat} />
      {/* Hands */}
      <mesh ref={lHandRef} geometry={sphGeo} material={skinMat} />
      <mesh ref={rHandRef} geometry={sphGeo} material={skinMat} />
      {/* Legs */}
      <mesh ref={lThighRef} geometry={cylGeo} material={bottomMat} />
      <mesh ref={rThighRef} geometry={cylGeo} material={bottomMat} />
      <mesh ref={lCalfRef}  geometry={cylGeo} material={bottomMat} />
      <mesh ref={rCalfRef}  geometry={cylGeo} material={bottomMat} />
      {/* Feet */}
      <mesh ref={lFootRef} geometry={boxGeo} material={footMat} />
      <mesh ref={rFootRef} geometry={boxGeo} material={footMat} />
    </group>
  );
}

// ── Public component — wraps AvatarBody in its own Canvas ────────────────────
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
      <directionalLight position={[3, 5, 3]}   intensity={1.1} />
      <directionalLight position={[-3, 2, -2]}  intensity={0.3} />
      <pointLight       position={[0, -2, 2]}   intensity={0.3} color="#7c4dff" />

      <AvatarBody landmarks={landmarks} colors={colors} />

      <OrbitControls enablePan={false} enableZoom />
      <gridHelper args={[6, 12, '#2a2a3a', '#1a1a2a']} position={[0, -1.8, 0]} />
    </Canvas>
  );
}
