/**
 * BodyPartStatus.tsx
 *
 * A small debug overlay that shows which body-part groups MediaPipe is
 * currently detecting with enough confidence.
 *
 *   Green dot  = all anchor landmarks for that group have visibility ≥ 0.35
 *   Grey dot   = one or more anchor landmarks are below the threshold
 *
 * This component reads only the raw (unsmoothed) landmark array so the dots
 * reflect exactly what MediaPipe reported in the most recent frame.
 */

import type { NormalizedLandmark } from '@mediapipe/tasks-vision';

/** Minimum visibility score to consider a landmark "detected". */
const MIN_VIS = 0.35;

interface BodyGroup {
  label: string;
  indices: number[];
}

const GROUPS: BodyGroup[] = [
  { label: 'Head',       indices: [0, 7, 8] },
  { label: 'Neck',       indices: [11, 12] },
  { label: 'Torso',      indices: [11, 12, 23, 24] },
  { label: 'L. Arm',     indices: [11, 13, 15] },
  { label: 'R. Arm',     indices: [12, 14, 16] },
  { label: 'Hands',      indices: [15, 16] },
  { label: 'L. Leg',     indices: [23, 25, 27] },
  { label: 'R. Leg',     indices: [24, 26, 28] },
];

interface Props {
  landmarks: NormalizedLandmark[] | null;
}

export function BodyPartStatus({ landmarks }: Props) {
  const check = (indices: number[]): boolean => {
    if (!landmarks || landmarks.length === 0) return false;
    return indices.every(i => (landmarks[i]?.visibility ?? 0) >= MIN_VIS);
  };

  return (
    <div className="body-part-status">
      <div className="bps-title">Body Parts</div>
      {GROUPS.map(g => {
        const ok = check(g.indices);
        return (
          <div key={g.label} className="bps-row">
            <span className={`bps-dot ${ok ? 'bps-dot-ok' : 'bps-dot-miss'}`} />
            <span className="bps-label">{g.label}</span>
          </div>
        );
      })}
    </div>
  );
}
