import React, { useEffect, useState } from 'react';
import { ImageOff } from 'lucide-react';
import { resolveGalleryItemImageUrl } from '../services/campaignService';
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
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(
    item.chunkCount && item.chunkCount > 0 ? null : item.imageUrl,
  );
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setFailed(false);

    if (!item.chunkCount || item.chunkCount <= 0) {
      setResolvedUrl(item.imageUrl);
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
  }, [item]);

  if (failed) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center text-center p-4 text-[#5C6660]">
        <ImageOff className="w-6 h-6 mb-2" />
        <span className="text-xs font-medium">
          {item.supporterName || 'DMC Supporter'}
        </span>
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
      loading="lazy"
      onError={() => setFailed(true)}
      className={className}
    />
  );
};
