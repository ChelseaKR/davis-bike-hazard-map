/**
 * PhotoEditor — the privacy gate's user-facing half.
 *
 * These tests assert the privacy invariants the component exists to enforce:
 *   - oversized raw files are rejected before they are ever read into memory;
 *   - EXIF is detected and stripped, and the badge tells the user GPS was found;
 *   - the data URL that leaves the device via onComplete is EXIF-clean;
 *   - auto-detect seeds blur boxes but never throws, and manual blur/clear work;
 *   - unreadable images degrade to a friendly error.
 *
 * jsdom has no real 2D canvas (getContext('2d') is null) and never decodes an
 * <img>, so we stub a deterministic Image. That also exercises the documented
 * graceful-degradation path (no canvas -> EXIF-stripped, un-blurred base image).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PhotoEditor } from '../../src/components/PhotoEditor.tsx';
import { hasExif, dataUrlToBytes } from '../../shared/exif.ts';

/** Build a tiny structurally valid JPEG, optionally carrying an EXIF segment. */
function makeJpeg(opts: { exif?: boolean; scanBytes?: number } = {}): Uint8Array<ArrayBuffer> {
  const head: number[] = [0xff, 0xd8]; // SOI
  if (opts.exif) {
    const payload = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0xde, 0xad]; // "Exif\0\0" + data
    const len = payload.length + 2;
    head.push(0xff, 0xe1, (len >> 8) & 0xff, len & 0xff, ...payload);
  }
  head.push(0xff, 0xe0, 0x00, 0x04, 0x10, 0x20); // APP0/JFIF (kept)
  head.push(0xff, 0xda, 0x00, 0x03, 0x55); // SOS header
  const tail = [0x12, 0x34, 0xff, 0xd9]; // scan + EOI
  const scan = opts.scanBytes ?? 0;
  // Build large buffers without spreading a huge array (which overflows the
  // stack). Allocate over an explicit ArrayBuffer so the result is a valid
  // BlobPart for `new File(...)`.
  const out = new Uint8Array(new ArrayBuffer(head.length + scan + tail.length));
  out.set(head, 0);
  out.fill(0x55, head.length, head.length + scan);
  out.set(tail, head.length + scan);
  return out;
}

function jpegFile(opts: { exif?: boolean; scanBytes?: number } = {}, name = 'photo.jpg'): File {
  return new File([makeJpeg(opts)], name, { type: 'image/jpeg' });
}

/** A deterministic <img> that resolves onload with a fixed natural size. */
class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 800;
  naturalHeight = 600;
  set src(_v: string) {
    queueMicrotask(() => this.onload?.());
  }
}

function fileInput(): HTMLInputElement {
  const input = document.querySelector('input[type="file"]');
  if (!input) throw new Error('file input not found');
  return input as HTMLInputElement;
}

beforeEach(() => {
  vi.stubGlobal('Image', FakeImage as unknown as typeof Image);
  // jsdom has no real 2D canvas; return null quietly (the path the component is
  // designed to degrade through) instead of letting jsdom log "Not implemented".
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('PhotoEditor privacy flow', () => {
  it('rejects an oversized raw file before reading it into memory', async () => {
    const onComplete = vi.fn();
    render(<PhotoEditor onComplete={onComplete} onCancel={vi.fn()} />);

    const big = jpegFile();
    Object.defineProperty(big, 'size', { value: 26 * 1024 * 1024 });
    await userEvent.upload(fileInput(), big);

    expect(await screen.findByRole('alert')).toHaveTextContent(/under 25 MB/i);
    // Never advanced to the editor stage.
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('announces that EXIF GPS was found and stripped for a tagged JPEG', async () => {
    render(<PhotoEditor onComplete={vi.fn()} onCancel={vi.fn()} />);

    await userEvent.upload(fileInput(), jpegFile({ exif: true }));

    const badge = await screen.findByRole('status');
    expect(badge).toHaveTextContent(/EXIF GPS found and stripped/i);
    // The editing surface and privacy actions are now available.
    expect(screen.getByRole('img', { name: /drag across faces/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /auto-blur faces/i })).toBeInTheDocument();
  });

  it('does not claim EXIF was present for a clean JPEG', async () => {
    render(<PhotoEditor onComplete={vi.fn()} onCancel={vi.fn()} />);

    await userEvent.upload(fileInput(), jpegFile({ exif: false }));

    const badge = await screen.findByRole('status');
    expect(badge).toHaveTextContent(/Location metadata removed/i);
    expect(badge).not.toHaveTextContent(/EXIF GPS found/i);
  });

  it('hands back an EXIF-clean data URL — the only thing that leaves the device', async () => {
    const onComplete = vi.fn();
    render(<PhotoEditor onComplete={onComplete} onCancel={vi.fn()} />);

    await userEvent.upload(fileInput(), jpegFile({ exif: true }));
    await screen.findByRole('status');

    await userEvent.click(screen.getByRole('button', { name: /use photo/i }));

    expect(onComplete).toHaveBeenCalledTimes(1);
    const result = onComplete.mock.calls[0][0] as string;
    expect(result.startsWith('data:image/jpeg')).toBe(true);
    expect(hasExif(dataUrlToBytes(result).bytes)).toBe(false);
  });

  it('rejects a photo that will not compress under the upload limit', async () => {
    render(<PhotoEditor onComplete={vi.fn()} onCancel={vi.fn()} />);

    // ~3.3 MB of scan data -> base64 base image exceeds MAX_PHOTO_BYTES * 1.4.
    await userEvent.upload(fileInput(), jpegFile({ scanBytes: 3_300_000 }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/too detailed to compress/i);
  });

  it('shows a friendly error when the image cannot be decoded', async () => {
    class BrokenImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_v: string) {
        queueMicrotask(() => this.onerror?.());
      }
    }
    vi.stubGlobal('Image', BrokenImage as unknown as typeof Image);

    render(<PhotoEditor onComplete={vi.fn()} onCancel={vi.fn()} />);
    await userEvent.upload(fileInput(), jpegFile({ exif: true }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Could not read that image/i);
  });

  it('calls onCancel when the photo is removed', async () => {
    const onCancel = vi.fn();
    render(<PhotoEditor onComplete={vi.fn()} onCancel={onCancel} />);

    await userEvent.upload(fileInput(), jpegFile({ exif: true }));
    await screen.findByRole('status');

    await userEvent.click(screen.getByRole('button', { name: /remove photo/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe('PhotoEditor blur controls', () => {
  it('auto-seeds blur boxes when a FaceDetector is available, then clears them', async () => {
    (globalThis as { FaceDetector?: unknown }).FaceDetector = class {
      detect() {
        return Promise.resolve([{ boundingBox: { x: 10, y: 10, width: 40, height: 40 } }]);
      }
    };

    render(<PhotoEditor onComplete={vi.fn()} onCancel={vi.fn()} />);
    await userEvent.upload(fileInput(), jpegFile({ exif: true }));
    await screen.findByRole('status');

    await userEvent.click(screen.getByRole('button', { name: /auto-blur faces/i }));

    await waitFor(() =>
      expect(screen.getByText(/Auto-blurred 1 face\./i)).toBeInTheDocument(),
    );
    const clear = screen.getByRole('button', { name: /clear blur \(1\)/i });
    expect(clear).toBeEnabled();

    await userEvent.click(clear);
    expect(screen.getByRole('button', { name: /clear blur \(0\)/i })).toBeDisabled();

    delete (globalThis as { FaceDetector?: unknown }).FaceDetector;
  });

  it('reports when auto-detect finds no faces (manual blur still offered)', async () => {
    // No FaceDetector on globalThis -> detectFacesIfAvailable returns [].
    delete (globalThis as { FaceDetector?: unknown }).FaceDetector;

    render(<PhotoEditor onComplete={vi.fn()} onCancel={vi.fn()} />);
    await userEvent.upload(fileInput(), jpegFile({ exif: true }));
    await screen.findByRole('status');

    await userEvent.click(screen.getByRole('button', { name: /auto-blur faces/i }));

    await waitFor(() =>
      expect(screen.getByText(/No faces detected automatically/i)).toBeInTheDocument(),
    );
  });

  it('adds a blur region from a pointer drag across the canvas', async () => {
    // jsdom ships no PointerEvent or pointer-capture; polyfill the bits the
    // editor touches (MouseEvent carries clientX/Y) so the drag math runs.
    class FakePointerEvent extends MouseEvent {
      pointerId: number;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 0;
      }
    }
    vi.stubGlobal('PointerEvent', FakePointerEvent);
    Element.prototype.setPointerCapture = vi.fn();

    render(<PhotoEditor onComplete={vi.fn()} onCancel={vi.fn()} />);
    await userEvent.upload(fileInput(), jpegFile({ exif: true }));
    await screen.findByRole('status');

    const canvas = screen.getByRole('img', { name: /drag across faces/i });
    // Map CSS pixels 1:1 to image pixels so the drag coordinates are predictable.
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 800,
      height: 600,
      right: 800,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    const { fireEvent } = await import('@testing-library/react');
    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 120, clientY: 120, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 120, clientY: 120, pointerId: 1 });

    // A drag larger than the 4px threshold registers exactly one blur region.
    expect(screen.getByRole('button', { name: /clear blur \(1\)/i })).toBeInTheDocument();
  });
});
