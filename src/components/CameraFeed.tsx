import React from 'react';

interface Props {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  isActive: boolean;
}

export function CameraFeed({ videoRef, isActive }: Props) {
  return (
    <video
      ref={videoRef}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        transform: 'scaleX(-1)', // mirror so it feels natural
        opacity: isActive ? 1 : 0,
        transition: 'opacity 0.3s',
        borderRadius: '12px',
      }}
      playsInline
      muted
    />
  );
}
