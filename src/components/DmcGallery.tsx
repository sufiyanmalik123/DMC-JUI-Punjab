import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Download, MoreVertical, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { DocumentData, QueryDocumentSnapshot } from 'firebase/firestore';
import {
  fetchGalleryItemBlob,
  fetchGalleryTotalCount,
  fetchNextGalleryPage,
  subscribeLatestGalleryItems,
} from '../services/campaignService';
import { GalleryItem } from '../types/campaign';
import { GalleryPortraitImage } from './GalleryPortraitImage';

interface DmcGalleryProps {
  onCreateOwn: () => void;
}

const PAGE_SIZE = 12;

function formatUploadDate(date: Date | null): string {
  if (!date) return 'Just now';
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function extractReadableError(err: Error): string {
  try {
    const parsed = JSON.parse(err.message);
    if (parsed && typeof parsed.error === 'string') {
      return `Unable to load the DMC Gallery: ${parsed.error}`;
    }
  } catch {
    if (err.message) {
      return `Unable to load the DMC Gallery: ${err.message}`;
    }
  }
  return 'Unable to load the DMC Gallery right now.';
}

export const DmcGallery: React.FC<DmcGalleryProps> = ({ onCreateOwn }) => {
  const [liveItems, setLiveItems] = useState<GalleryItem[]>([]);
  const [extraItems, setExtraItems] = useState<GalleryItem[]>([]);
  const [lastCursor, setLastCursor] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [totalCount, setTotalCount] = useState<number>(0);

  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [lightboxItem, setLightboxItem] = useState<GalleryItem | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const openMenuContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);

    const refreshCount = async () => {
      try {
        const count = await fetchGalleryTotalCount();
        setTotalCount(count);
      } catch {
        // Non-blocking fallback
      }
    };

    const unsubscribe = subscribeLatestGalleryItems(
      PAGE_SIZE,
      (items, cursor) => {
        setLiveItems(items);
        setLastCursor(cursor);
        setHasMore(items.length === PAGE_SIZE);
        setError(null);
        setLoading(false);
        void refreshCount();
      },
      (err) => {
        setError(extractReadableError(err));
        setLoading(false);
      },
    );

    return () => unsubscribe();
  }, []);

  // Close three-dot dropdown menu when clicking outside or pressing Escape
  useEffect(() => {
    if (!openMenuId) return;

    const handlePointerDown = (e: PointerEvent) => {
      if (
        openMenuContainerRef.current &&
        !openMenuContainerRef.current.contains(e.target as Node)
      ) {
        setOpenMenuId(null);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpenMenuId(null);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [openMenuId]);

  // Merge first-page live items with paginated older items without duplicates
  const allItems = useMemo(() => {
    const seen = new Set(liveItems.map((i) => i.id));
    const merged = [...liveItems];
    for (const item of extraItems) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        merged.push(item);
      }
    }
    return merged;
  }, [extraItems, liveItems]);

  const handleLoadMore = async () => {
    if (!lastCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const next = await fetchNextGalleryPage(PAGE_SIZE, lastCursor);
      setExtraItems((prev) => [...prev, ...next.items]);
      setLastCursor(next.lastDoc);
      setHasMore(next.hasMore);
    } catch (err) {
      setError(
        err instanceof Error
          ? extractReadableError(err)
          : 'Could not load additional gallery pictures.',
      );
    } finally {
      setLoadingMore(false);
    }
  };

  const handleDownloadGalleryImage = async (item: GalleryItem) => {
    if (downloadingId === item.id) return;
    setDownloadError(null);
    setDownloadingId(item.id);
    setOpenMenuId(null);

    const ext = item.mimeType === 'image/jpeg' ? 'jpg' : 'png';
    const safeBase = (item.supporterName || 'dmc-supporter')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const filename = `${safeBase || 'dmc-supporter'}-${item.id.slice(0, 6)}.${ext}`;

    try {
      const blob = await fetchGalleryItemBlob(item);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.rel = 'noopener';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 15000);
    } catch (err) {
      setDownloadError(
        err instanceof Error ? err.message : 'Unable to download this image right now.',
      );
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
      {/* Gallery Header */}
      <div className="pb-6 mb-8 border-b border-[#E4E7E2]">
        <p className="text-xs font-semibold tracking-[0.1em] text-[#B08D57] uppercase">
          Public Supporter Showcase
        </p>
        <h1 className="mt-1.5 font-display text-3xl sm:text-4xl font-bold tracking-tight text-[#141D18]">
          DMC GALLERY
        </h1>
        <div className="mt-2 text-sm text-[#5C6660]">
          <span>
            Total Uploaded Pictures:{' '}
            <strong className="font-mono-tabular text-[#064E3B]">
              {Math.max(totalCount, allItems.length).toLocaleString()}
            </strong>
          </span>
        </div>
      </div>

      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 text-red-800 rounded-xl px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {downloadError && (
        <div className="mb-6 bg-red-50 border border-red-200 text-red-800 rounded-xl px-4 py-3 text-sm flex items-center justify-between gap-3">
          <span>{downloadError}</span>
          <button
            type="button"
            onClick={() => setDownloadError(null)}
            aria-label="Dismiss download error"
            className="text-red-700 hover:text-red-900 p-1 rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {Array.from({ length: 8 }).map((_, idx) => (
            <div
              key={idx}
              className="bg-white border border-[#E4E7E2] rounded-2xl p-3 animate-pulse"
            >
              <div className="aspect-square rounded-xl bg-[#EAECE8]" />
              <div className="mt-3 h-4 w-2/3 bg-[#EAECE8] rounded" />
              <div className="mt-1.5 h-3 w-1/3 bg-[#EAECE8] rounded" />
            </div>
          ))}
        </div>
      ) : error ? null : allItems.length === 0 ? (
        <div className="bg-white border border-[#E4E7E2] rounded-2xl p-12 text-center">
          <h2 className="font-display text-xl font-bold text-[#141D18]">
            No campaign pictures uploaded yet
          </h2>
          <p className="mt-2 text-sm text-[#5C6660] max-w-md mx-auto">
            Be the first to frame your portrait with the official DMC JUI Punjab campaign frame and
            publish it here.
          </p>
          <button
            type="button"
            onClick={onCreateOwn}
            className="mt-5 px-5 py-2.5 rounded-xl bg-[#064E3B] text-white text-sm font-semibold hover:bg-[#053D2E] transition-colors"
          >
            Upload Campaign Portrait
          </button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {allItems.map((item) => {
              const isMenuOpen = openMenuId === item.id;
              const isDownloading = downloadingId === item.id;
              return (
                <article
                  key={item.id}
                  className="bg-white border border-[#E4E7E2] rounded-2xl p-3 flex flex-col transition-colors hover:border-[#C5CEC7]"
                >
                  <div className="relative">
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => setLightboxItem(item)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setLightboxItem(item);
                        }
                      }}
                      aria-label={`View ${item.supporterName || 'DMC JUI Punjab supporter portrait'} full size`}
                      className="aspect-square rounded-xl overflow-hidden bg-[#F4F5F3] border border-[#E4E7E2] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#064E3B]"
                    >
                      <GalleryPortraitImage
                        item={item}
                        alt={
                          item.supporterName
                            ? `${item.supporterName} campaign profile portrait`
                            : 'DMC JUI Punjab supporter portrait'
                        }
                      />
                    </div>

                    {/* Top-right three-dot vertical menu */}
                    <div
                      ref={isMenuOpen ? openMenuContainerRef : undefined}
                      className="absolute top-2.5 right-2.5 z-20"
                    >
                      <button
                        type="button"
                        aria-label="Image options"
                        aria-haspopup="menu"
                        aria-expanded={isMenuOpen}
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenMenuId((prev) => (prev === item.id ? null : item.id));
                        }}
                        className="w-8 h-8 rounded-lg bg-white/90 hover:bg-white backdrop-blur-xs border border-[#E4E7E2]/90 shadow-xs text-[#141D18] inline-flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#064E3B]"
                      >
                        <MoreVertical className="w-4 h-4" />
                      </button>

                      <AnimatePresence>
                        {isMenuOpen && (
                          <motion.div
                            role="menu"
                            initial={{ opacity: 0, scale: 0.94, y: -4 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: -4 }}
                            transition={{ duration: 0.14, ease: 'easeOut' }}
                            className="absolute right-0 mt-1.5 w-44 rounded-xl bg-white border border-[#E4E7E2] shadow-lg py-1 origin-top-right"
                          >
                            <button
                              type="button"
                              role="menuitem"
                              disabled={isDownloading}
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleDownloadGalleryImage(item);
                              }}
                              className="w-full px-3.5 py-2 text-left text-xs font-semibold text-[#141D18] hover:bg-[#F4F7F5] hover:text-[#064E3B] inline-flex items-center gap-2 transition-colors disabled:opacity-50"
                            >
                              <Download className="w-3.5 h-3.5 shrink-0" />
                              <span>{isDownloading ? 'Downloading...' : 'Download Image'}</span>
                            </button>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>

                  <div className="mt-3 px-1">
                    <h3 className="font-display text-sm font-semibold text-[#141D18] truncate">
                      {item.supporterName || 'DMC JUI Punjab Supporter'}
                    </h3>
                    <div className="mt-0.5 flex items-center gap-1.5 text-xs text-[#5C6660] truncate">
                      {item.city && (
                        <>
                          <span className="truncate">{item.city}</span>
                          <span aria-hidden="true">·</span>
                        </>
                      )}
                      <span className="whitespace-nowrap">
                        {formatUploadDate(item.createdAt)}
                      </span>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          {/* Load More Pagination */}
          {hasMore && (
            <div className="mt-10 flex justify-center">
              <button
                type="button"
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="px-6 py-2.5 rounded-xl bg-white border border-[#E4E7E2] hover:border-[#064E3B] text-sm font-semibold text-[#141D18] transition-colors disabled:opacity-50"
              >
                {loadingMore ? 'Loading more portraits...' : 'Load More Portraits'}
              </button>
            </div>
          )}
        </>
      )}

      {/* Lightbox Modal */}
      {lightboxItem && (
        <div
          className="fixed inset-0 z-50 bg-[#141D18]/80 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setLightboxItem(null)}
        >
          <div
            className="bg-white rounded-2xl max-w-xl w-full p-5 border border-[#E4E7E2]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <h3 className="font-display text-lg font-bold text-[#141D18]">
                  {lightboxItem.supporterName || 'DMC JUI Punjab Supporter'}
                </h3>
                <p className="text-xs text-[#5C6660] mt-0.5">
                  {lightboxItem.city ? `${lightboxItem.city} · ` : ''}
                  {formatUploadDate(lightboxItem.createdAt)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setLightboxItem(null)}
                aria-label="Close image viewer"
                className="w-9 h-9 inline-flex items-center justify-center rounded-lg border border-[#E4E7E2] text-[#141D18] hover:bg-[#F4F5F3]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="aspect-square w-full rounded-xl overflow-hidden bg-[#F4F5F3] border border-[#E4E7E2]">
              <GalleryPortraitImage
                item={lightboxItem}
                alt={lightboxItem.supporterName || 'DMC JUI Punjab campaign picture'}
                className="w-full h-full object-contain"
              />
            </div>

            <button
              type="button"
              disabled={downloadingId === lightboxItem.id}
              onClick={() => void handleDownloadGalleryImage(lightboxItem)}
              className="mt-4 w-full py-3 px-4 rounded-xl bg-[#064E3B] text-white text-sm font-semibold hover:bg-[#053D2E] inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
            >
              <Download className="w-4 h-4" />
              {downloadingId === lightboxItem.id ? 'Downloading...' : 'Download Image'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
};
