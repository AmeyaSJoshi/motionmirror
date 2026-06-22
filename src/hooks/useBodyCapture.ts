/**
 * useBodyCapture.ts
 *
 * Handles the "Sample Appearance" flow:
 *   startCountdown() → 10-second timer → captureBody() fires at t=0
 *   captureBody()    → snapshots video frame, samples 4 pixel colours
 *   clearCapture()   → resets state (colours discarded)
 *
 * ── What this does NOT do ────────────────────────────────────────────────────
 *   This hook no longer crops or stores image fragments.
 *   The raw video frame is drawn once to an offscreen canvas, four colour
 *   values are sampled from landmark-derived positions, and the canvas is
 *   immediately discarded.  The only data that persists is four hex colour
 *   strings — no photos are retained in memory.
 *
 * ── Colour sampling algorithm ────────────────────────────────────────────────
 *   For each region, we compute the average RGB of all pixels within a
 *   circular sample area centred at the relevant landmark(s):
 *
 *   skin   → nose landmark (centre-face, reliable proxy for face/skin tone)
 *   hair   → above the ear-midpoint (patches the scalp / hairline)
 *   top    → centroid of the four shoulder+hip landmarks (shirt centre)
 *   bottom → midpoint between hips and knees (thigh = trouser colour);
 *            if legs are not visible, derives a darker shade of the top colour
 *
 *   All coordinates are in raw (unmirrored) video space, matching the coordinate
 *   system used by MediaPipe landmarks.
 *
 * ── Privacy ───────────────────────────────────────────────────────────────────
 *   The offscreen canvas used for sampling is not stored, not exposed, and not
 *   uploaded.  clearCapture() sets colours back to null.
 */

import { useState, useCallback, useRef } from 'react';
import type { NormalizedLandmark } from '@mediapipe/tasks-vision';

export const COUNTDOWN_SECONDS = 10;

export interface AppearanceColors {
  skin:   string; // hex — face / skin tone
  hair:   string; // hex — hair colour
  top:    string; // hex — shirt / top
  bottom: string; // hex — pants / lower body
}

export interface BodyCaptureState {
  isCapturing: boolean;
  hasCaptured: boolean;
  colors:      AppearanceColors | null;
  countdown:   number | null;   // null = idle, 1-10 = counting, 0 = capturing
  error:       string | null;
}

// ── Pixel sampling helpers ────────────────────────────────────────────────────

/**
 * Average the RGB of all pixels inside a circle of the given radius.
 * Returns a hex colour string.  cx / cy are in pixel space.
 */
function sampleCircle(
  data: Uint8ClampedArray,
  cx: number, cy: number, radius: number,
  W: number, H: number,
): string {
  let r = 0, g = 0, b = 0, n = 0;
  const r2 = radius * radius;
  const x0 = Math.max(0, Math.floor(cx - radius));
  const x1 = Math.min(W - 1, Math.ceil(cx + radius));
  const y0 = Math.max(0, Math.floor(cy - radius));
  const y1 = Math.min(H - 1, Math.ceil(cy + radius));

  for (let py = y0; py <= y1; py++) {
    for (let px = x0; px <= x1; px++) {
      const dx = px - cx, dy = py - cy;
      if (dx * dx + dy * dy > r2) continue;
      const i = (py * W + px) * 4;
      r += data[i]; g += data[i + 1]; b += data[i + 2];
      n++;
    }
  }

  if (n === 0) return '#888888';
  const hex = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v / n))).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/**
 * Darken a hex colour by a factor (0–1).
 * Used to estimate pants colour when the lower body is not in frame.
 */
function darkenHex(hex: string, factor = 0.55): string {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = Math.round(((n >> 16) & 0xff) * factor);
  const g = Math.round(((n >>  8) & 0xff) * factor);
  const b = Math.round(((n      ) & 0xff) * factor);
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useBodyCapture() {
  const [state, setState] = useState<BodyCaptureState>({
    isCapturing: false,
    hasCaptured: false,
    colors:      null,
    countdown:   null,
    error:       null,
  });

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Internal: snapshot frame and sample appearance colours ────────────────
  const captureBody = useCallback(async (
    video: HTMLVideoElement,
    landmarks: NormalizedLandmark[],
  ) => {
    setState(s => ({ ...s, isCapturing: true, countdown: 0, error: null }));

    try {
      const W = video.videoWidth, H = video.videoHeight;
      if (W === 0 || H === 0) throw new Error('Video stream not ready.');

      // Draw the raw (unmirrored) frame to an offscreen canvas for pixel access.
      // This canvas is local to this function and discarded after sampling.
      const offscreen = document.createElement('canvas');
      offscreen.width = W; offscreen.height = H;
      const ctx = offscreen.getContext('2d')!;
      ctx.drawImage(video, 0, 0, W, H);
      const { data } = ctx.getImageData(0, 0, W, H);

      const sr = Math.round(W * 0.028); // sample radius ≈ 2.8% of frame width

      // ── Skin tone ──────────────────────────────────────────────────────────
      // Nose landmark (index 0) sits at the centre of the face; sampling there
      // captures the central skin tone reliably and avoids hair/clothing edges.
      const nose = landmarks[0];
      const skin = (nose?.visibility ?? 0) > 0.2
        ? sampleCircle(data, nose.x * W, nose.y * H, sr, W, H)
        : '#D4956A';

      // ── Hair colour ────────────────────────────────────────────────────────
      // The ear midpoint is a stable reference for the sides of the head.
      // Shifting 2.5× sample-radii upward from there typically lands on the
      // hairline or scalp region, away from skin and shirt.
      const lEar = landmarks[7], rEar = landmarks[8];
      let hair = '#2E1C0E';
      if (lEar && rEar && Math.min(lEar.visibility ?? 0, rEar.visibility ?? 0) > 0.2) {
        const earX = (lEar.x + rEar.x) / 2 * W;
        const earY = (lEar.y + rEar.y) / 2 * H - sr * 2.5;
        hair = sampleCircle(data, earX, earY, sr, W, H);
      }

      // ── Shirt / top colour ─────────────────────────────────────────────────
      // Centroid of the four shoulder + hip landmarks lands approximately at
      // the chest centre, away from arm shadows and collar/neckline edges.
      const lS = landmarks[11], rS = landmarks[12];
      const lH = landmarks[23], rH = landmarks[24];
      let top = '#1565C0';
      if (lS && rS && lH && rH) {
        const topX = (lS.x + rS.x + lH.x + rH.x) / 4 * W;
        const topY = (lS.y + rS.y + lH.y + rH.y) / 4 * H;
        top = sampleCircle(data, topX, topY, sr * 1.6, W, H);
      }

      // ── Pants / bottom colour ──────────────────────────────────────────────
      // Midpoint between hips and knees sits in the middle of the thigh.
      // If knees are not visible (< 0.3 confidence), the lower body is
      // probably cut off — derive pants colour by darkening the shirt colour.
      const lK = landmarks[25], rK = landmarks[26];
      const kneeVis = Math.min(lK?.visibility ?? 0, rK?.visibility ?? 0);
      let bottom: string;
      if (kneeVis >= 0.3 && lH && rH && lK && rK) {
        const botX = (lH.x + rH.x + lK.x + rK.x) / 4 * W;
        const botY = (lH.y + rH.y + lK.y + rK.y) / 4 * H;
        bottom = sampleCircle(data, botX, botY, sr, W, H);
      } else {
        // Lower body not visible — estimate a plausible darker trouser shade
        bottom = darkenHex(top, 0.55);
      }

      setState({
        isCapturing: false,
        hasCaptured: true,
        colors: { skin, hair, top, bottom },
        countdown: null,
        error: null,
      });

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setState(s => ({ ...s, isCapturing: false, countdown: null, error: msg }));
    }
  }, []);

  // ── Public: start the 10-second countdown then auto-capture ──────────────
  const startCountdown = useCallback((
    videoRef: React.RefObject<HTMLVideoElement | null>,
    getLandmarks: () => NormalizedLandmark[] | null,
  ) => {
    setState(s => {
      if (s.countdown !== null || s.isCapturing) return s;
      return { ...s, countdown: COUNTDOWN_SECONDS, error: null };
    });

    let remaining = COUNTDOWN_SECONDS;
    if (intervalRef.current !== null) clearInterval(intervalRef.current);

    intervalRef.current = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(intervalRef.current!);
        intervalRef.current = null;
        const video = videoRef.current;
        const lm    = getLandmarks();
        if (video && lm) {
          void captureBody(video, lm);
        } else {
          setState(s => ({ ...s, countdown: null, error: 'No pose detected at capture time. Please try again.' }));
        }
      } else {
        setState(s => ({ ...s, countdown: remaining }));
      }
    }, 1000);
  }, [captureBody]);

  const cancelCountdown = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setState(s => ({ ...s, countdown: null }));
  }, []);

  const clearCapture = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    // Colours are plain strings — nothing to release
    setState({ isCapturing: false, hasCaptured: false, colors: null, countdown: null, error: null });
  }, []);

  return { ...state, startCountdown, cancelCountdown, clearCapture };
}
