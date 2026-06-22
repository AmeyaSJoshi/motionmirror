/**
 * useSmoothLandmarks.ts
 *
 * Maintains a smoothed, temporally-consistent landmark array from raw
 * MediaPipe Pose output.  Call update(rawLandmarks) once per animation frame
 * and use the returned array in place of the raw landmarks.
 *
 * ── Smoothing strategy ────────────────────────────────────────────────────────
 *   Each landmark goes through up to four passes per frame:
 *
 *   Pass 1 — Lerp update (visible landmarks)
 *     When MediaPipe visibility ≥ VIS_THRESHOLD, exponentially lerp the stored
 *     position toward the new reading.  This removes jitter without lag.
 *
 *   Pass 2 — Freeze (invisible / low-confidence landmarks)
 *     When visibility < threshold, keep the last-known position and increment
 *     a staleFrames counter.  The avatar holds the last good pose for up to
 *     FREEZE_FRAMES (~1.5 s) before any further inference kicks in.
 *
 *   Pass 3 — Symmetry mirroring (one-sided misses)
 *     If one side (e.g. left elbow) is stale but the opposite (right elbow)
 *     is still fresh, mirror the good side across the frame centre (x = 0.5).
 *     This handles the common case where the user turns slightly and one arm
 *     disappears from view.
 *
 *   Pass 4 — Lower-body chain inference (upper-body-only capture)
 *     If hips are visible but knees / ankles are cut off, estimate them by
 *     extending the last-known hip position downward by a fixed normalised
 *     offset (LEG_SEG_Y per joint).  The avatar legs will hang naturally
 *     below a waist-up frame instead of snapping to a T-pose.
 *
 *   Pass 5 — T-pose drift (very stale landmarks)
 *     Landmarks that remain stale past TPOSE_FRAMES slowly drift toward their
 *     T-pose defaults.  This prevents the avatar from freezing in an
 *     unnatural position if the user steps out of frame entirely.
 */

import { useRef, useCallback } from 'react';
import type { NormalizedLandmark } from '@mediapipe/tasks-vision';

// ── Tuning constants ──────────────────────────────────────────────────────────

/** Lerp speed per frame (0 = no movement, 1 = instant). */
const LERP = 0.22;

/** Landmarks below this visibility are treated as unreliable. */
const VIS_THRESHOLD = 0.30;

/** Frames before stale-position inference activates (~1.5 s at 30 fps). */
const FREEZE_FRAMES = 45;

/** Frames before very-slow T-pose drift activates (~3 s at 30 fps). */
const TPOSE_FRAMES = 90;

/**
 * Normalised Y distance between consecutive leg joints used when inferring
 * knee/ankle positions from the last known hip.
 */
const LEG_SEG_Y = 0.18;

// ── T-pose defaults (normalised [0,1] x/y) ───────────────────────────────────
// Last-resort fallback; landmarks drift toward these after TPOSE_FRAMES.
const T_POSE: Record<number, [number, number]> = {
   0: [0.50, 0.15], // nose
   7: [0.42, 0.18], // left ear
   8: [0.58, 0.18], // right ear
  11: [0.30, 0.33], // left shoulder
  12: [0.70, 0.33], // right shoulder
  13: [0.15, 0.50], // left elbow
  14: [0.85, 0.50], // right elbow
  15: [0.08, 0.67], // left wrist
  16: [0.92, 0.67], // right wrist
  23: [0.38, 0.60], // left hip
  24: [0.62, 0.60], // right hip
  25: [0.35, 0.78], // left knee
  26: [0.65, 0.78], // right knee
  27: [0.33, 0.93], // left ankle
  28: [0.67, 0.93], // right ankle
};

interface TrackedLandmark {
  x: number; y: number; z: number;
  visibility: number;
  staleFrames: number;
}

export function useSmoothLandmarks() {
  const sm = useRef<TrackedLandmark[]>([]);

  const update = useCallback((raw: NormalizedLandmark[] | null): NormalizedLandmark[] => {
    // ── Initialise from T-pose defaults on first call ─────────────────────
    if (sm.current.length === 0) {
      sm.current = Array.from({ length: 33 }, (_, i) => {
        const def = T_POSE[i];
        return { x: def?.[0] ?? 0.5, y: def?.[1] ?? 0.5, z: 0, visibility: 0, staleFrames: TPOSE_FRAMES + 1 };
      });
    }
    const s = sm.current;

    // ── Pass 1 & 2: lerp toward visible readings; freeze invisible ones ────
    if (raw && raw.length > 0) {
      for (let i = 0; i < Math.min(raw.length, s.length); i++) {
        const r = raw[i];
        const vis = r.visibility ?? 0;
        if (vis >= VIS_THRESHOLD) {
          s[i].x += (r.x - s[i].x) * LERP;
          s[i].y += (r.y - s[i].y) * LERP;
          s[i].z += (r.z - s[i].z) * LERP;
          s[i].visibility  = vis;
          s[i].staleFrames = 0;
        } else {
          s[i].staleFrames++;
        }
      }
    } else {
      s.forEach(t => t.staleFrames++);
    }

    // ── Pass 3: symmetry mirroring for one-sided misses ───────────────────
    // Mirror pairs: [leftIdx, rightIdx].  When one side has been stale for
    // FREEZE_FRAMES but the other is fresh, reflect x around the centreline
    // so the avatar stays symmetric.
    const MIRROR_PAIRS: [number, number][] = [
      [7, 8], [11, 12], [13, 14], [15, 16], [23, 24], [25, 26], [27, 28],
    ];
    for (const [li, ri] of MIRROR_PAIRS) {
      const ls = s[li], rs = s[ri];
      const lStale = ls.staleFrames > FREEZE_FRAMES;
      const rStale = rs.staleFrames > FREEZE_FRAMES;
      if (lStale && !rStale) {
        ls.x = 1.0 - rs.x; ls.y = rs.y; ls.z = rs.z;
      } else if (rStale && !lStale) {
        rs.x = 1.0 - ls.x; rs.y = ls.y; rs.z = ls.z;
      }
    }

    // ── Pass 4: lower-body chain inference ───────────────────────────────
    // When the hips are visible but the legs are cut off (waist-up frame),
    // extend the knee and ankle below the hip at fixed offsets.  This makes
    // the avatar's legs hang naturally rather than snapping to T-pose.
    const LEG_CHAINS: [number, number, number][] = [
      [23, 25, 27], // left:  hip → knee → ankle
      [24, 26, 28], // right: hip → knee → ankle
    ];
    for (const [hi, ki, ai] of LEG_CHAINS) {
      const hip = s[hi], knee = s[ki], ankle = s[ai];
      if (hip.staleFrames < FREEZE_FRAMES) {
        if (knee.staleFrames > FREEZE_FRAMES) {
          knee.x = hip.x; knee.y = hip.y + LEG_SEG_Y; knee.z = hip.z;
        }
        if (ankle.staleFrames > FREEZE_FRAMES) {
          ankle.x = knee.x; ankle.y = knee.y + LEG_SEG_Y; ankle.z = knee.z;
        }
      }
    }

    // ── Pass 5: very slow T-pose drift for completely stale landmarks ─────
    for (let i = 0; i < s.length; i++) {
      if (s[i].staleFrames > TPOSE_FRAMES) {
        const def = T_POSE[i];
        if (def) {
          s[i].x += (def[0] - s[i].x) * 0.04;
          s[i].y += (def[1] - s[i].y) * 0.04;
          s[i].z += (0      - s[i].z) * 0.04;
        }
      }
    }

    return s as unknown as NormalizedLandmark[];
  }, []);

  return { update };
}
