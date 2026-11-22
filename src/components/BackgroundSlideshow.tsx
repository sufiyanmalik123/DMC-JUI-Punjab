import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';

interface SlideshowAsset {
  desktop: string;
  mobile: string;
}

const SLIDESHOW_ASSETS: readonly SlideshowAsset[] = [
  {
    desktop: '/assets/slideshow/slide-1-desktop.webp',
    mobile: '/assets/slideshow/slide-1-mobile.webp',
  },
  {
    desktop: '/assets/slideshow/slide-2-desktop.webp',
    mobile: '/assets/slideshow/slide-2-mobile.webp',
  },
  {
    desktop: '/assets/slideshow/slide-3-desktop.webp',
    mobile: '/assets/slideshow/slide-3-mobile.webp',
  },
  {
    desktop: '/assets/slideshow/slide-4-desktop.webp',
    mobile: '/assets/slideshow/slide-4-mobile.webp',
  },
  {
    desktop: '/assets/slideshow/slide-5-desktop.webp',
    mobile: '/assets/slideshow/slide-5-mobile.webp',
  },
] as const;

type TransitionKind = 'crossfade' | 'fade' | 'zoomIn' | 'zoomOut';

const TRANSITION_KINDS: TransitionKind[] = [
  'crossfade',
  'fade',
  'zoomIn',
  'zoomOut',
];

const BACKGROUND_OPACITY = 0.18;

// Module-level cache retains decoded Image instances across cycles and route switches
const preloadedSlideCache = new Map<string, HTMLImageElement>();
const preloadingInflight = new Map<string, Promise<void>>();

function preloadAndDecodeImage(src: string): Promise<void> {
  const existing = preloadedSlideCache.get(src);
  if (existing && existing.complete && existing.naturalWidth > 0) {
    return Promise.resolve();
  }

  const inflight = preloadingInflight.get(src);
  if (inflight) {
    return inflight;
  }

  const promise = new Promise<void>((resolve) => {
    const img = new Image();
    img.decoding = 'async';

    const finish = () => {
      preloadedSlideCache.set(src, img);
      preloadingInflight.delete(src);
      resolve();
    };

    img.onload = () => {
      if (typeof img.decode === 'function') {
        img.decode().then(finish).catch(finish);
      } else {
        finish();
      }
    };
    img.onerror = () => {
      preloadingInflight.delete(src);
      resolve();
    };
    img.src = src;

    if (img.complete && img.naturalWidth > 0) {
      finish();
    }
  });

  preloadingInflight.set(src, promise);
  return promise;
}

function getResponsiveSlideUrl(index: number, isMobile: boolean): string {
  const asset = SLIDESHOW_ASSETS[index % SLIDESHOW_ASSETS.length];
  return isMobile ? asset.mobile : asset.desktop;
}

function randomDurationMs(): number {
  return 5000 + Math.floor(Math.random() * 5001);
}

function randomTransitionDurationSec(): number {
  return 1.55 + Math.random() * 0.45;
}

function pickNextTransition(prev: TransitionKind): TransitionKind {
  const candidates = TRANSITION_KINDS.filter((kind) => kind !== prev);
  return candidates[Math.floor(Math.random() * candidates.length)];
}

interface SlideState {
  index: number;
  cycle: number;
  transition: TransitionKind;
  durationMs: number;
  fadeSec: number;
}

export const BackgroundSlideshow: React.FC = () => {
  const shouldReduceMotion = useReducedMotion();

  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(max-width: 767px)').matches;
  });

  const [firstSlideReady, setFirstSlideReady] = useState<boolean>(() => {
    const firstUrl = getResponsiveSlideUrl(0, isMobile);
    const cached = preloadedSlideCache.get(firstUrl);
    return Boolean(cached && cached.complete && cached.naturalWidth > 0);
  });

  const [slide, setSlide] = useState<SlideState>(() => ({
    index: 0,
    cycle: 0,
    transition: 'crossfade',
    durationMs: randomDurationMs(),
    fadeSec: 1.75,
  }));

  // Track responsive viewport breakpoint cleanly without redundant re-fetches
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia('(max-width: 767px)');
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    setIsMobile(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  // Preload & decode the first slide immediately before displaying it
  useEffect(() => {
    let active = true;
    const firstUrl = getResponsiveSlideUrl(0, isMobile);
    void preloadAndDecodeImage(firstUrl).then(() => {
      if (active) setFirstSlideReady(true);
    });
    return () => {
      active = false;
    };
  }, [isMobile]);

  // Preload next sequential image during the current slide's visible window; advance only when ready
  useEffect(() => {
    if (!firstSlideReady) return;
    let cancelled = false;

    const nextIndex = (slide.index + 1) % SLIDESHOW_ASSETS.length;
    const nextUrl = getResponsiveSlideUrl(nextIndex, isMobile);

    let nextReady = false;
    let timerElapsed = false;

    const advance = () => {
      if (cancelled || !timerElapsed || !nextReady) return;
      setSlide((prev) => ({
        index: (prev.index + 1) % SLIDESHOW_ASSETS.length,
        cycle: prev.cycle + 1,
        transition: pickNextTransition(prev.transition),
        durationMs: randomDurationMs(),
        fadeSec: randomTransitionDurationSec(),
      }));
    };

    void preloadAndDecodeImage(nextUrl).then(() => {
      nextReady = true;
      if (timerElapsed) advance();
    });

    const timer = window.setTimeout(() => {
      timerElapsed = true;
      if (nextReady) {
        advance();
      }
    }, slide.durationMs);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [firstSlideReady, isMobile, slide.index, slide.cycle, slide.durationMs]);

  if (!firstSlideReady) {
    return null;
  }

  const currentSrc = getResponsiveSlideUrl(slide.index, isMobile);
  const displaySec = slide.durationMs / 1000;
  const fadeSec = shouldReduceMotion ? 0.5 : slide.fadeSec;

  const initialScale =
    shouldReduceMotion
      ? 1
      : slide.transition === 'zoomIn'
        ? 1.0
        : slide.transition === 'zoomOut'
          ? 1.09
          : 1.0;

  const targetScale =
    shouldReduceMotion
      ? 1
      : slide.transition === 'zoomIn'
        ? 1.09
        : slide.transition === 'zoomOut'
          ? 1.0
          : 1.0;

  const enterDelay =
    !shouldReduceMotion && slide.transition === 'fade' ? 0.28 : 0;

  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 z-0 pointer-events-none select-none overflow-hidden"
    >
      <AnimatePresence mode="sync" initial={false}>
        <motion.img
          key={`${slide.index}-${slide.cycle}`}
          src={currentSrc}
          alt=""
          decoding="async"
          initial={{
            opacity: slide.cycle === 0 ? BACKGROUND_OPACITY : 0,
            scale: initialScale,
          }}
          animate={{
            opacity: BACKGROUND_OPACITY,
            scale: targetScale,
            transition: {
              opacity: {
                duration: fadeSec,
                delay: slide.cycle === 0 ? 0 : enterDelay,
                ease: 'easeInOut',
              },
              scale: {
                duration: displaySec + fadeSec,
                ease: 'easeOut',
              },
            },
          }}
          exit={{
            opacity: 0,
            transition: {
              opacity: {
                duration: fadeSec,
                ease: 'easeInOut',
              },
            },
          }}
          className="absolute inset-0 w-full h-full object-cover object-center will-change-[opacity,transform]"
        />
      </AnimatePresence>
    </div>
  );
};
