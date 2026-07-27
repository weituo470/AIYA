'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createTheatreGuideSteps, createTheatreGuideStorageKey } from '../_core/guide';

export type GuideRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

const readGuideState = () => {
  try {
    return window.localStorage.getItem(createTheatreGuideStorageKey);
  } catch {
    return null;
  }
};

const writeGuideState = (value: string) => {
  try {
    window.localStorage.setItem(createTheatreGuideStorageKey, value);
  } catch {}
};

export function useCreateTheatreGuide() {
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [guideIndex, setGuideIndex] = useState(0);
  const [guideRect, setGuideRect] = useState<GuideRect | null>(null);
  const [guideReady, setGuideReady] = useState(false);

  const guideStep = createTheatreGuideSteps[guideIndex] || createTheatreGuideSteps[0];

  const measureGuideTarget = useCallback(() => {
    if (!isGuideOpen || !guideStep) return;
    const target = document.querySelector<HTMLElement>(`[data-guide-id="${guideStep.targetId}"]`);
    if (!target) {
      setGuideRect(null);
      return;
    }
    const rect = target.getBoundingClientRect();
    setGuideRect({
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
    });
  }, [guideStep, isGuideOpen]);

  useEffect(() => {
    setGuideReady(true);
    if (readGuideState()) return;
    const timer = window.setTimeout(() => {
      setGuideIndex(0);
      setIsGuideOpen(true);
    }, 900);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!isGuideOpen || !guideStep) return;
    const target = document.querySelector<HTMLElement>(`[data-guide-id="${guideStep.targetId}"]`);
    target?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
    const firstFrame = window.requestAnimationFrame(measureGuideTarget);
    const secondMeasure = window.setTimeout(measureGuideTarget, 360);
    window.addEventListener('resize', measureGuideTarget);
    window.addEventListener('scroll', measureGuideTarget, true);
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.clearTimeout(secondMeasure);
      window.removeEventListener('resize', measureGuideTarget);
      window.removeEventListener('scroll', measureGuideTarget, true);
    };
  }, [guideStep, isGuideOpen, measureGuideTarget]);

  const startGuide = useCallback(() => {
    setGuideIndex(0);
    setIsGuideOpen(true);
    window.setTimeout(measureGuideTarget, 0);
  }, [measureGuideTarget]);

  const closeGuide = useCallback(() => {
    writeGuideState('dismissed');
    setIsGuideOpen(false);
  }, []);

  const nextGuideStep = useCallback(() => {
    setGuideIndex((current) => {
      const next = current + 1;
      if (next >= createTheatreGuideSteps.length) {
        writeGuideState('completed');
        setIsGuideOpen(false);
        return current;
      }
      return next;
    });
  }, []);

  const previousGuideStep = useCallback(() => {
    setGuideIndex((current) => Math.max(0, current - 1));
  }, []);

  return useMemo(() => ({
    guideReady,
    isGuideOpen,
    guideIndex,
    guideStep,
    guideRect,
    guideTotal: createTheatreGuideSteps.length,
    startGuide,
    closeGuide,
    nextGuideStep,
    previousGuideStep,
  }), [closeGuide, guideIndex, guideReady, guideRect, guideStep, isGuideOpen, nextGuideStep, previousGuideStep, startGuide]);
}
