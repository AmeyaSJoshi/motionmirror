/**
 * bodyRegions.ts
 *
 * Defines how each body part is identified from MediaPipe landmarks,
 * how wide its crop should be relative to the bone length, and in what
 * order to draw it (lower zOrder = drawn first = behind other parts).
 *
 * Each BodyPartDef describes a single "bone segment" of the puppet:
 *   - getA / getB: functions that pull the two endpoint landmarks from
 *     the landmark array (supports computed midpoints, e.g. for the torso)
 *   - widthRatio: cropWidth = boneLength * widthRatio
 *   - padRatio: extra length padding added beyond each endpoint before cropping
 *   - zOrder: painting order (0 = back, 3 = front)
 */

import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import { LANDMARK_INDICES as L } from './poseConstants';

export interface BodyPartDef {
  id: string;
  getA: (lm: NormalizedLandmark[]) => NormalizedLandmark;
  getB: (lm: NormalizedLandmark[]) => NormalizedLandmark;
  widthRatio: number;
  padRatio: number;
  zOrder: number;
}

// Average two landmarks — used to synthesise the torso's top/bottom midpoints
function mid(a: NormalizedLandmark, b: NormalizedLandmark): NormalizedLandmark {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: (a.z + b.z) / 2,
    visibility: Math.min(a.visibility ?? 1, b.visibility ?? 1),
  };
}

export const BODY_PART_DEFS: BodyPartDef[] = [
  // ── Torso ───────────────────────────────────────────────────────────────
  // Bone runs from shoulder-midpoint down to hip-midpoint.
  // Wide crop (1.4×) so the full chest/abdomen is captured.
  {
    id: 'torso',
    getA: lm => mid(lm[L.LEFT_SHOULDER], lm[L.RIGHT_SHOULDER]),
    getB: lm => mid(lm[L.LEFT_HIP],      lm[L.RIGHT_HIP]),
    widthRatio: 1.4,
    padRatio:   0.12,
    zOrder: 0,
  },

  // ── Legs (drawn before arms so arms appear on top) ─────────────────────
  {
    id: 'left_thigh',
    getA: lm => lm[L.LEFT_HIP],
    getB: lm => lm[L.LEFT_KNEE],
    widthRatio: 0.60,
    padRatio:   0.08,
    zOrder: 1,
  },
  {
    id: 'right_thigh',
    getA: lm => lm[L.RIGHT_HIP],
    getB: lm => lm[L.RIGHT_KNEE],
    widthRatio: 0.60,
    padRatio:   0.08,
    zOrder: 1,
  },
  {
    id: 'left_calf',
    getA: lm => lm[L.LEFT_KNEE],
    getB: lm => lm[L.LEFT_ANKLE],
    widthRatio: 0.50,
    padRatio:   0.08,
    zOrder: 1,
  },
  {
    id: 'right_calf',
    getA: lm => lm[L.RIGHT_KNEE],
    getB: lm => lm[L.RIGHT_ANKLE],
    widthRatio: 0.50,
    padRatio:   0.08,
    zOrder: 1,
  },

  // ── Arms ────────────────────────────────────────────────────────────────
  {
    id: 'left_upper_arm',
    getA: lm => lm[L.LEFT_SHOULDER],
    getB: lm => lm[L.LEFT_ELBOW],
    widthRatio: 0.52,
    padRatio:   0.10,
    zOrder: 2,
  },
  {
    id: 'right_upper_arm',
    getA: lm => lm[L.RIGHT_SHOULDER],
    getB: lm => lm[L.RIGHT_ELBOW],
    widthRatio: 0.52,
    padRatio:   0.10,
    zOrder: 2,
  },
  {
    id: 'left_forearm',
    getA: lm => lm[L.LEFT_ELBOW],
    getB: lm => lm[L.LEFT_WRIST],
    widthRatio: 0.44,
    padRatio:   0.10,
    zOrder: 2,
  },
  {
    id: 'right_forearm',
    getA: lm => lm[L.RIGHT_ELBOW],
    getB: lm => lm[L.RIGHT_WRIST],
    widthRatio: 0.44,
    padRatio:   0.10,
    zOrder: 2,
  },

  // ── Head ────────────────────────────────────────────────────────────────
  // Bone runs from the ear-midpoint toward the nose; the wide crop
  // and generous padding capture the whole head/neck area.
  {
    id: 'head',
    getA: lm => mid(lm[L.LEFT_EAR], lm[L.RIGHT_EAR]),
    getB: lm => lm[L.NOSE],
    widthRatio: 2.2,
    padRatio:   1.0,
    zOrder: 3,
  },
];
