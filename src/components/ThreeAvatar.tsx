import { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import { AVATAR_JOINTS, AVATAR_BONES } from '../utils/poseConstants';

// Convert a normalized MediaPipe landmark [0,1] to Three.js world coords.
// MediaPipe: x→right, y→down, z→depth(toward cam = negative)
// We map to a roughly 2-unit tall figure centered at origin.
function landmarkToVec3(lm: NormalizedLandmark): THREE.Vector3 {
  // Flip x (mirror) and y (screen→world up), scale to viewport
  return new THREE.Vector3(
    -(lm.x - 0.5) * 3,
    -(lm.y - 0.5) * 3,
    lm.z * 2
  );
}

interface AvatarMeshProps {
  landmarks: NormalizedLandmark[] | null;
}

function AvatarMesh({ landmarks }: AvatarMeshProps) {
  const groupRef = useRef<THREE.Group>(null);

  // Smooth landmark positions with lerp each frame
  const smoothedPositions = useRef<THREE.Vector3[]>([]);

  useFrame(() => {
    if (!landmarks) return;
    if (smoothedPositions.current.length === 0) {
      smoothedPositions.current = landmarks.map(lm => landmarkToVec3(lm));
    } else {
      landmarks.forEach((lm, i) => {
        const target = landmarkToVec3(lm);
        smoothedPositions.current[i]?.lerp(target, 0.3);
      });
    }

    const g = groupRef.current;
    if (!g) return;

    // Update joint spheres (first N children)
    let childIdx = 0;
    for (const idx of AVATAR_JOINTS) {
      const pos = smoothedPositions.current[idx];
      if (pos && g.children[childIdx]) {
        g.children[childIdx].position.copy(pos);
      }
      childIdx++;
    }

    // Update bone cylinders (remaining children)
    for (const [aIdx, bIdx] of AVATAR_BONES) {
      const posA = smoothedPositions.current[aIdx];
      const posB = smoothedPositions.current[bIdx];
      const child = g.children[childIdx];
      if (!posA || !posB || !child) { childIdx++; continue; }

      const mid = posA.clone().add(posB).multiplyScalar(0.5);
      child.position.copy(mid);

      const dir = posB.clone().sub(posA);
      const len = dir.length();
      child.scale.set(1, len, 1);

      // Orient cylinder along bone direction
      // THREE cylinder default axis is Y — rotate to match bone direction
      const axis = new THREE.Vector3(0, 1, 0);
      const q = new THREE.Quaternion().setFromUnitVectors(axis, dir.normalize());
      child.quaternion.copy(q);

      childIdx++;
    }
  });

  // Pre-build geometry once; positions are updated in useFrame
  const jointGeometry = useMemo(() => new THREE.SphereGeometry(0.06, 12, 12), []);
  const boneGeometry = useMemo(() => new THREE.CylinderGeometry(0.025, 0.025, 1, 8), []);
  const jointMaterial = useMemo(() => new THREE.MeshStandardMaterial({ color: '#ff4081', roughness: 0.4 }), []);
  const boneMaterial = useMemo(() => new THREE.MeshStandardMaterial({ color: '#00e5ff', roughness: 0.5, transparent: true, opacity: 0.85 }), []);

  return (
    <group ref={groupRef}>
      {AVATAR_JOINTS.map(idx => (
        <mesh key={`joint-${idx}`} geometry={jointGeometry} material={jointMaterial} />
      ))}
      {AVATAR_BONES.map(([a, b]) => (
        <mesh key={`bone-${a}-${b}`} geometry={boneGeometry} material={boneMaterial} />
      ))}
    </group>
  );
}

function NoSignal() {
  return (
    <mesh>
      <sphereGeometry args={[0.15, 16, 16]} />
      <meshStandardMaterial color="#444" wireframe />
    </mesh>
  );
}

interface Props {
  landmarks: NormalizedLandmark[] | null;
}

export function ThreeAvatar({ landmarks }: Props) {
  return (
    <Canvas
      camera={{ position: [0, 0, 4], fov: 50 }}
      style={{ background: 'transparent' }}
    >
      <ambientLight intensity={0.6} />
      <directionalLight position={[3, 5, 3]} intensity={1.2} />
      <pointLight position={[-3, -3, 2]} intensity={0.4} color="#7c4dff" />

      {landmarks ? <AvatarMesh landmarks={landmarks} /> : <NoSignal />}

      <OrbitControls enablePan={false} enableZoom={true} />

      {/* Grid floor for depth cue */}
      <gridHelper args={[6, 12, '#333', '#222']} position={[0, -1.8, 0]} />
    </Canvas>
  );
}
