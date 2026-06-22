import { useRef, useState, useCallback } from 'react';

export interface CameraState {
  isActive: boolean;
  error: string | null;
}

export function useCamera() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [state, setState] = useState<CameraState>({ isActive: false, error: null });

  const startCamera = useCallback(async () => {
    setState({ isActive: false, error: null });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setState({ isActive: true, error: null });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setState({ isActive: false, error: `Camera error: ${msg}` });
    }
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setState({ isActive: false, error: null });
  }, []);

  return { videoRef, ...state, startCamera, stopCamera };
}
