import { useEffect, useRef } from 'react';
import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import { SKELETON_CONNECTIONS, AVATAR_JOINTS } from '../utils/poseConstants';

interface Props {
  landmarks: NormalizedLandmark[] | null;
  width: number;
  height: number;
}

export function PoseOverlay({ landmarks, width, height }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);
    if (!landmarks || landmarks.length === 0) return;

    // Flip horizontally to match the mirrored video
    ctx.save();
    ctx.translate(width, 0);
    ctx.scale(-1, 1);

    // Draw bones
    ctx.strokeStyle = '#00e5ff';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    for (const [a, b] of SKELETON_CONNECTIONS) {
      const la = landmarks[a];
      const lb = landmarks[b];
      if (!la || !lb) continue;
      if (la.visibility !== undefined && la.visibility < 0.3) continue;
      if (lb.visibility !== undefined && lb.visibility < 0.3) continue;
      ctx.beginPath();
      ctx.moveTo(la.x * width, la.y * height);
      ctx.lineTo(lb.x * width, lb.y * height);
      ctx.stroke();
    }

    // Draw joints
    for (const idx of AVATAR_JOINTS) {
      const lm = landmarks[idx];
      if (!lm) continue;
      if (lm.visibility !== undefined && lm.visibility < 0.3) continue;
      ctx.beginPath();
      ctx.arc(lm.x * width, lm.y * height, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#ff4081';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    ctx.restore();
  }, [landmarks, width, height]);

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
        pointerEvents: 'none',
        borderRadius: '12px',
      }}
    />
  );
}
