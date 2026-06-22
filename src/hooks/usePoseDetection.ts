import { useEffect, useRef, useState, useCallback } from 'react';
import { PoseLandmarker, FilesetResolver, type NormalizedLandmark } from '@mediapipe/tasks-vision';

export interface PoseDetectionState {
  landmarks: NormalizedLandmark[] | null;
  isReady: boolean;
  isDetecting: boolean;
  fps: number;
  error: string | null;
}

export function usePoseDetection(videoRef: React.RefObject<HTMLVideoElement | null>) {
  const landmarkerRef = useRef<PoseLandmarker | null>(null);
  const animFrameRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const fpsCounterRef = useRef<number[]>([]);

  const [state, setState] = useState<PoseDetectionState>({
    landmarks: null,
    isReady: false,
    isDetecting: false,
    fps: 0,
    error: null,
  });

  // Load MediaPipe WASM + model once
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
        );
        const landmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task',
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numPoses: 1,
          minPoseDetectionConfidence: 0.5,
          minPosePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
        if (!cancelled) {
          landmarkerRef.current = landmarker;
          setState(s => ({ ...s, isReady: true }));
        }
      } catch (err) {
        if (!cancelled) {
          setState(s => ({ ...s, error: `Failed to load pose model: ${err}` }));
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const detect = useCallback((now: number) => {
    const video = videoRef.current;
    const landmarker = landmarkerRef.current;
    if (!video || !landmarker || video.readyState < 2) {
      animFrameRef.current = requestAnimationFrame(detect);
      return;
    }

    // Throttle to ~30fps to keep GPU load reasonable
    if (now - lastTimeRef.current < 33) {
      animFrameRef.current = requestAnimationFrame(detect);
      return;
    }

    const result = landmarker.detectForVideo(video, now);
    lastTimeRef.current = now;

    // Rolling FPS over last 10 frames
    fpsCounterRef.current.push(now);
    if (fpsCounterRef.current.length > 10) fpsCounterRef.current.shift();
    const elapsed = fpsCounterRef.current[fpsCounterRef.current.length - 1] - fpsCounterRef.current[0];
    const fps = elapsed > 0 ? Math.round((fpsCounterRef.current.length - 1) / (elapsed / 1000)) : 0;

    setState(s => ({
      ...s,
      landmarks: result.landmarks[0] ?? null,
      fps,
    }));

    animFrameRef.current = requestAnimationFrame(detect);
  }, [videoRef]);

  const startDetection = useCallback(() => {
    setState(s => ({ ...s, isDetecting: true }));
    animFrameRef.current = requestAnimationFrame(detect);
  }, [detect]);

  const stopDetection = useCallback(() => {
    cancelAnimationFrame(animFrameRef.current);
    setState(s => ({ ...s, isDetecting: false, landmarks: null, fps: 0 }));
  }, []);

  const reset = useCallback(() => {
    fpsCounterRef.current = [];
    setState(s => ({ ...s, landmarks: null, fps: 0 }));
  }, []);

  useEffect(() => () => cancelAnimationFrame(animFrameRef.current), []);

  return { ...state, startDetection, stopDetection, reset };
}
