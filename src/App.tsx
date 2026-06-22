import { useCallback, useEffect, useState } from 'react';
import { useCamera } from './hooks/useCamera';
import { usePoseDetection } from './hooks/usePoseDetection';
import { useBodyCapture } from './hooks/useBodyCapture';
import { CameraFeed } from './components/CameraFeed';
import { PoseOverlay } from './components/PoseOverlay';
import { ThreeAvatar } from './components/ThreeAvatar';
import { PhotoPuppet } from './components/PhotoPuppet';
import { PoseDebugPanel } from './components/PoseDebugPanel';
import './App.css';

const VIDEO_W = 640;
const VIDEO_H = 480;

// Avatar display modes for the right panel
type AvatarMode = 'skeleton' | 'photo';

export default function App() {
  const { videoRef, isActive, error: cameraError, startCamera, stopCamera } = useCamera();
  const {
    landmarks, isReady, isDetecting, fps, error: poseError,
    startDetection, stopDetection, reset,
  } = usePoseDetection(videoRef);
  const {
    isCapturing, hasCaptured, capturedRegions, error: captureError,
    captureBody, clearCapture,
  } = useBodyCapture();

  const [avatarMode, setAvatarMode] = useState<AvatarMode>('skeleton');
  // Show capture instruction banner when user clicks "Capture Body"
  const [showCaptureHint, setShowCaptureHint] = useState(false);

  // Auto-start detection once camera is active and model is ready
  useEffect(() => {
    if (isActive && isReady && !isDetecting) startDetection();
  }, [isActive, isReady, isDetecting, startDetection]);

  const handleStart = useCallback(async () => {
    await startCamera();
  }, [startCamera]);

  const handleStop = useCallback(() => {
    stopDetection();
    stopCamera();
    clearCapture();
    setShowCaptureHint(false);
  }, [stopDetection, stopCamera, clearCapture]);

  const handleReset = useCallback(() => reset(), [reset]);

  // First click: show the T-pose instruction
  // Second click (while hint is showing): actually capture
  const handleCaptureClick = useCallback(async () => {
    if (!showCaptureHint) {
      setShowCaptureHint(true);
      return;
    }
    if (!videoRef.current || !landmarks) return;
    setShowCaptureHint(false);
    await captureBody(videoRef.current, landmarks);
    setAvatarMode('photo');
  }, [showCaptureHint, videoRef, landmarks, captureBody]);

  const handleClear = useCallback(() => {
    clearCapture();
    setAvatarMode('skeleton');
    setShowCaptureHint(false);
  }, [clearCapture]);

  const error = cameraError || poseError || captureError;

  const rightPanelLabel =
    avatarMode === 'skeleton' ? '3D Skeleton' : 'Photo Body';

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

      {/* T-pose instruction banner */}
      {showCaptureHint && (
        <div className="capture-hint">
          <strong>Stand in a T-pose or A-pose</strong> — arms out, full body visible in the camera.
          Then click <strong>Capture Now</strong> below.
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
            <PoseDebugPanel
              isReady={isReady}
              isDetecting={isDetecting}
              fps={fps}
              landmarkCount={landmarks?.length ?? 0}
            />
          </div>
        </section>

        {/* RIGHT: Avatar panel — switches between 3D skeleton and photo puppet */}
        <section className="panel panel-right">
          <div className="panel-header-row">
            <div className="panel-label">{rightPanelLabel}</div>
            {/* Mode toggle — only show when camera is active */}
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
            {/* Always mount ThreeAvatar — hide it in photo mode to preserve state */}
            <div style={{ display: avatarMode === 'skeleton' ? 'block' : 'none', position: 'absolute', inset: 0 }}>
              <ThreeAvatar landmarks={landmarks} />
            </div>

            {/* Photo puppet — only rendered in photo mode */}
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

      {/* Controls */}
      <div className="controls">
        {!isActive ? (
          <button className="btn btn-primary" onClick={handleStart} disabled={!isReady}>
            {isReady ? '▶ Start Camera' : '⟳ Loading model…'}
          </button>
        ) : (
          <>
            <button className="btn btn-danger" onClick={handleStop}>■ Stop Camera</button>
            <button className="btn btn-secondary" onClick={handleReset}>↺ Reset</button>

            {/* Capture Body — two-step: instruction → capture */}
            {!hasCaptured && (
              <button
                className={`btn ${showCaptureHint ? 'btn-capture-ready' : 'btn-capture'}`}
                onClick={handleCaptureClick}
                disabled={isCapturing || !landmarks}
                title={!landmarks ? 'No pose detected yet' : undefined}
              >
                {isCapturing
                  ? '⟳ Capturing…'
                  : showCaptureHint
                    ? '📸 Capture Now'
                    : '🧍 Capture Body'}
              </button>
            )}

            {/* Clear — removes stored photo for privacy */}
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
