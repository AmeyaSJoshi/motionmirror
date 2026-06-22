/**
 * useSmoothLandmarks.ts
 *
 * Smooths MediaPipe landmark positions over time so the avatar moves without
 * jitter, while faithfully reporting which landmarks are actually confident.
 *
 * POLICY: no inference, no filling-in.
 *   This hook only smooths positions — it does NOT mirror missing sides,
 *   does NOT infer knees from hips, and does NOT drift toward a T-pose.
 *   If a landmark is not detected, staleFrames climbs and the avatar hides
 *   the corresponding body part via opacity fade in HumanoidAvatar.tsx.
 *
 * Two-pass algorithm per frame:
 *
 *   Pass 1 — Lerp (visible landmarks)
 *     When raw visibility ≥ VIS_THRESHOLD, exponentially lerp the stored
 *     position toward the new reading and reset staleFrames to 0.
 *
 *   Pass 2 — Freeze (invisible / low-confidence landmarks)
 *     When visibility < threshold, keep the last-known position unchanged
 *     and increment staleFrames.  The last-known position is used so that
 *     if the landmark reappears in a neighbouring frame the mesh snaps back
 *     to roughly the right place rather than jumping from (0,0,0).
 *
 * staleFrames is the only signal the avatar uses to decide visibility:
 *   staleFrames == 0  → landmark was good this frame
 *   staleFrames  < 8  → landmark has been gone < ~0.25 s (hold, don't hide)
 *   staleFrames >= 8  → landmark has been gone long enough → begin fade-out
 */

import { useRef, useCallback } from 'react';
import type { NormalizedLandmark } from '@mediapipe/tasks-vision';

/** Visibility score below which a landmark is treated as unreliable. */
const VIS_THRESHOLD = 0.30;

/** Exponential lerp factor per frame toward a new reliable reading. */
const LERP = 0.22;

/**
 * A smoothed landmark that extends NormalizedLandmark with a staleness counter.
 * staleFrames == 0 means the landmark was confidently detected this frame.
 */
export interface SmoothedLandmark {
  x: number;
  y: number;
  z: number;
  visibility: number;
  /** Frames since the last reliable (visibility ≥ VIS_THRESHOLD) reading. */
  staleFrames: number;
}

export function useSmoothLandmarks() {
  const sm = useRef<SmoothedLandmark[]>([]);

  /**
   * Call once per animation frame.
   * Returns the current smoothed + staleness-annotated landmark array.
   * The returned array is the same object every call (mutated in place) —
   * do NOT store references to it across frames.
   */
  const update = useCallback((raw: NormalizedLandmark[] | null): SmoothedLandmark[] => {

    // Initialise with high staleFrames so all parts are hidden until detected
    if (sm.current.length === 0) {
      sm.current = Array.from({ length: 33 }, () => ({
        x: 0.5, y: 0.5, z: 0, visibility: 0, staleFrames: 9999,
      }));
    }
    const s = sm.current;

    if (raw && raw.length > 0) {
      for (let i = 0; i < Math.min(raw.length, s.length); i++) {
        const r = raw[i];
        const vis = r.visibility ?? 0;

        if (vis >= VIS_THRESHOLD) {
          // Good reading: smooth toward it
          s[i].x += (r.x - s[i].x) * LERP;
          s[i].y += (r.y - s[i].y) * LERP;
          s[i].z += (r.z - s[i].z) * LERP;
          s[i].visibility  = vis;
          s[i].staleFrames = 0;
        } else {
          // Unreliable: freeze position, age the counter
          s[i].staleFrames++;
        }
      }
    } else {
      // No pose data this frame — age all landmarks
      s.forEach(t => t.staleFrames++);
    }

    // No inference passes — we report only what MediaPipe actually gave us.
    return s;
  }, []);

  return { update };
}
