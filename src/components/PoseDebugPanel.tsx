interface Props {
  isReady: boolean;
  isDetecting: boolean;
  fps: number;
  landmarkCount: number;
}

export function PoseDebugPanel({ isReady, isDetecting, fps, landmarkCount }: Props) {
  const modelStatus = isReady ? '✓ Loaded' : '⟳ Loading…';
  const detectionStatus = isDetecting
    ? landmarkCount > 0
      ? '● Pose detected'
      : '○ No pose'
    : '— Stopped';

  return (
    <div
      style={{
        position: 'absolute',
        top: 10,
        left: 10,
        background: 'rgba(0,0,0,0.65)',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 8,
        padding: '8px 12px',
        fontFamily: 'monospace',
        fontSize: 12,
        color: '#ccc',
        lineHeight: 1.8,
        backdropFilter: 'blur(6px)',
        zIndex: 10,
      }}
    >
      <div style={{ color: isReady ? '#69f0ae' : '#ffd740' }}>Model: {modelStatus}</div>
      <div style={{ color: isDetecting && landmarkCount > 0 ? '#ff4081' : '#888' }}>{detectionStatus}</div>
      <div>FPS: <span style={{ color: fps >= 20 ? '#69f0ae' : fps >= 10 ? '#ffd740' : '#ff5252' }}>{fps}</span></div>
      <div>Joints: {landmarkCount}</div>
    </div>
  );
}
