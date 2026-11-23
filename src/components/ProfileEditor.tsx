import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  Download,
  Eye,
  ImagePlus,
  Maximize2,
  X,
} from 'lucide-react';
import { CampaignConfig } from '../types/campaign';

interface ProfileEditorProps {
  config: CampaignConfig;
}

interface CutoutBounds {
  cx: number;
  cy: number;
  width: number;
  height: number;
}

const PREVIEW_CANVAS_SIZE = 1000;
const DOWNLOAD_EXPORT_SIZE = 2000;

function detectCutoutBounds(frameImg: HTMLImageElement): CutoutBounds {
  const sampleSize = 120;
  const offscreen = document.createElement('canvas');
  offscreen.width = sampleSize;
  offscreen.height = sampleSize;
  const ctx = offscreen.getContext('2d');
  if (!ctx) {
    return { cx: 0.5, cy: 0.5, width: 1, height: 1 };
  }

  ctx.drawImage(frameImg, 0, 0, sampleSize, sampleSize);
  const data = ctx.getImageData(0, 0, sampleSize, sampleSize).data;

  let minX = sampleSize;
  let minY = sampleSize;
  let maxX = 0;
  let maxY = 0;
  let count = 0;

  // Scan inner campaign region (15%..85% X, 4%..80% Y) to isolate the photo cutout
  const startX = Math.floor(sampleSize * 0.15);
  const endX = Math.ceil(sampleSize * 0.85);
  const startY = Math.floor(sampleSize * 0.04);
  const endY = Math.ceil(sampleSize * 0.8);

  for (let y = startY; y < endY; y++) {
    for (let x = startX; x < endX; x++) {
      const alpha = data[(y * sampleSize + x) * 4 + 3];
      if (alpha < 35) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        count++;
      }
    }
  }

  if (count < 40 || maxX <= minX || maxY <= minY) {
    return { cx: 0.5, cy: 0.5, width: 1, height: 1 };
  }

  return {
    cx: (minX + maxX) / 2 / sampleSize,
    cy: (minY + maxY) / 2 / sampleSize,
    width: (maxX - minX + 1) / sampleSize,
    height: (maxY - minY + 1) / sampleSize,
  };
}

export const ProfileEditor: React.FC<ProfileEditorProps> = ({
  config,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const downloadInFlightRef = useRef(false);

  const [frameImage, setFrameImage] = useState<HTMLImageElement | null>(null);
  const [frameError, setFrameError] = useState<string | null>(null);
  const [cutout, setCutout] = useState<CutoutBounds>({ cx: 0.5, cy: 0.35, width: 0.48, height: 0.58 });

  const [userImage, setUserImage] = useState<HTMLImageElement | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  // Photo transform state in normalized canvas space (1000x1000 reference)
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);

  // Action states
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadSuccess, setDownloadSuccess] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Preview modal
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);

  // Pointer & pinch tracking
  const activePointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const dragStartRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const pinchStartRef = useRef<{ dist: number; zoom: number } | null>(null);

  // Load active campaign frame PNG
  useEffect(() => {
    let cancelled = false;
    setFrameError(null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (cancelled) return;
      setFrameImage(img);
      const detected = detectCutoutBounds(img);
      setCutout(detected);
    };
    img.onerror = () => {
      if (cancelled) return;
      setFrameError('Unable to load the active campaign frame.');
    };
    img.src = config.frameUrl;

    return () => {
      cancelled = true;
    };
  }, [config.frameUrl]);

  // Fit user photo inside the detected cutout region
  const fitPhotoToFrame = useCallback(
    (img: HTMLImageElement, targetCutout: CutoutBounds) => {
      const boxW = targetCutout.width * PREVIEW_CANVAS_SIZE;
      const boxH = targetCutout.height * PREVIEW_CANVAS_SIZE;
      const scaleW = (boxW * 1.12) / img.naturalWidth;
      const scaleH = (boxH * 1.12) / img.naturalHeight;
      const baseCoverScale = Math.max(scaleW, scaleH);

      setZoom(Number(Math.min(3.5, Math.max(0.35, baseCoverScale)).toFixed(2)));
      setOffsetX((targetCutout.cx - 0.5) * PREVIEW_CANVAS_SIZE);
      setOffsetY((targetCutout.cy - 0.5) * PREVIEW_CANVAS_SIZE);
      setRotation(0);
    },
    [],
  );

  const loadSelectedFile = useCallback(
    (file: File) => {
      setActionError(null);
      setDownloadSuccess(null);

      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
        setActionError('Please choose a PNG, JPG, or WebP photo from your device.');
        return;
      }
      if (file.size > 15 * 1024 * 1024) {
        setActionError('Selected image is too large (maximum 15MB).');
        return;
      }

      const objectUrl = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(objectUrl);
        setUserImage(img);
        fitPhotoToFrame(img, cutout);
      };
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        setActionError('Could not read the selected image file.');
      };
      img.src = objectUrl;
    },
    [cutout, fitPhotoToFrame],
  );

  // Render composition onto any target canvas
  const renderToCanvas = useCallback(
    (canvas: HTMLCanvasElement, targetSize: number) => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      canvas.width = targetSize;
      canvas.height = targetSize;
      const ratio = targetSize / PREVIEW_CANVAS_SIZE;

      ctx.clearRect(0, 0, targetSize, targetSize);

      // Clean neutral backing behind transparent cutout
      ctx.fillStyle = '#F7F8F6';
      ctx.fillRect(0, 0, targetSize, targetSize);

      if (userImage) {
        ctx.save();
        ctx.translate(
          targetSize / 2 + offsetX * ratio,
          targetSize / 2 + offsetY * ratio,
        );
        ctx.rotate((rotation * Math.PI) / 180);
        const drawScale = zoom * ratio;
        ctx.scale(drawScale, drawScale);
        ctx.drawImage(
          userImage,
          -userImage.naturalWidth / 2,
          -userImage.naturalHeight / 2,
        );
        ctx.restore();
      }

      // Draw fixed Campaign Frame strictly ABOVE the user's photo
      if (frameImage) {
        ctx.drawImage(frameImage, 0, 0, targetSize, targetSize);
      }
    },
    [frameImage, offsetX, offsetY, rotation, userImage, zoom],
  );

  // Redraw interactive preview canvas whenever transform or images update
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    renderToCanvas(canvas, PREVIEW_CANVAS_SIZE);
  }, [renderToCanvas]);

  // Smooth mouse-wheel zoom on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleWheel = (e: WheelEvent) => {
      if (!userImage) return;
      e.preventDefault();
      const delta = e.deltaY < 0 ? 1.07 : 0.93;
      setZoom((prev) => Number(Math.min(4.5, Math.max(0.2, prev * delta)).toFixed(3)));
    };

    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      canvas.removeEventListener('wheel', handleWheel);
    };
  }, [userImage]);

  // Pointer drag & touchscreen pinch-zoom
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!userImage) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointersRef.current.size === 1) {
      dragStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        ox: offsetX,
        oy: offsetY,
      };
      pinchStartRef.current = null;
    } else if (activePointersRef.current.size === 2) {
      const pts = Array.from(activePointersRef.current.values());
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      pinchStartRef.current = { dist, zoom };
      dragStartRef.current = null;
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!userImage || !activePointersRef.current.has(e.pointerId)) return;
    activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleToCanvas = PREVIEW_CANVAS_SIZE / Math.max(1, rect.width);

    if (activePointersRef.current.size === 1 && dragStartRef.current) {
      const dx = (e.clientX - dragStartRef.current.x) * scaleToCanvas;
      const dy = (e.clientY - dragStartRef.current.y) * scaleToCanvas;
      setOffsetX(dragStartRef.current.ox + dx);
      setOffsetY(dragStartRef.current.oy + dy);
    } else if (activePointersRef.current.size === 2 && pinchStartRef.current) {
      const pts = Array.from(activePointersRef.current.values());
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      if (pinchStartRef.current.dist > 0) {
        const nextZoom = pinchStartRef.current.zoom * (dist / pinchStartRef.current.dist);
        setZoom(Number(Math.min(4.5, Math.max(0.2, nextZoom)).toFixed(3)));
      }
    }
  };

  const handlePointerUpOrCancel = (e: React.PointerEvent<HTMLCanvasElement>) => {
    activePointersRef.current.delete(e.pointerId);
    if (activePointersRef.current.size === 1) {
      const remaining = Array.from(activePointersRef.current.values())[0];
      dragStartRef.current = {
        x: remaining.x,
        y: remaining.y,
        ox: offsetX,
        oy: offsetY,
      };
      pinchStartRef.current = null;
    } else if (activePointersRef.current.size === 0) {
      dragStartRef.current = null;
      pinchStartRef.current = null;
    }
  };

  const exportCompositionBlob = async (
    size: number,
    mimeType: 'image/png' | 'image/jpeg',
  ): Promise<Blob> => {
    const offscreen = document.createElement('canvas');
    renderToCanvas(offscreen, size);
    return new Promise<Blob>((resolve, reject) => {
      offscreen.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Could not export profile composition.'));
        },
        mimeType,
        mimeType === 'image/jpeg' ? 0.94 : undefined,
      );
    });
  };

  const handlePreviewModal = () => {
    if (!userImage) {
      setActionError('Import your photo first to preview the final composition.');
      return;
    }
    const offscreen = document.createElement('canvas');
    renderToCanvas(offscreen, 1200);
    setPreviewDataUrl(offscreen.toDataURL('image/png'));
  };

  const handleDownloadImage = async () => {
    if (downloadInFlightRef.current) return;
    if (!userImage) {
      setActionError('Please import your photo before downloading.');
      return;
    }
    if (!frameImage) {
      setActionError('Campaign frame is still loading. Please wait a moment.');
      return;
    }

    downloadInFlightRef.current = true;
    setActionError(null);
    setDownloadSuccess(null);
    setIsDownloading(true);

    try {
      const blob = await exportCompositionBlob(DOWNLOAD_EXPORT_SIZE, 'image/png');
      if (!blob || blob.size === 0) {
        throw new Error('Image export produced an empty file.');
      }

      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `dmc-jui-punjab-profile-${Date.now()}.png`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 15000);

      setDownloadSuccess('Your high-resolution PNG profile picture is ready.');
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Unable to complete download. Please try again.',
      );
    } finally {
      downloadInFlightRef.current = false;
      setIsDownloading(false);
    }
  };

  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
      {/* Campaign Header Banner */}
      <div className="mb-8 pb-6 border-b border-[#E4E7E2]">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold tracking-[0.1em] text-[#B08D57] uppercase">
            Official Profile Campaign Studio
          </p>
          <h1
            className="mt-1.5 font-display text-3xl sm:text-4xl font-bold tracking-tight text-[#141D18]"
            style={{ textWrap: 'balance' }}
          >
            {config.campaignTitle}
          </h1>
          <p className="mt-2 text-sm sm:text-base text-[#5C6660]">{config.campaignSubtitle}</p>
        </div>
      </div>

      {/* Centered Editor Workspace */}
      <div className="max-w-2xl mx-auto flex flex-col gap-5">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) loadSelectedFile(file);
            e.target.value = '';
          }}
        />

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragOver(true);
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragOver(false);
            const file = e.dataTransfer.files?.[0];
            if (file) loadSelectedFile(file);
          }}
          className={`relative bg-white border rounded-2xl p-3 sm:p-4 transition-colors ${
            isDragOver ? 'border-[#064E3B] ring-2 ring-[#064E3B]/20' : 'border-[#E4E7E2]'
          }`}
        >
          <div className="relative aspect-square w-full max-w-[560px] mx-auto rounded-xl overflow-hidden bg-[#F4F5F3] border border-[#E4E7E2]">
            <canvas
              ref={canvasRef}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUpOrCancel}
              onPointerCancel={handlePointerUpOrCancel}
              className={`w-full h-full block touch-none select-none ${
                userImage ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
              }`}
              onClick={() => {
                if (!userImage) fileInputRef.current?.click();
              }}
            />

            {/* Empty state overlay prompt inside photo window */}
            {!userImage && !frameError && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="absolute inset-0 flex flex-col items-center justify-center bg-[#141D18]/10 hover:bg-[#141D18]/15 transition-colors text-center p-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#064E3B]"
              >
                <span className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-[#064E3B] text-white text-sm font-semibold shadow-sm">
                  <ImagePlus className="w-4 h-4" />
                  Import Your Photo
                </span>
                <span className="mt-2.5 text-xs font-medium text-[#141D18] bg-white/95 px-3 py-1 rounded-md border border-[#E4E7E2]">
                  Click to select or drag &amp; drop PNG / JPG
                </span>
              </button>
            )}

            {frameError && (
              <div className="absolute inset-0 flex items-center justify-center p-6 bg-white/95 text-center">
                <p className="text-sm font-medium text-red-700">{frameError}</p>
              </div>
            )}
          </div>

          {/* Canvas footer helper bar */}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-[#5C6660] px-1">
            <span>
              {userImage
                ? 'Drag to move · Scroll or pinch to zoom'
                : 'Fixed campaign frame stays locked above your portrait'}
            </span>
            {userImage && (
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 font-semibold text-[#064E3B] hover:underline whitespace-nowrap"
                >
                  <ImagePlus className="w-3.5 h-3.5" />
                  Replace Photo
                </button>
                <button
                  type="button"
                  onClick={() => fitPhotoToFrame(userImage, cutout)}
                  className="inline-flex items-center gap-1.5 font-semibold text-[#064E3B] hover:underline whitespace-nowrap"
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                  Center &amp; Fit
                </button>
                <button
                  type="button"
                  onClick={handlePreviewModal}
                  className="inline-flex items-center gap-1.5 font-semibold text-[#064E3B] hover:underline whitespace-nowrap"
                >
                  <Eye className="w-3.5 h-3.5" />
                  Preview Final
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Primary Action Button Below Editor */}
        <div>
          <button
            type="button"
            onClick={handleDownloadImage}
            disabled={isDownloading || !userImage}
            className="w-full min-h-[52px] inline-flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-xl bg-[#064E3B] text-white font-display text-sm font-bold tracking-wide hover:bg-[#053D2E] disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#064E3B]"
          >
            <Download className="w-4 h-4 shrink-0" />
            {isDownloading ? 'PREPARING PNG...' : 'DOWNLOAD IMAGE'}
          </button>
        </div>

        {/* Feedback Banners */}
        {actionError && (
          <div
            role="alert"
            className="bg-red-50 border border-red-200 text-red-800 rounded-xl px-4 py-3 text-sm font-medium"
          >
            {actionError}
          </div>
        )}

        {downloadSuccess && (
          <div
            role="status"
            className="bg-[#ECFDF5] border border-[#A7F3D0] text-[#064E3B] rounded-xl px-4 py-3 text-sm font-medium flex items-start gap-2.5"
          >
            <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{downloadSuccess}</span>
          </div>
        )}
      </div>

      {/* Full-Resolution Composition Preview Modal */}
      {previewDataUrl && (
        <div
          className="fixed inset-0 z-50 bg-[#141D18]/80 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setPreviewDataUrl(null)}
        >
          <div
            className="bg-white rounded-2xl max-w-lg w-full p-5 border border-[#E4E7E2]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display text-lg font-bold text-[#141D18]">
                Final Composition Preview
              </h3>
              <button
                type="button"
                onClick={() => setPreviewDataUrl(null)}
                aria-label="Close preview"
                className="w-9 h-9 inline-flex items-center justify-center rounded-lg border border-[#E4E7E2] text-[#141D18] hover:bg-[#F4F5F3]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="aspect-square w-full rounded-xl overflow-hidden border border-[#E4E7E2] bg-[#FAF9F6]">
              <img
                src={previewDataUrl}
                alt="Final campaign profile composition preview"
                referrerPolicy="no-referrer"
                className="w-full h-full object-contain"
              />
            </div>

            <button
              type="button"
              onClick={() => {
                setPreviewDataUrl(null);
                void handleDownloadImage();
              }}
              className="mt-4 w-full py-2.5 px-4 rounded-xl bg-[#064E3B] text-white text-sm font-semibold hover:bg-[#053D2E] whitespace-nowrap"
            >
              DOWNLOAD IMAGE
            </button>
          </div>
        </div>
      )}
    </section>
  );
};
