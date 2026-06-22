/**
 * PhotoPuppet.tsx
 *
 * Renders the 2.5D "photo puppet" on a Canvas 2D element.
 *
 * For every CapturedRegion (body-part bitmap stored during calibration):
 *   1. Get live positions of the two landmark endpoints defining that bone
 *   2. Compute midpoint, bone length, and rotation angle in display space
 *   3. Scale the stored bitmap so its height matches the live bone length
 *      (multiplied by HEAD_SCALE_MULTIPLIER for the head part)
 *   4. Draw it rotated to match the live bone direction
 *
 * ── Coordinate system ────────────────────────────────────────────────────────
 *   MediaPipe landmarks are normalised [0,1] relative to the raw (unmirrored)
 *   video frame.  We flip x: displayX = (1 - lm.x) * canvasW  to match the
 *   CSS-mirrored camera preview.  Same approach as PoseOverlay.tsx.
 *
 * ── Rotation formula ─────────────────────────────────────────────────────────
 *   Stored bitmaps are vertical (height = bone direction from calibration).
 *   To re-orient at draw time:
 *     angle = atan2(by - ay, bx - ax) - π/2
 *   Proof: if bone points straight down (+Y), atan2 = π/2, rotation = 0 → no
 *   rotation, bitmap draws top-to-bottom.  If bone points right (+X), atan2 = 0,
 *   rotation = -π/2 → bitmap rotates -90° so height axis points right.  ✓
 *
 * ── Head scale ───────────────────────────────────────────────────────────────
 *   The head bone (scalp → shoulder-midpoint) is longer than the visible head
 *   because it includes the neck.  HEAD_SCALE_MULTIPLIER compensates so the
 *   head reads as proportionally correct relative to the torso.
 *   Adjust in bodyRegions.ts if needed.
 */

import { useEffect, useRef } from 'react';
import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import type { CapturedRegion } from '../hooks/useBodyCapture';
import { HEAD_SCALE_MULTIPLIER } from '../utils/bodyRegions';

interface Props {
  landmarks: NormalizedLandmark[] | null;
  regions: CapturedRegion[];
  width: number;
  height: number;
}

export function PhotoPuppet({ landmarks, regions, width, height }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);

    if (!landmarks || landmarks.length === 0 || regions.length === 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.font = '14px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('Capture your body to activate this mode', width / 2, height / 2);
      return;
    }

    // Paint back-to-front: torso → legs → arms → head
    const sorted = [...regions].sort((a, b) => a.def.zOrder - b.def.zOrder);

    for (const region of sorted) {
      const lmA = region.def.getA(landmarks);
      const lmB = region.def.getB(landmarks);

      const minVis = Math.min(lmA.visibility ?? 1, lmB.visibility ?? 1);
      if (minVis < 0.2) continue;

      // Flip x to mirror the display, matching the CSS-mirrored camera feed
      const ax = (1 - lmA.x) * width,  ay = lmA.y * height;
      const bx = (1 - lmB.x) * width,  by = lmB.y * height;

      const midX    = (ax + bx) / 2;
      const midY    = (ay + by) / 2;
      const liveLen = Math.hypot(bx - ax, by - ay);
      if (liveLen < 4) continue;

      // ── Head: apply scale multiplier so the rendered head is proportionally ──
      // larger than the raw bone length (which includes the neck segment).
      // All other parts use a 1:1 height-to-bone mapping.
      const sizeMultiplier = region.def.isHead ? HEAD_SCALE_MULTIPLIER : 1.0;

      const drawH = liveLen * sizeMultiplier;
      const drawW = region.cropW * (drawH / region.cropH);

      // Rotation: atan2 gives bone direction from +X; subtract π/2 so the
      // bitmap's height axis (stored as vertical) aligns with the bone.
      const angle = Math.atan2(by - ay, bx - ax) - Math.PI / 2;

      ctx.save();
      ctx.translate(midX, midY);
      ctx.rotate(angle);

      // Subtle glow for hackathon polish
      ctx.shadowBlur  = 8;
      ctx.shadowColor = 'rgba(0, 229, 255, 0.30)';

      ctx.drawImage(
        region.bitmap,
        -drawW / 2,
        -drawH / 2,
        drawW,
        drawH,
      );

      ctx.restore();
    }
  }, [landmarks, regions, width, height]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        borderRadius: '12px',
      }}
    />
  );
}
