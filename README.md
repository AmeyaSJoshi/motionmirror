# MotionMirror 3D

> Real-time webcam motion capture in your browser.

A browser-based MVP that uses your webcam to detect body pose in real time and drives a 3D stick-figure avatar — no backend, no API keys, no installs beyond `npm`.

---

## Setup

```bash
npm install
npm run dev
```

Then open `http://localhost:5173` and click **Start Camera**.

---

## How it works

1. **Pose detection** — MediaPipe Pose Landmarker Lite runs entirely in the browser via WebAssembly + WebGL. It outputs 33 normalised (x, y, z, visibility) landmarks per frame from the webcam feed.

2. **2D overlay** — A `<canvas>` element sits on top of the mirrored `<video>` element. Each frame, the skeleton connections and joint circles are redrawn using the raw landmark coordinates scaled to the canvas size.

3. **3D avatar** — React Three Fiber renders a Three.js scene. Each landmark is mapped to a sphere ("joint") and pairs of landmarks are connected by cylinders ("bones"). Positions are updated every render frame with a small lerp factor for smooth movement. MediaPipe's coordinate system (x right, y down, z toward camera) is converted to Three.js world space (x right, y up, z toward viewer).

4. **No calibration required** — landmarks are normalised to `[0, 1]` relative to the frame, so the avatar works immediately regardless of where you stand.

---

## Architecture

```
src/
  hooks/
    useCamera.ts          Webcam access via getUserMedia
    usePoseDetection.ts   MediaPipe model loading + per-frame inference loop
  components/
    CameraFeed.tsx        <video> element
    PoseOverlay.tsx       Canvas 2D skeleton overlay
    ThreeAvatar.tsx       React Three Fiber scene (joints + bones)
    PoseDebugPanel.tsx    FPS / status HUD
  utils/
    poseConstants.ts      Landmark indices, skeleton connections, bone definitions
  App.tsx                 Layout + wiring
```

---

## Known limitations

- **Lite model only** — accuracy is reduced vs. the full model, especially for hands and fast movement.
- **Single person** — only one pose is tracked at a time.
- **No joint rotations** — the 3D avatar moves joints by position only; no inverse kinematics or rotation propagation.
- **GPU delegate** — falls back to CPU if WebGL is unavailable, which will be slower.
- **No depth calibration** — the Z axis from MediaPipe is relative and approximate; the avatar can look flat during certain poses.
- **CDN dependency at startup** — the WASM runtime and model file are fetched from jsDelivr/GCS on first load (~10–15 MB).

---

## Next steps

- Swap in the full `pose_landmarker_full` model for better accuracy.
- Add bone rotation via quaternion interpolation for a more natural avatar.
- Replace the stick figure with a skinned mesh (e.g. a GLTF character driven by pose data).
- Cache the model file with a Service Worker to eliminate the CDN dependency after first load.
- Add multi-person tracking (`numPoses > 1`).
- Export motion data as BVH or JSON for use in other 3D tools.
