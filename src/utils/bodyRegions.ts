/**
 * bodyRegions.ts
 *
 * Defines how each body part maps to MediaPipe landmarks and how its crop
 * rectangle is sized relative to the bone length.
 *
 * ── BodyPartDef fields ───────────────────────────────────────────────────────
 *   getA / getB   Functions returning the two endpoint landmarks.
 *                 Supports computed midpoints (e.g. shoulder-midpoint for torso).
 *   widthRatio    cropWidth  = boneLength * widthRatio
 *   padRatio      extra padding added beyond each endpoint: padPx = boneLen * padRatio
 *   zOrder        Paint order — lower = behind (torso: 0, head: 3)
 *
 * ── Head sizing rationale ────────────────────────────────────────────────────
 *   The original head "bone" (ear-midpoint → nose) is only ~half-face height,
 *   so the crop came out too small and sat too high.
 *
 *   New approach:
 *     A = a point above the scalp, estimated by extending the ear→nose vector
 *         upward by HEAD_ABOVE_SCALE × (ear→nose distance).
 *     B = shoulder midpoint — anchors the head/neck crop to the body.
 *
 *   This gives a bone that spans from above the crown down to the neck, matching
 *   how a head/neck segment sits on the torso in real life.
 *
 *   HEAD_SCALE_MULTIPLIER applied in PhotoPuppet.tsx further scales the drawn
 *   head so it reads as proportionally correct even when the torso is large.
 *
 * ── Limb width proportions ───────────────────────────────────────────────────
 *   Upper-arm and thigh widthRatio is set relative to shoulder/hip width:
 *   empirically ~0.50-0.55 for a natural silhouette when the bone length is
 *   ~shoulder-to-elbow distance.  Forearms and calves taper slightly.
 */

import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import { LANDMARK_INDICES as L } from './poseConstants';

// ── Tuning constants ──────────────────────────────────────────────────────────

/**
 * Applied in PhotoPuppet.tsx when drawing the head crop.
 * Values 1.35–1.6 give a natural head size relative to the torso.
 * Increase if the head still looks small; decrease if it overlaps the shoulders.
 */
export const HEAD_SCALE_MULTIPLIER = 1.5;

/**
 * How far above the ear→nose midpoint we push the "top of head" anchor.
 * 0.9 ≈ almost one ear→nose length above the ears.
 * Increasing this captures more of the forehead/crown.
 */
const HEAD_ABOVE_SCALE = 0.9;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Average two landmarks (visibility = min of the two). */
function mid(a: NormalizedLandmark, b: NormalizedLandmark): NormalizedLandmark {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: (a.z + b.z) / 2,
    visibility: Math.min(a.visibility ?? 1, b.visibility ?? 1),
  };
}

/**
 * Synthesise an "above-scalp" landmark.
 *
 * Strategy:
 *   earMid → nose defines the face-centre axis pointing downward.
 *   We reverse and extend that direction to estimate where the crown sits.
 *
 *   scalp.x = earMid.x + (-dx) * HEAD_ABOVE_SCALE
 *   scalp.y = earMid.y + (-dy) * HEAD_ABOVE_SCALE
 *
 * where dx/dy = (nose.x - earMid.x) / (nose.y - earMid.y).
 * Because in a front-facing pose nose.y > earMid.y (nose is below ears),
 * -dy pushes us upward — above the crown.
 */
function aboveScalp(lm: NormalizedLandmark[]): NormalizedLandmark {
  const earMid  = mid(lm[L.LEFT_EAR], lm[L.RIGHT_EAR]);
  const nose    = lm[L.NOSE];
  const dx      = nose.x - earMid.x;
  const dy      = nose.y - earMid.y;
  return {
    x: earMid.x - dx * HEAD_ABOVE_SCALE,
    y: earMid.y - dy * HEAD_ABOVE_SCALE,
    z: earMid.z,
    visibility: Math.min(earMid.visibility ?? 1, nose.visibility ?? 1),
  };
}

// ── BodyPartDef interface ─────────────────────────────────────────────────────

export interface BodyPartDef {
  id: string;
  getA: (lm: NormalizedLandmark[]) => NormalizedLandmark;
  getB: (lm: NormalizedLandmark[]) => NormalizedLandmark;
  widthRatio: number;
  padRatio: number;
  zOrder: number;
  /** If true, PhotoPuppet scales this part's draw size by HEAD_SCALE_MULTIPLIER */
  isHead?: boolean;
}

// ── Body part definitions ─────────────────────────────────────────────────────

export const BODY_PART_DEFS: BodyPartDef[] = [

  // ── Torso ──────────────────────────────────────────────────────────────────
  // Bone: shoulder-midpoint → hip-midpoint (vertical trunk axis)
  // Width 1.35× bone length captures both sides of the chest/abdomen.
  // Small padding (0.10) keeps the crop tight to the shoulder/hip lines.
  {
    id: 'torso',
    getA: lm => mid(lm[L.LEFT_SHOULDER], lm[L.RIGHT_SHOULDER]),
    getB: lm => mid(lm[L.LEFT_HIP],      lm[L.RIGHT_HIP]),
    widthRatio: 1.35,
    padRatio:   0.10,
    zOrder: 0,
  },

  // ── Legs ───────────────────────────────────────────────────────────────────
  // widthRatio 0.55 ≈ thigh width as a fraction of femur length (empirically
  // matches a natural silhouette for most standing poses).
  // Calves taper: 0.45.
  {
    id: 'left_thigh',
    getA: lm => lm[L.LEFT_HIP],
    getB: lm => lm[L.LEFT_KNEE],
    widthRatio: 0.55,
    padRatio:   0.08,
    zOrder: 1,
  },
  {
    id: 'right_thigh',
    getA: lm => lm[L.RIGHT_HIP],
    getB: lm => lm[L.RIGHT_KNEE],
    widthRatio: 0.55,
    padRatio:   0.08,
    zOrder: 1,
  },
  {
    id: 'left_calf',
    getA: lm => lm[L.LEFT_KNEE],
    getB: lm => lm[L.LEFT_ANKLE],
    widthRatio: 0.45,
    padRatio:   0.08,
    zOrder: 1,
  },
  {
    id: 'right_calf',
    getA: lm => lm[L.RIGHT_KNEE],
    getB: lm => lm[L.RIGHT_ANKLE],
    widthRatio: 0.45,
    padRatio:   0.08,
    zOrder: 1,
  },

  // ── Arms ───────────────────────────────────────────────────────────────────
  // Upper arms: 0.50 width — slightly narrower than thighs.
  // Forearms taper to 0.42.
  {
    id: 'left_upper_arm',
    getA: lm => lm[L.LEFT_SHOULDER],
    getB: lm => lm[L.LEFT_ELBOW],
    widthRatio: 0.50,
    padRatio:   0.10,
    zOrder: 2,
  },
  {
    id: 'right_upper_arm',
    getA: lm => lm[L.RIGHT_SHOULDER],
    getB: lm => lm[L.RIGHT_ELBOW],
    widthRatio: 0.50,
    padRatio:   0.10,
    zOrder: 2,
  },
  {
    id: 'left_forearm',
    getA: lm => lm[L.LEFT_ELBOW],
    getB: lm => lm[L.LEFT_WRIST],
    widthRatio: 0.42,
    padRatio:   0.10,
    zOrder: 2,
  },
  {
    id: 'right_forearm',
    getA: lm => lm[L.RIGHT_ELBOW],
    getB: lm => lm[L.RIGHT_WRIST],
    widthRatio: 0.42,
    padRatio:   0.10,
    zOrder: 2,
  },

  // ── Head ───────────────────────────────────────────────────────────────────
  // Previous approach (ear-mid → nose) produced a crop that was too short
  // (~half-face height) and sat too high above the torso.
  //
  // New approach:
  //   A = synthesised "above scalp" point (above the crown)
  //   B = shoulder midpoint (neck/torso junction)
  //
  // This gives a bone that spans crown → shoulders, capturing the whole head
  // AND the neck so it connects smoothly to the torso segment.
  //
  // widthRatio 1.1 gives a crop slightly wider than the bone length, which
  // covers the head width at ear level for most people.
  // padRatio 0.05 = minimal extra padding (the scalp anchor already pushes past
  // the crown, and the shoulder anchor lands at the collar).
  //
  // PhotoPuppet then applies HEAD_SCALE_MULTIPLIER (1.5) at draw time so the
  // rendered head reads as proportionally correct even next to a wide torso.
  {
    id: 'head',
    getA: lm => aboveScalp(lm),
    getB: lm => mid(lm[L.LEFT_SHOULDER], lm[L.RIGHT_SHOULDER]),
    widthRatio: 1.1,
    padRatio:   0.05,
    zOrder: 3,
    isHead: true,
  },
];
