/**
 * PhotoEditor — the privacy gate's user-facing half.
 *
 * Flow: pick a photo -> EXIF stripped immediately (byte-level) -> downscaled to
 * a mobile-friendly size on a canvas -> the cyclist draws blur boxes over faces
 * or plates (optionally auto-seeded) -> we export a re-encoded JPEG, which has
 * no metadata and the redactions baked in. Only that result leaves the device.
 *
 * Canvas is required for blur; where it is unavailable (e.g. a headless test
 * env) we degrade gracefully to the EXIF-stripped, un-blurred image and say so.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  pixelateRegions,
  rectFromCorners,
  detectFacesIfAvailable,
  type BlurRegion,
} from '../lib/blur.ts';
import { dataUrlToBytes, hasExif, stripExifFromDataUrl } from '../lib/exif.ts';
import { computeScaledDimensions, fileToDataUrl } from '../lib/photo.ts';
import { config } from '../config.ts';

interface PhotoEditorProps {
  onComplete: (dataUrl: string) => void;
  onCancel: () => void;
}

interface Loaded {
  /** EXIF-stripped, downscaled base image as a data URL. */
  baseUrl: string;
  width: number;
  height: number;
  exifWasPresent: boolean;
}

export function PhotoEditor({ onComplete, onCancel }: PhotoEditorProps) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [regions, setRegions] = useState<BlurRegion[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoNote, setAutoNote] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const [dragRect, setDragRect] = useState<BlurRegion | null>(null);

  const handleFile = useCallback(async (file: File) => {
    setError(null);
    setBusy(true);
    try {
      const raw = await fileToDataUrl(file);
      const exifWasPresent =
        file.type === 'image/jpeg' && hasExif(dataUrlToBytes(raw).bytes);
      const stripped = stripExifFromDataUrl(raw);

      // Load to measure, then downscale on a canvas for a small base image.
      const img = await loadImage(stripped);
      const dims = computeScaledDimensions(
        { width: img.naturalWidth, height: img.naturalHeight },
        config.maxPhotoEdge,
      );

      const ctx = makeCanvas(dims.width, dims.height);
      let baseUrl = stripped;
      if (ctx) {
        ctx.drawImage(img, 0, 0, dims.width, dims.height);
        baseUrl = ctx.canvas.toDataURL('image/jpeg', config.photoQuality);
      }

      imgRef.current = await loadImage(baseUrl);
      setRegions([]);
      setLoaded({ baseUrl, width: dims.width, height: dims.height, exifWasPresent });
    } catch {
      setError('Could not read that image. Please try another photo.');
    } finally {
      setBusy(false);
    }
  }, []);

  // Repaint the preview canvas whenever the image, regions, or drag change.
  useEffect(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!loaded || !canvas || !img) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const previewRegions = dragRect ? [...regions, dragRect] : regions;
    if (previewRegions.length) {
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      pixelateRegions(data.data, canvas.width, canvas.height, previewRegions);
      ctx.putImageData(data, 0, 0);
    }
  }, [loaded, regions, dragRect]);

  const toImageCoords = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !loaded) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = loaded.width / rect.width;
    const scaleY = loaded.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStart.current = toImageCoords(e);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragStart.current) return;
    const p = toImageCoords(e);
    setDragRect(rectFromCorners(dragStart.current.x, dragStart.current.y, p.x, p.y));
  };
  const onPointerUp = () => {
    if (dragRect && dragRect.w > 4 && dragRect.h > 4) {
      setRegions((prev) => [...prev, dragRect]);
    }
    dragStart.current = null;
    setDragRect(null);
  };

  const autoDetect = useCallback(async () => {
    if (!imgRef.current) return;
    setBusy(true);
    const found = await detectFacesIfAvailable(imgRef.current);
    setBusy(false);
    if (found.length) {
      setRegions((prev) => [...prev, ...found]);
      setAutoNote(`Auto-blurred ${found.length} face${found.length === 1 ? '' : 's'}.`);
    } else {
      setAutoNote('No faces detected automatically — drag to blur any manually.');
    }
  }, []);

  const usePhoto = useCallback(() => {
    if (!loaded) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    // Re-encode through the canvas (with redactions) -> strips metadata again.
    const result =
      canvas && ctx ? canvas.toDataURL('image/jpeg', config.photoQuality) : loaded.baseUrl;
    onComplete(result);
  }, [loaded, onComplete]);

  return (
    <section className="photo-editor" aria-label="Photo privacy editor">
      {!loaded && (
        <div className="photo-picker">
          <label className="btn btn-primary file-label">
            {busy ? 'Processing…' : 'Add a photo'}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="visually-hidden"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFile(file);
              }}
            />
          </label>
          <p className="hint">
            Photos are stripped of location data and you can blur faces or plates
            before anything is saved. This happens on your device.
          </p>
        </div>
      )}

      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}

      {loaded && (
        <div className="photo-stage">
          <p className="privacy-badge" role="status">
            <span aria-hidden="true">🔒</span> Location metadata removed
            {loaded.exifWasPresent ? ' (EXIF GPS found and stripped)' : ''}.
          </p>

          <canvas
            ref={canvasRef}
            width={loaded.width}
            height={loaded.height}
            className="blur-canvas"
            role="img"
            aria-label="Photo preview. Drag across faces or licence plates to blur them."
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          />

          {autoNote && (
            <p className="hint" role="status">
              {autoNote}
            </p>
          )}

          <div className="editor-actions">
            <button type="button" className="btn" onClick={autoDetect} disabled={busy}>
              Auto-blur faces
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => setRegions([])}
              disabled={!regions.length}
            >
              Clear blur ({regions.length})
            </button>
            <button type="button" className="btn" onClick={onCancel}>
              Remove photo
            </button>
            <button type="button" className="btn btn-primary" onClick={usePhoto}>
              Use photo
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image load failed'));
    img.src = src;
  });
}

function makeCanvas(width: number, height: number): CanvasRenderingContext2D | null {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas.getContext('2d');
}
