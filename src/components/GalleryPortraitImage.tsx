import React, { useEffect, useRef, useState } from 'react';
import { ImageOff } from 'lucide-react';
import {
  getCachedGalleryItemImageUrl,
  resolveGalleryItemImageUrl,
  resolveGalleryItemThumbnailUrl,
} from '../services/campaignService';
import { GalleryItem } from '../types/campaign';

interface GalleryPortraitImageProps {
  item: GalleryItem;
  alt: string;
  className?: string;
  variant?: 'thumbnail' | 'full';
  eager?: boolean;
}

export const GalleryPortraitImage: React.FC<GalleryPortraitImageProps> = ({
  item,
  alt,
  className = 'w-full h-full object-cover',
  variant = 'full',
  eager = false,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isChunked = Boolean(item.chunkCount && item.chunkCount > 0);
  const cachedInitial = isChunked
    ? getCachedGalleryItemImageUrl(item.id, variant)
    : item.imageUrl || null;

  const [isNearViewport, setIsNearViewport] = useState<boolean>(
    eager || Boolean(cachedInitial),
  );
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(cachedInitial);
  const [failed, setFailed] = useState(false);

  // Lazy-observe cards outside the visible screen before fetching chunks or image bytes
  useEffect(() => {
    if (eager || isNearViewport) return;
    const node = containerRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      setIsNearViewport(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setIsNearViewport(true);
            observer.disconnect();
            break;
          }
        }
      },
      { rootMargin: '250px' },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [eager, isNearViewport]);

  useEffect(() => {
    if (!isNearViewport) return;
    let active = true;
    setFailed(false);

    if (!isChunked) {
      if (!item.imageUrl) {
        setResolvedUrl(null);
        setFailed(true);
      } else {
        setResolvedUrl(item.imageUrl);
      }
      return;
    }

    const cached = getCachedGalleryItemImageUrl(item.id, variant);
    if (cached) {
      setResolvedUrl(cached);
      return;
    }

    setResolvedUrl(null);
    const loader =
      variant === 'thumbnail'
        ? resolveGalleryItemThumbnailUrl(item)
        : resolveGalleryItemImageUrl(item);

    void loader
      .then((url) => {
        if (active) setResolvedUrl(url);
      })
      .catch(() => {
        if (active) setFailed(true);
      });

    return () => {
      active = false;
    };
  }, [isChunked, isNearViewport, item, variant]);

  return (
    <div ref={containerRef} className="w-full h-full">
      {failed ? (
        <div className="w-full h-full flex flex-col items-center justify-center text-center p-1.5 sm:p-4 text-[#5C6660] bg-[#F4F5F3]">
          <ImageOff className="w-4 h-4 sm:w-6 sm:h-6 mb-1 sm:mb-2 text-[#8A948D]" />
          <span className="text-[9px] sm:text-xs leading-tight font-medium">Unavailable</span>
        </div>
      ) : !resolvedUrl ? (
        <div className="w-full h-full bg-[#EAECE8] animate-pulse" />
      ) : (
        <img
          src={resolvedUrl}
          alt={alt}
          decoding="async"
          loading={eager ? 'eager' : 'lazy'}
          fetchPriority={eager ? 'high' : 'auto'}
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className={className}
        />
      )}
    </div>
  );
};
