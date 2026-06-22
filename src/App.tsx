import { useCallback, useEffect, useRef, useState } from 'react';
import { useCamera } from './hooks/useCamera';
import { usePoseDetection } from './hooks/usePoseDetection';
import { useBodyCapture } from './hooks/useBodyCapture';
import { CameraFeed } from './components/CameraFeed';
import { PoseOverlay } from './components/PoseOverlay';
import { ThreeAvatar } from './components/ThreeAvatar';
import { HumanoidAvatar } from './components/HumanoidAvatar';
import { PoseDebugPanel } from './components/PoseDebugPanel';
import './App.css';

const VIDEO_W = 640;
const VIDEO_H = 480;

// 'skeleton' = existing stick-figure debug view (ThreeAvatar)
// 'humanoid' = new primitive-geometry avatar coloured by captured appearance
type AvatarMode = 'skeleton' | 'humanoid';

export default function App() {
  const { videoRef, isActive, error: cameraError, startCamera, stopCamera } = useCamera();
  const {
    landmarks, isReady, isDetecting, fps, error: poseError,
    startDetection, stopDetection, reset,
  } = usePoseDetection(videoRef);
  const {
    isCapturing, hasCaptured, colors, countdown, error: captureError,
    startCountdown, cancelCountdown, clearCapture,
  } = useBodyCapture();

  // Default to humanoid so the avatar is immediately visible on camera start
  const [avatarMode, setAvatarMode] = useState<AvatarMode>('humanoid');

  // Stable ref to latest landmarks so the countdown closure reads them at t=0
  // rather than the stale closure captured when the button was clicked.
  const landmarksRef = useRef(landmarks);
  useEffect(() => { landmarksRef.current = landmarks; }, [landmarks]);

  // Auto-start pose detection once camera and model are both ready
  useEffect(() => {
    if (isActive && isReady && !isDetecting) startDetection();
  }, [isActive, isReady, isDetecting, startDetection]);

  const handleStart = useCallback(async () => {
    await startCamera();
  }, [startCamera]);

  const handleStop = useCallback(() => {
    cancelCountdown();
    stopDetection();
    stopCamera();
    clearCapture();
    setAvatarMode('humanoid');
  }, [cancelCountdown, stopDetection, stopCamera, clearCapture]);

  const handleReset = useCallback(() => reset(), [reset]);

  const handleSampleAppearance = useCallback(() => {
    // Pass a ref-based getter so the countdown fires captureBody() with the
    // frame that exists at t=0, not the frame from when the button was clicked.
    startCountdown(videoRef, () => landmarksRef.current);
  }, [startCountdown, videoRef]);

  const handleClear = useCallback(() => {
    clearCapture();
  }, [clearCapture]);

  const error = cameraError || poseError || captureError;
  const isCounting = countdown !== null && !isCapturing;

  const panelLabel = avatarMode === 'skeleton' ? 'Debug Skeleton' : '3D Avatar';

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

      {/* 10-second countdown banner */}
      {isCounting && (
        <div className="countdown-banner">
          <span className="countdown-instruction">
            Stay still with your face and body visible. Sampling appearance in:
          </span>
          <span className="countdown-number">{countdown}</span>
          <button className="btn btn-cancel-countdown" onClick={cancelCountdown}>
            ✕ Cancel
          </button>
        </div>
      )}

      <main className="panels">
        {/* LEFT: live camera feed + 2D skeleton overlay */}
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

            {/* Large countdown number overlaid on the camera preview */}
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

        {/* RIGHT: 3D avatar — either debug skeleton or humanoid */}
        <section className="panel panel-right">
          <div className="panel-header-row">
            <div className="panel-label">{panelLabel}</div>
            {isActive && (
              <div className="mode-toggle">
                <button
                  className={`mode-btn ${avatarMode === 'humanoid' ? 'active' : ''}`}
                  onClick={() => setAvatarMode('humanoid')}
                >
                  3D Avatar
                </button>
                <button
                  className={`mode-btn ${avatarMode === 'skeleton' ? 'active' : ''}`}
                  onClick={() => setAvatarMode('skeleton')}
                >
                  Debug Skeleton
                </button>
              </div>
            )}
          </div>

          <div className="canvas-container" style={{ aspectRatio: `${VIDEO_W}/${VIDEO_H}` }}>
            {/* Conditionally mount each Canvas — only the active mode is in the DOM */}
            {avatarMode === 'humanoid' && (
              <HumanoidAvatar landmarks={landmarks} colors={colors} />
            )}
            {avatarMode === 'skeleton' && (
              <ThreeAvatar landmarks={landmarks} />
            )}

            {!isActive && (
              <div className="canvas-overlay-hint">Start the camera to see your avatar</div>
            )}

            {/* Colour chip strip — visible when appearance has been sampled */}
            {hasCaptured && colors && (
              <div className="color-chips">
                <span title="Skin tone"  style={{ background: colors.skin }}   />
                <span title="Hair"       style={{ background: colors.hair }}   />
                <span title="Top"        style={{ background: colors.top }}    />
                <span title="Bottom"     style={{ background: colors.bottom }} />
              </div>
            )}
          </div>
        </section>
      </main>

      {/* Controls */}
      <div className="controls">
        {!isActive ? (
          <button className="btn btn-primary" onClick={handleStart} disabled={!isReady}>
            {isReady ? '▶ Start Camera' : '⟳ Loading model…'}
          </button>
        ) : (
          <>
            <button className="btn btn-danger"    onClick={handleStop}>■ Stop Camera</button>
            <button className="btn btn-secondary" onClick={handleReset}>↺ Reset</button>

            {/* Sample Appearance — hidden while counting (Cancel is in the banner) */}
            {!hasCaptured && !isCounting && (
              <button
                className="btn btn-capture"
                onClick={handleSampleAppearance}
                disabled={isCapturing || !landmarks}
                title={!landmarks ? 'No pose detected yet' : undefined}
              >
                {isCapturing ? '⟳ Sampling…' : '🎨 Sample Appearance'}
              </button>
            )}

            {hasCaptured && (
              <button className="btn btn-clear" onClick={handleClear}>
                ✕ Reset Appearance
              </button>
            )}
          </>
        )}
      </div>

      <footer className="footer">
        Powered by MediaPipe Pose + Three.js · No backend · No API keys · No photos stored
      </footer>
    </div>
  );
}
