import { useCallback, useEffect } from 'react';
import { useCamera } from './hooks/useCamera';
import { usePoseDetection } from './hooks/usePoseDetection';
import { CameraFeed } from './components/CameraFeed';
import { PoseOverlay } from './components/PoseOverlay';
import { ThreeAvatar } from './components/ThreeAvatar';
import { PoseDebugPanel } from './components/PoseDebugPanel';
import './App.css';

const VIDEO_W = 640;
const VIDEO_H = 480;

export default function App() {
  const { videoRef, isActive, error: cameraError, startCamera, stopCamera } = useCamera();
  const {
    landmarks, isReady, isDetecting, fps, error: poseError,
    startDetection, stopDetection, reset,
  } = usePoseDetection(videoRef);

  // Auto-start detection once camera is active and model is ready
  useEffect(() => {
    if (isActive && isReady && !isDetecting) {
      startDetection();
    }
  }, [isActive, isReady, isDetecting, startDetection]);

  const handleStart = useCallback(async () => {
    await startCamera();
  }, [startCamera]);

  const handleStop = useCallback(() => {
    stopDetection();
    stopCamera();
  }, [stopDetection, stopCamera]);

  const handleReset = useCallback(() => {
    reset();
  }, [reset]);

  const error = cameraError || poseError;

  return (
    <div className="app">
      <header className="header">
        <h1 className="title">MotionMirror 3D</h1>
        <p className="subtitle">Real-time webcam motion capture in your browser.</p>
      </header>

      {error && (
        <div className="error-banner">⚠ {error}</div>
      )}

      {!isReady && (
        <div className="loading-bar">
          <span className="pulse">Loading pose model…</span>
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

        {/* RIGHT: 3D avatar */}
        <section className="panel panel-right">
          <div className="panel-label">3D Motion Avatar</div>
          <div className="canvas-container" style={{ aspectRatio: `${VIDEO_W}/${VIDEO_H}` }}>
            <ThreeAvatar landmarks={landmarks} />
            {!isActive && (
              <div className="canvas-overlay-hint">Start the camera to see your avatar</div>
            )}
          </div>
        </section>
      </main>

      <div className="controls">
        {!isActive ? (
          <button className="btn btn-primary" onClick={handleStart} disabled={!isReady}>
            {isReady ? '▶ Start Camera' : '⟳ Loading model…'}
          </button>
        ) : (
          <>
            <button className="btn btn-danger" onClick={handleStop}>■ Stop Camera</button>
            <button className="btn btn-secondary" onClick={handleReset}>↺ Reset Calibration</button>
          </>
        )}
      </div>

      <footer className="footer">
        Powered by MediaPipe Pose + Three.js · No backend required · No API keys
      </footer>
    </div>
  );
}
