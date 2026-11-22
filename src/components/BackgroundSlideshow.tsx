import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';

const SLIDESHOW_IMAGES = [
  '/assets/aistudio/image_e8ba54e4.png',
  '/assets/aistudio/image_4d8c9889.png',
  '/assets/aistudio/image_947e871b.png',
  '/assets/aistudio/image_5184b4aa.png',
  '/assets/aistudio/image_f7f2d4e5.png',
] as const;

type TransitionKind = 'crossfade' | 'fade' | 'zoomIn' | 'zoomOut';

const TRANSITION_KINDS: TransitionKind[] = [
  'crossfade',
  'fade',
  'zoomIn',
  'zoomOut',
];

const BACKGROUND_OPACITY = 0.18;

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

  const [slide, setSlide] = useState<SlideState>(() => ({
    index: 0,
    cycle: 0,
    transition: 'crossfade',
    durationMs: randomDurationMs(),
    fadeSec: 1.75,
  }));

  useEffect(() => {
    let cancelled = false;
    const nextIndex = (slide.index + 1) % SLIDESHOW_IMAGES.length;
    const nextSrc = SLIDESHOW_IMAGES[nextIndex];

    let nextImageLoaded = false;
    let timerElapsed = false;

    const advance = () => {
      if (cancelled || !timerElapsed) return;
      setSlide((prev) => ({
        index: (prev.index + 1) % SLIDESHOW_IMAGES.length,
        cycle: prev.cycle + 1,
        transition: pickNextTransition(prev.transition),
        durationMs: randomDurationMs(),
        fadeSec: randomTransitionDurationSec(),
      }));
    };

    const preloader = new Image();
    preloader.decoding = 'async';
    preloader.onload = () => {
      nextImageLoaded = true;
      if (timerElapsed) advance();
    };
    preloader.onerror = () => {
      nextImageLoaded = true;
      if (timerElapsed) advance();
    };
    preloader.src = nextSrc;

    const timer = window.setTimeout(() => {
      timerElapsed = true;
      if (nextImageLoaded || preloader.complete) {
        advance();
      } else {
        // Fallback safety in case network is slow so sequence continues
        window.setTimeout(advance, 1500);
      }
    }, slide.durationMs);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [slide.index, slide.cycle, slide.durationMs]);

  const currentSrc = SLIDESHOW_IMAGES[slide.index];
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
    !shouldReduceMotion && slide.transition === 'fade' ? 0.3 : 0;

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
          fetchPriority={slide.cycle === 0 ? 'high' : 'low'}
          initial={{
            opacity: 0,
            scale: initialScale,
          }}
          animate={{
            opacity: BACKGROUND_OPACITY,
            scale: targetScale,
            transition: {
              opacity: {
                duration: fadeSec,
                delay: enterDelay,
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
