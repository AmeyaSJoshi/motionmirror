/**
 * useBodyCapture.ts
 *
 * Handles the "Capture Body" flow:
 *   1. Snapshots the current video frame (raw, unmirrored pixels)
 *   2. For every BodyPartDef, extracts a rotated-rectangle crop from that
 *      snapshot that is aligned to the calibration bone direction
 *   3. Stores each crop as an ImageBitmap for zero-copy GPU upload in canvas
 *
 * Crop extraction algorithm (per body part):
 *   - Convert landmark A and B from normalised [0,1] to pixel coordinates
 *   - Compute bone midpoint, length, and angle
 *   - Create a temp canvas sized (cropW × cropH)
 *   - Rotate the source image so the bone aligns with the canvas Y-axis,
 *     then draw so the midpoint lands at the canvas centre
 *   - Capture that temp canvas as an ImageBitmap
 *
 * The resulting bitmaps are stored vertically (height = bone direction) so
 * PhotoPuppet can simply rotate them back to the live bone angle when drawing.
 *
 * Privacy: bitmaps live only in JS memory and are released by clearCapture().
 * Nothing is ever uploaded or written to disk unless the user explicitly saves.
 */

import { useState, useCallback } from 'react';
import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import { BODY_PART_DEFS, type BodyPartDef } from '../utils/bodyRegions';

export interface CapturedRegion {
  def: BodyPartDef;
  bitmap: ImageBitmap;
  cropW: number; // pixel width of the stored crop
  cropH: number; // pixel height of the stored crop (≈ calibration bone length + padding)
}

export interface BodyCaptureState {
  isCapturing: boolean;
  hasCaptured: boolean;
  capturedRegions: CapturedRegion[];
  error: string | null;
}

export function useBodyCapture() {
  const [state, setState] = useState<BodyCaptureState>({
    isCapturing: false,
    hasCaptured: false,
    capturedRegions: [],
    error: null,
  });

  const captureBody = useCallback(async (
    video: HTMLVideoElement,
    landmarks: NormalizedLandmark[],
  ) => {
    setState(s => ({ ...s, isCapturing: true, error: null }));

    try {
      const W = video.videoWidth;
      const H = video.videoHeight;
      if (W === 0 || H === 0) throw new Error('Video not ready');

      // ── Step 1: snapshot the raw (unmirrored) video frame ────────────────
      const sourceCanvas = document.createElement('canvas');
      sourceCanvas.width  = W;
      sourceCanvas.height = H;
      const srcCtx = sourceCanvas.getContext('2d')!;
      srcCtx.drawImage(video, 0, 0, W, H);

      // ── Step 2: extract a rotated crop per body part ──────────────────────
      const regions: CapturedRegion[] = [];

      for (const def of BODY_PART_DEFS) {
        const lmA = def.getA(landmarks);
        const lmB = def.getB(landmarks);

        // Skip if the part isn't visible enough in the calibration frame
        const minVis = Math.min(lmA.visibility ?? 1, lmB.visibility ?? 1);
        if (minVis < 0.25) continue;

        // Convert normalised landmark coords → source pixel coords
        const ax = lmA.x * W,  ay = lmA.y * H;
        const bx = lmB.x * W,  by = lmB.y * H;

        const boneLen = Math.hypot(bx - ax, by - ay);
        if (boneLen < 8) continue; // landmark pair too close — skip

        const midX = (ax + bx) / 2;
        const midY = (ay + by) / 2;

        // Crop size: height covers the bone + padding on each end
        const padPx  = boneLen * def.padRatio;
        const cropH  = Math.ceil(boneLen + 2 * padPx);
        const cropW  = Math.ceil(cropH * def.widthRatio);

        // Angle from A→B, measured from +X axis
        const angle  = Math.atan2(by - ay, bx - ax);

        // ── Rotated crop ─────────────────────────────────────────────────
        // We want to extract a rectangle whose height axis aligns with the
        // bone direction.  Strategy:
        //   1. Translate the source so the bone midpoint is at the origin
        //   2. Rotate so the bone points straight down (+Y)
        //      rotation = π/2 - angle  (because +Y needs to become bone dir)
        //   3. Shift the origin to the centre of the temp canvas
        //
        // This is equivalent to the inverse transform:
        //   tmpCanvas centre → midpoint in source, Y-axis → bone direction
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width  = cropW;
        tempCanvas.height = cropH;
        const tCtx = tempCanvas.getContext('2d')!;

        tCtx.save();
        tCtx.translate(cropW / 2, cropH / 2);         // canvas centre as pivot
        tCtx.rotate(Math.PI / 2 - angle);             // un-rotate bone to vertical
        tCtx.drawImage(sourceCanvas, -midX, -midY);   // place midpoint at pivot
        tCtx.restore();

        try {
          const bitmap = await createImageBitmap(tempCanvas);
          regions.push({ def, bitmap, cropW, cropH });
        } catch {
          // Non-fatal: just skip this part
        }
      }

      if (regions.length === 0) {
        throw new Error('No body parts detected — make sure your full body is visible.');
      }

      // Release previous bitmaps before storing new ones
      setState(prev => {
        prev.capturedRegions.forEach(r => r.bitmap.close());
        return { isCapturing: false, hasCaptured: true, capturedRegions: regions, error: null };
      });

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setState(s => ({ ...s, isCapturing: false, error: msg }));
    }
  }, []);

  const clearCapture = useCallback(() => {
    setState(prev => {
      // Release GPU-side bitmaps immediately for privacy
      prev.capturedRegions.forEach(r => r.bitmap.close());
      return { isCapturing: false, hasCaptured: false, capturedRegions: [], error: null };
    });
  }, []);

  return { ...state, captureBody, clearCapture };
}
