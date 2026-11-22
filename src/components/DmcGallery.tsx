import React, { useEffect, useMemo, useState } from 'react';
import { Download, Maximize2, X } from 'lucide-react';
import type { DocumentData, QueryDocumentSnapshot } from 'firebase/firestore';
import {
  fetchGalleryTotalCount,
  fetchNextGalleryPage,
  resolveGalleryItemImageUrl,
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
  const [lightboxItem, setLightboxItem] = useState<GalleryItem | null>(null);

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
    const ext = item.mimeType === 'image/jpeg' ? 'jpg' : 'png';
    const safeBase = (item.supporterName || 'dmc-supporter')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const filename = `${safeBase || 'dmc-supporter'}-${item.id.slice(0, 6)}.${ext}`;

    try {
      const resolvedUrl = await resolveGalleryItemImageUrl(item);
      const response = await fetch(resolvedUrl);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch {
      setError('Unable to download this image right now.');
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

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {Array.from({ length: 8 }).map((_, idx) => (
            <div
              key={idx}
              className="bg-white border border-[#E4E7E2] rounded-2xl p-3 animate-pulse"
            >
              <div className="aspect-square rounded-xl bg-[#EAECE8]" />
              <div className="mt-3 h-4 w-2/3 bg-[#EAECE8] rounded" />
              <div className="mt-2 h-8 w-full bg-[#EAECE8] rounded-lg" />
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
            {allItems.map((item) => (
              <article
                key={item.id}
                className="bg-white border border-[#E4E7E2] rounded-2xl p-3 flex flex-col justify-between transition-colors hover:border-[#C5CEC7]"
              >
                <div>
                  <div className="relative aspect-square rounded-xl overflow-hidden bg-[#F4F5F3] border border-[#E4E7E2] group">
                    <GalleryPortraitImage
                      item={item}
                      alt={
                        item.supporterName
                          ? `${item.supporterName} campaign profile portrait`
                          : 'DMC JUI Punjab supporter portrait'
                      }
                    />
                    <button
                      type="button"
                      onClick={() => setLightboxItem(item)}
                      aria-label="Inspect full size portrait"
                      className="absolute top-2.5 right-2.5 w-9 h-9 rounded-lg bg-white/90 border border-[#E4E7E2] text-[#141D18] inline-flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                    >
                      <Maximize2 className="w-4 h-4" />
                    </button>
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
                </div>

                <button
                  type="button"
                  onClick={() => void handleDownloadGalleryImage(item)}
                  className="mt-3 w-full py-2 px-3 rounded-xl bg-[#F4F7F5] hover:bg-[#064E3B] text-[#064E3B] hover:text-white border border-[#DCE5DF] text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download
                </button>
              </article>
            ))}
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
              onClick={() => void handleDownloadGalleryImage(lightboxItem)}
              className="mt-4 w-full py-3 px-4 rounded-xl bg-[#064E3B] text-white text-sm font-semibold hover:bg-[#053D2E] inline-flex items-center justify-center gap-2 transition-colors"
            >
              <Download className="w-4 h-4" />
              Download Picture
            </button>
          </div>
        </div>
      )}
    </section>
  );
};
