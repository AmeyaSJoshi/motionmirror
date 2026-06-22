/**
 * useBodyCapture.ts
 *
 * Handles the "Capture Body" flow with a 10-second countdown:
 *
 *   startCountdown() → ticks 10…1…0 → auto-calls captureBody()
 *   cancelCountdown() → aborts the timer, resets to idle
 *   captureBody()     → snapshots raw video frame, crops body parts
 *   clearCapture()    → releases all ImageBitmaps (privacy)
 *
 * ── Crop extraction algorithm ────────────────────────────────────────────────
 *   For each BodyPartDef:
 *     1. Convert landmark A and B from normalised [0,1] → pixel coords
 *     2. Compute bone midpoint, length, and angle
 *     3. Create a temp canvas (cropW × cropH)
 *     4. Rotate the source image so the bone aligns with the canvas Y-axis,
 *        then draw so the midpoint lands at the canvas centre
 *     5. createImageBitmap() on that canvas → GPU-ready texture
 *
 *   Stored bitmaps are vertically oriented (height = bone direction) so
 *   PhotoPuppet can re-rotate them to the live bone angle at draw time.
 *
 * Privacy: bitmaps live only in JS memory and are released by clearCapture().
 * Nothing is ever uploaded or persisted.
 */

import { useState, useCallback, useRef } from 'react';
import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import { BODY_PART_DEFS, type BodyPartDef } from '../utils/bodyRegions';

export const COUNTDOWN_SECONDS = 10;

export interface CapturedRegion {
  def: BodyPartDef;
  bitmap: ImageBitmap;
  cropW: number; // pixel width of the stored crop
  cropH: number; // pixel height (≈ calibration bone length + padding)
  /** For head only: the scale multiplier baked in at capture time */
  headScaleMultiplier?: number;
}

export interface BodyCaptureState {
  isCapturing: boolean;
  hasCaptured: boolean;
  capturedRegions: CapturedRegion[];
  /** null = idle; 1-10 = counting down; 0 = capturing now */
  countdown: number | null;
  error: string | null;
}

export function useBodyCapture() {
  const [state, setState] = useState<BodyCaptureState>({
    isCapturing: false,
    hasCaptured: false,
    capturedRegions: [],
    countdown: null,
    error: null,
  });

  // Holds the setInterval id so we can cancel mid-count
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Internal: do the actual snapshot + crop ─────────────────────────────
  const captureBody = useCallback(async (
    video: HTMLVideoElement,
    landmarks: NormalizedLandmark[],
  ) => {
    setState(s => ({ ...s, isCapturing: true, countdown: 0, error: null }));

    try {
      const W = video.videoWidth;
      const H = video.videoHeight;
      if (W === 0 || H === 0) throw new Error('Video not ready');

      // Step 1 — snapshot the raw (unmirrored) video frame
      const sourceCanvas = document.createElement('canvas');
      sourceCanvas.width  = W;
      sourceCanvas.height = H;
      const srcCtx = sourceCanvas.getContext('2d')!;
      srcCtx.drawImage(video, 0, 0, W, H);

      // Step 2 — extract a rotated-rectangle crop per body part
      const regions: CapturedRegion[] = [];

      for (const def of BODY_PART_DEFS) {
        const lmA = def.getA(landmarks);
        const lmB = def.getB(landmarks);

        const minVis = Math.min(lmA.visibility ?? 1, lmB.visibility ?? 1);
        if (minVis < 0.25) continue;

        // Normalised → pixel coords (raw/unmirrored frame)
        const ax = lmA.x * W,  ay = lmA.y * H;
        const bx = lmB.x * W,  by = lmB.y * H;

        const boneLen = Math.hypot(bx - ax, by - ay);
        if (boneLen < 8) continue;

        const midX  = (ax + bx) / 2;
        const midY  = (ay + by) / 2;

        // Crop size: height = bone length + padding on each end
        const padPx = boneLen * def.padRatio;
        const cropH = Math.ceil(boneLen + 2 * padPx);
        const cropW = Math.ceil(cropH * def.widthRatio);

        // Angle of the A→B vector from +X axis
        const angle = Math.atan2(by - ay, bx - ax);

        // ── Rotated crop ────────────────────────────────────────────────────
        //   Goal: extract a rectangle whose height axis aligns with the bone.
        //   Transform applied to the source image:
        //     (1) Translate so the bone midpoint maps to the canvas centre
        //     (2) Rotate by (π/2 - angle) so the bone direction becomes +Y
        //   This "un-rotates" the bone to vertical so the stored bitmap is
        //   always axis-aligned — PhotoPuppet re-rotates at draw time.
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width  = cropW;
        tempCanvas.height = cropH;
        const tCtx = tempCanvas.getContext('2d')!;

        tCtx.save();
        tCtx.translate(cropW / 2, cropH / 2);   // pivot = canvas centre
        tCtx.rotate(Math.PI / 2 - angle);        // un-rotate bone to vertical
        tCtx.drawImage(sourceCanvas, -midX, -midY); // place midpoint at pivot
        tCtx.restore();

        try {
          const bitmap = await createImageBitmap(tempCanvas);
          regions.push({ def, bitmap, cropW, cropH });
        } catch {
          // Non-fatal — skip this part
        }
      }

      if (regions.length === 0) {
        throw new Error('No body parts detected — make sure your full body is visible.');
      }

      setState(prev => {
        prev.capturedRegions.forEach(r => r.bitmap.close()); // release old bitmaps
        return { isCapturing: false, hasCaptured: true, capturedRegions: regions, countdown: null, error: null };
      });

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setState(s => ({ ...s, isCapturing: false, countdown: null, error: msg }));
    }
  }, []);

  // ── Public: start the 10-second countdown ─────────────────────────────
  const startCountdown = useCallback((
    videoRef: React.RefObject<HTMLVideoElement | null>,
    getLandmarks: () => NormalizedLandmark[] | null,
  ) => {
    // Guard: don't start if already counting or capturing
    setState(s => {
      if (s.countdown !== null || s.isCapturing) return s;
      return { ...s, countdown: COUNTDOWN_SECONDS, error: null };
    });

    let remaining = COUNTDOWN_SECONDS;

    // Clear any stale interval
    if (intervalRef.current !== null) clearInterval(intervalRef.current);

    intervalRef.current = setInterval(() => {
      remaining -= 1;

      if (remaining <= 0) {
        // Time's up — fire the capture
        clearInterval(intervalRef.current!);
        intervalRef.current = null;

        const video = videoRef.current;
        const lm    = getLandmarks();
        if (video && lm) {
          void captureBody(video, lm);
        } else {
          setState(s => ({
            ...s,
            countdown: null,
            error: 'Pose not detected at capture time — please try again.',
          }));
        }
      } else {
        setState(s => ({ ...s, countdown: remaining }));
      }
    }, 1000);
  }, [captureBody]);

  // ── Public: cancel mid-countdown ──────────────────────────────────────
  const cancelCountdown = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setState(s => ({ ...s, countdown: null }));
  }, []);

  // ── Public: release all bitmaps for privacy ───────────────────────────
  const clearCapture = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setState(prev => {
      prev.capturedRegions.forEach(r => r.bitmap.close());
      return { isCapturing: false, hasCaptured: false, capturedRegions: [], countdown: null, error: null };
    });
  }, []);

  return { ...state, startCountdown, cancelCountdown, captureBody, clearCapture };
}
