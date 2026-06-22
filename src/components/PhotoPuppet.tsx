/**
 * PhotoPuppet.tsx
 *
 * Renders a 2.5D "photo puppet" on a Canvas 2D element.
 *
 * For every CapturedRegion (a body-part crop stored during calibration):
 *   1. Get the live positions of the two landmark endpoints that define that bone
 *   2. Compute the midpoint, bone length, and rotation angle in the display canvas
 *   3. Draw the stored bitmap, scaled so its height matches the live bone length,
 *      rotated to match the live bone angle
 *
 * Coordinate system:
 *   MediaPipe landmarks are in normalised [0,1] space relative to the raw
 *   (unmirrored) video frame.  To match the CSS-mirrored camera preview we
 *   flip x: displayX = (1 - lm.x) * canvasW.  This is the same transform
 *   applied by PoseOverlay.tsx.
 *
 * Draw order:
 *   Regions are sorted by zOrder (torso first, head last) so closer body
 *   parts paint over farther ones.
 */

import { useEffect, useRef } from 'react';
import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import type { CapturedRegion } from '../hooks/useBodyCapture';

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
      // Draw a subtle "waiting" message
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.font = '14px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('Capture your body to activate this mode', width / 2, height / 2);
      return;
    }

    // Sort by zOrder so torso is painted first (behind arms, head)
    const sorted = [...regions].sort((a, b) => a.def.zOrder - b.def.zOrder);

    for (const region of sorted) {
      const lmA = region.def.getA(landmarks);
      const lmB = region.def.getB(landmarks);

      const minVis = Math.min(lmA.visibility ?? 1, lmB.visibility ?? 1);
      if (minVis < 0.2) continue; // skip occluded landmarks

      // ── Convert normalised landmark coords to canvas pixels ──────────────
      // Flip x to match the mirrored camera preview
      const ax = (1 - lmA.x) * width,  ay = lmA.y * height;
      const bx = (1 - lmB.x) * width,  by = lmB.y * height;

      const midX    = (ax + bx) / 2;
      const midY    = (ay + by) / 2;
      const liveLen = Math.hypot(bx - ax, by - ay);
      if (liveLen < 4) continue;

      // ── Scale the stored crop so its height equals the live bone length ───
      const scale  = liveLen / region.cropH;
      const drawW  = region.cropW * scale;
      const drawH  = liveLen;

      // ── Rotation: bone direction minus 90° so the image's height axis
      //    (which was aligned to vertical during capture) now points along
      //    the live bone direction ──────────────────────────────────────────
      const angle = Math.atan2(by - ay, bx - ax) - Math.PI / 2;

      ctx.save();
      ctx.translate(midX, midY);
      ctx.rotate(angle);

      // Subtle glow for hackathon polish
      ctx.shadowBlur  = 8;
      ctx.shadowColor = 'rgba(0, 229, 255, 0.35)';

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
