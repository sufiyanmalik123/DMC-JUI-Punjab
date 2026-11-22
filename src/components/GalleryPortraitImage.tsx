import React, { useEffect, useState } from 'react';
import { ImageOff } from 'lucide-react';
import {
  getCachedGalleryItemImageUrl,
  resolveGalleryItemImageUrl,
} from '../services/campaignService';
import { GalleryItem } from '../types/campaign';

interface GalleryPortraitImageProps {
  item: GalleryItem;
  alt: string;
  className?: string;
}

export const GalleryPortraitImage: React.FC<GalleryPortraitImageProps> = ({
  item,
  alt,
  className = 'w-full h-full object-cover',
}) => {
  const isChunked = Boolean(item.chunkCount && item.chunkCount > 0);
  const initialUrl = isChunked
    ? getCachedGalleryItemImageUrl(item.id)
    : item.imageUrl || null;

  const [resolvedUrl, setResolvedUrl] = useState<string | null>(initialUrl);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
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

    const cached = getCachedGalleryItemImageUrl(item.id);
    if (cached) {
      setResolvedUrl(cached);
      return;
    }

    setResolvedUrl(null);
    void resolveGalleryItemImageUrl(item)
      .then((url) => {
        if (active) setResolvedUrl(url);
      })
      .catch(() => {
        if (active) setFailed(true);
      });

    return () => {
      active = false;
    };
  }, [isChunked, item]);

  if (failed) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center text-center p-4 text-[#5C6660] bg-[#F4F5F3]">
        <ImageOff className="w-6 h-6 mb-2 text-[#8A948D]" />
        <span className="text-xs font-medium">Image unavailable</span>
      </div>
    );
  }

  if (!resolvedUrl) {
    return <div className="w-full h-full bg-[#EAECE8] animate-pulse" />;
  }

  return (
    <img
      src={resolvedUrl}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={className}
    />
  );
};
