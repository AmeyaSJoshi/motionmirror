import { useCallback, useEffect, useRef } from 'react';
import { useCamera } from './hooks/useCamera';
import { usePoseDetection } from './hooks/usePoseDetection';
import { useBodyCapture } from './hooks/useBodyCapture';
import { CameraFeed } from './components/CameraFeed';
import { PoseOverlay } from './components/PoseOverlay';
import { ThreeAvatar } from './components/ThreeAvatar';
import { PhotoPuppet } from './components/PhotoPuppet';
import { PoseDebugPanel } from './components/PoseDebugPanel';
import { useState } from 'react';
import './App.css';

const VIDEO_W = 640;
const VIDEO_H = 480;

type AvatarMode = 'skeleton' | 'photo';

export default function App() {
  const { videoRef, isActive, error: cameraError, startCamera, stopCamera } = useCamera();
  const {
    landmarks, isReady, isDetecting, fps, error: poseError,
    startDetection, stopDetection, reset,
  } = usePoseDetection(videoRef);
  const {
    isCapturing, hasCaptured, capturedRegions, countdown, error: captureError,
    startCountdown, cancelCountdown, clearCapture,
  } = useBodyCapture();

  const [avatarMode, setAvatarMode] = useState<AvatarMode>('skeleton');

  // Stable ref to latest landmarks so the countdown closure can read them at t=0
  const landmarksRef = useRef(landmarks);
  useEffect(() => { landmarksRef.current = landmarks; }, [landmarks]);

  // Auto-start detection once camera is active and model is ready
  useEffect(() => {
    if (isActive && isReady && !isDetecting) startDetection();
  }, [isActive, isReady, isDetecting, startDetection]);

  // Auto-switch to photo mode after a successful capture
  useEffect(() => {
    if (hasCaptured) setAvatarMode('photo');
  }, [hasCaptured]);

  const handleStart = useCallback(async () => {
    await startCamera();
  }, [startCamera]);

  const handleStop = useCallback(() => {
    cancelCountdown();
    stopDetection();
    stopCamera();
    clearCapture();
    setAvatarMode('skeleton');
  }, [cancelCountdown, stopDetection, stopCamera, clearCapture]);

  const handleReset = useCallback(() => reset(), [reset]);

  const handleCaptureClick = useCallback(() => {
    // Pass a getter for live landmarks so the countdown fires captureBody()
    // with the frame that exists at t=0, not the frame when the button was clicked.
    startCountdown(videoRef, () => landmarksRef.current);
  }, [startCountdown, videoRef]);

  const handleClear = useCallback(() => {
    clearCapture();
    setAvatarMode('skeleton');
  }, [clearCapture]);

  const error = cameraError || poseError || captureError;
  const isCounting = countdown !== null && !isCapturing;

  return (
    <div className="app">
      <header className="header">
        <h1 className="title">MotionMirror 3D</h1>
        <p className="subtitle">Real-time webcam motion capture in your browser.</p>
      </header>

      {error && <div className="error-banner">⚠ {error}</div>}

      {!isReady && (
        <div className="loading-bar">
          <span className="pulse">Loading pose model…</span>
        </div>
      )}

      {/* ── Countdown overlay ─────────────────────────────────────────────── */}
      {isCounting && (
        <div className="countdown-banner">
          <span className="countdown-instruction">
            Stand fully in frame — A-pose or T-pose, arms out. Capture begins in:
          </span>
          <span className="countdown-number">{countdown}</span>
          <button className="btn btn-cancel-countdown" onClick={cancelCountdown}>
            ✕ Cancel Capture
          </button>
        </div>
      )}

      <main className="panels">
        {/* LEFT: Webcam + 2D skeleton overlay */}
        <section className="panel panel-left">
          <div className="panel-label">Live Camera</div>
          <div className="video-container" style={{ aspectRatio: `${VIDEO_W}/${VIDEO_H}` }}>
            {!isActive && (
              <div className="placeholder">
                <div className="placeholder-icon">📷</div>
                <div>Camera not started</div>
              </div>
            )}
            <CameraFeed videoRef={videoRef} isActive={isActive} />
            <PoseOverlay landmarks={landmarks} width={VIDEO_W} height={VIDEO_H} />

            {/* Inline countdown display over the camera feed while counting */}
            {isCounting && (
              <div className="camera-countdown-overlay">
                <div className="camera-countdown-number">{countdown}</div>
              </div>
            )}

            <PoseDebugPanel
              isReady={isReady}
              isDetecting={isDetecting}
              fps={fps}
              landmarkCount={landmarks?.length ?? 0}
            />
          </div>
        </section>

        {/* RIGHT: Avatar panel */}
        <section className="panel panel-right">
          <div className="panel-header-row">
            <div className="panel-label">
              {avatarMode === 'skeleton' ? '3D Skeleton' : 'Photo Body'}
            </div>
            {isActive && (
              <div className="mode-toggle">
                <button
                  className={`mode-btn ${avatarMode === 'skeleton' ? 'active' : ''}`}
                  onClick={() => setAvatarMode('skeleton')}
                >
                  Debug Skeleton
                </button>
                <button
                  className={`mode-btn ${avatarMode === 'photo' ? 'active' : ''}`}
                  onClick={() => setAvatarMode('photo')}
                  disabled={!hasCaptured}
                  title={!hasCaptured ? 'Capture your body first' : undefined}
                >
                  Photo Body
                </button>
              </div>
            )}
          </div>

          <div className="canvas-container" style={{ aspectRatio: `${VIDEO_W}/${VIDEO_H}` }}>
            <div style={{ display: avatarMode === 'skeleton' ? 'block' : 'none', position: 'absolute', inset: 0 }}>
              <ThreeAvatar landmarks={landmarks} />
            </div>

            {avatarMode === 'photo' && (
              <PhotoPuppet
                landmarks={landmarks}
                regions={capturedRegions}
                width={VIDEO_W}
                height={VIDEO_H}
              />
            )}

            {!isActive && (
              <div className="canvas-overlay-hint">Start the camera to see your avatar</div>
            )}
          </div>
        </section>
      </main>

      {/* ── Controls ──────────────────────────────────────────────────────── */}
      <div className="controls">
        {!isActive ? (
          <button className="btn btn-primary" onClick={handleStart} disabled={!isReady}>
            {isReady ? '▶ Start Camera' : '⟳ Loading model…'}
          </button>
        ) : (
          <>
            <button className="btn btn-danger" onClick={handleStop}>■ Stop Camera</button>
            <button className="btn btn-secondary" onClick={handleReset}>↺ Reset</button>

            {/* Capture button — hidden while counting (cancel is in the banner) */}
            {!hasCaptured && !isCounting && (
              <button
                className="btn btn-capture"
                onClick={handleCaptureClick}
                disabled={isCapturing || !landmarks}
                title={!landmarks ? 'No pose detected yet' : undefined}
              >
                {isCapturing ? '⟳ Capturing…' : '🧍 Capture Body'}
              </button>
            )}

            {hasCaptured && (
              <button className="btn btn-clear" onClick={handleClear}>
                🗑 Clear Captured Body
              </button>
            )}
          </>
        )}
      </div>

      <footer className="footer">
        Powered by MediaPipe Pose + Three.js · No backend · No API keys · Photos never uploaded
      </footer>
    </div>
  );
}
