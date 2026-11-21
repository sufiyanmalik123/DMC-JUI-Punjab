import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  Download,
  Eye,
  ImagePlus,
  Maximize2,
  RotateCw,
  UploadCloud,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  incrementSupportersCounter,
  uploadToGalleryWithProgress,
} from '../services/campaignService';
import { CampaignConfig } from '../types/campaign';

interface ProfileEditorProps {
  config: CampaignConfig;
  onOpenGallery: () => void;
}

interface CutoutBounds {
  cx: number;
  cy: number;
  width: number;
  height: number;
}

const PREVIEW_CANVAS_SIZE = 1000;
const DOWNLOAD_EXPORT_SIZE = 2000;
const GALLERY_EXPORT_SIZE = 1500;

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

export const ProfileEditor: React.FC<ProfileEditorProps> = ({ config, onOpenGallery }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [frameImage, setFrameImage] = useState<HTMLImageElement | null>(null);
  const [frameError, setFrameError] = useState<string | null>(null);
  const [cutout, setCutout] = useState<CutoutBounds>({ cx: 0.5, cy: 0.35, width: 0.48, height: 0.58 });

  const [userImage, setUserImage] = useState<HTMLImageElement | null>(null);
  const [userPhotoName, setUserPhotoName] = useState<string>('');
  const [isDragOver, setIsDragOver] = useState(false);

  // Photo transform state in normalized canvas space (1000x1000 reference)
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);

  // Action states
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadSuccess, setDownloadSuccess] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
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
      setUploadSuccess(null);
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
        setUserPhotoName(file.name);
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
    if (!userImage) {
      setActionError('Please import your photo before downloading.');
      return;
    }
    if (!frameImage) {
      setActionError('Campaign frame is still loading. Please wait a moment.');
      return;
    }

    setActionError(null);
    setDownloadSuccess(null);
    setIsDownloading(true);

    try {
      const blob = await exportCompositionBlob(DOWNLOAD_EXPORT_SIZE, 'image/png');
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `dmc-jui-punjab-profile-${Date.now()}.png`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);

      await incrementSupportersCounter();
      setDownloadSuccess(
        'Your high-resolution PNG profile picture is ready, and the SUPPORTERS counter has been updated.',
      );
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Unable to complete download. Please try again.',
      );
    } finally {
      setIsDownloading(false);
    }
  };

  const handleUploadToDmc = async () => {
    if (!userImage) {
      setActionError('Please import your photo before uploading to the DMC Gallery.');
      return;
    }
    if (!frameImage) {
      setActionError('Campaign frame is still loading. Please wait a moment.');
      return;
    }

    setActionError(null);
    setUploadSuccess(null);
    setIsUploading(true);
    setUploadProgress(5);

    try {
      let blob = await exportCompositionBlob(GALLERY_EXPORT_SIZE, 'image/png');
      // Keep gallery uploads comfortably under the 8MB server limit
      if (blob.size > 7.5 * 1024 * 1024) {
        blob = await exportCompositionBlob(1100, 'image/png');
      }

      await uploadToGalleryWithProgress(
        blob,
        {
          supporterName: '',
          city: '',
          mimeType: 'image/png',
        },
        (pct) => setUploadProgress(pct),
      );

      setUploadSuccess('Your campaign profile picture is now live in the public DMC Gallery.');
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Failed to upload image to DMC Gallery.',
      );
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
      {/* Campaign Header Banner */}
      <div className="mb-8 pb-6 border-b border-[#E4E7E2] flex flex-col md:flex-row md:items-end md:justify-between gap-4">
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
        <p className="text-sm text-[#5C6660] max-w-sm leading-relaxed">{config.editorPrompt}</p>
      </div>

      {/* Main 2-Column Editor Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column: Interactive Canvas Stage & Primary Action Buttons */}
        <div className="lg:col-span-7 flex flex-col gap-5">
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
                  ? 'Drag to reposition · Scroll or pinch to zoom · Frame stays fixed above photo'
                  : 'Fixed campaign frame stays locked above your portrait'}
              </span>
              {userImage && (
                <button
                  type="button"
                  onClick={handlePreviewModal}
                  className="inline-flex items-center gap-1.5 font-semibold text-[#064E3B] hover:underline whitespace-nowrap"
                >
                  <Eye className="w-3.5 h-3.5" />
                  Preview Final
                </button>
              )}
            </div>
          </div>

          {/* Two Prominent Side-by-Side Action Buttons Below Editor */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <button
              type="button"
              onClick={handleDownloadImage}
              disabled={isDownloading || !userImage}
              className="w-full min-h-[52px] inline-flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-xl bg-[#064E3B] text-white font-display text-sm font-bold tracking-wide hover:bg-[#053D2E] disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#064E3B]"
            >
              <Download className="w-4 h-4 shrink-0" />
              {isDownloading ? 'PREPARING PNG...' : 'DOWNLOAD IMAGE'}
            </button>

            <button
              type="button"
              onClick={handleUploadToDmc}
              disabled={isUploading || !userImage}
              className="w-full min-h-[52px] inline-flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-xl bg-white border-2 border-[#064E3B] text-[#064E3B] font-display text-sm font-bold tracking-wide hover:bg-[#F2F7F4] disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#064E3B]"
            >
              <UploadCloud className="w-4 h-4 shrink-0" />
              {isUploading ? `UPLOADING ${uploadProgress}%` : 'UPLOAD TO DMC'}
            </button>
          </div>

          {/* Upload Progress Bar */}
          {isUploading && (
            <div className="bg-white border border-[#E4E7E2] rounded-xl p-4" role="status">
              <div className="flex items-center justify-between text-xs font-semibold text-[#141D18] mb-2">
                <span>Uploading composed portrait to DMC Gallery</span>
                <span className="font-mono-tabular">{uploadProgress}%</span>
              </div>
              <div className="w-full h-2 bg-[#E4E7E2] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#064E3B] transition-all duration-150"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          )}

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

          {uploadSuccess && (
            <div
              role="status"
              className="bg-[#ECFDF5] border border-[#A7F3D0] text-[#064E3B] rounded-xl px-4 py-3 text-sm font-medium flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
            >
              <div className="flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{uploadSuccess}</span>
              </div>
              <button
                type="button"
                onClick={onOpenGallery}
                className="inline-flex items-center justify-center px-3.5 py-1.5 rounded-lg bg-[#064E3B] text-white text-xs font-semibold hover:bg-[#053D2E] whitespace-nowrap shrink-0"
              >
                View DMC Gallery
              </button>
            </div>
          )}
        </div>

        {/* Right Column: Precision Photo & Gallery Controls */}
        <div className="lg:col-span-5 bg-white border border-[#E4E7E2] rounded-2xl p-5 sm:p-6 flex flex-col gap-6">
          {/* 1. Photo Import */}
          <div>
            <div className="flex items-center justify-between gap-2 mb-3">
              <h2 className="font-display text-base font-bold text-[#141D18]">
                1. Import Your Photo
              </h2>
              {userPhotoName && (
                <span className="text-xs text-[#5C6660] truncate max-w-[180px]">
                  {userPhotoName}
                </span>
              )}
            </div>

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

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full py-3 px-4 rounded-xl border border-dashed border-[#064E3B]/45 bg-[#F8FAF8] hover:bg-[#EFF5F1] text-[#064E3B] text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors"
            >
              <ImagePlus className="w-4 h-4" />
              {userImage ? 'Replace Photo from Device' : 'Choose Photo from Device'}
            </button>
          </div>

          <hr className="border-[#E4E7E2]" />

          {/* 2. Framing & Zoom Controls */}
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-base font-bold text-[#141D18]">
                2. Adjust Position &amp; Zoom
              </h2>
              {userImage && (
                <button
                  type="button"
                  onClick={() => fitPhotoToFrame(userImage, cutout)}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#064E3B] hover:underline whitespace-nowrap"
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                  Center &amp; Fit
                </button>
              )}
            </div>

            {/* Zoom slider + buttons */}
            <div>
              <div className="flex items-center justify-between text-xs text-[#5C6660] mb-1.5">
                <label htmlFor="zoom-range" className="font-medium text-[#141D18]">
                  Zoom
                </label>
                <span className="font-mono-tabular">{Math.round(zoom * 100)}%</span>
              </div>
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  disabled={!userImage}
                  onClick={() =>
                    setZoom((prev) => Number(Math.max(0.2, prev - 0.1).toFixed(2)))
                  }
                  aria-label="Zoom out"
                  className="w-10 h-10 inline-flex items-center justify-center rounded-lg border border-[#E4E7E2] text-[#141D18] hover:bg-[#F4F5F3] disabled:opacity-40"
                >
                  <ZoomOut className="w-4 h-4" />
                </button>
                <input
                  id="zoom-range"
                  type="range"
                  min={0.2}
                  max={4.5}
                  step={0.02}
                  disabled={!userImage}
                  value={zoom}
                  onChange={(e) => setZoom(Number(e.target.value))}
                  className="flex-1 accent-[#064E3B] cursor-pointer disabled:opacity-40"
                />
                <button
                  type="button"
                  disabled={!userImage}
                  onClick={() =>
                    setZoom((prev) => Number(Math.min(4.5, prev + 0.1).toFixed(2)))
                  }
                  aria-label="Zoom in"
                  className="w-10 h-10 inline-flex items-center justify-center rounded-lg border border-[#E4E7E2] text-[#141D18] hover:bg-[#F4F5F3] disabled:opacity-40"
                >
                  <ZoomIn className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Rotation controls */}
            <div>
              <div className="flex items-center justify-between text-xs text-[#5C6660] mb-1.5">
                <label htmlFor="rotation-range" className="font-medium text-[#141D18]">
                  Rotation
                </label>
                <span className="font-mono-tabular">{rotation}°</span>
              </div>
              <div className="flex items-center gap-2.5">
                <input
                  id="rotation-range"
                  type="range"
                  min={-180}
                  max={180}
                  step={1}
                  disabled={!userImage}
                  value={rotation}
                  onChange={(e) => setRotation(Number(e.target.value))}
                  className="flex-1 accent-[#064E3B] cursor-pointer disabled:opacity-40"
                />
                <button
                  type="button"
                  disabled={!userImage}
                  onClick={() =>
                    setRotation((prev) => {
                      const next = prev + 90;
                      return next > 180 ? next - 360 : next;
                    })
                  }
                  className="h-10 px-3 inline-flex items-center gap-1.5 rounded-lg border border-[#E4E7E2] text-xs font-semibold text-[#141D18] hover:bg-[#F4F5F3] disabled:opacity-40 whitespace-nowrap"
                >
                  <RotateCw className="w-3.5 h-3.5" />
                  +90°
                </button>
              </div>
            </div>
          </div>
        </div>
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

            <div className="mt-4 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => {
                  setPreviewDataUrl(null);
                  void handleDownloadImage();
                }}
                className="py-2.5 px-4 rounded-xl bg-[#064E3B] text-white text-sm font-semibold hover:bg-[#053D2E] whitespace-nowrap"
              >
                DOWNLOAD IMAGE
              </button>
              <button
                type="button"
                onClick={() => {
                  setPreviewDataUrl(null);
                  void handleUploadToDmc();
                }}
                className="py-2.5 px-4 rounded-xl border border-[#064E3B] text-[#064E3B] text-sm font-semibold hover:bg-[#F2F7F4] whitespace-nowrap"
              >
                UPLOAD TO DMC
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
