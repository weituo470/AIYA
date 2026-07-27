'use client';

import type { CSSProperties } from 'react';
import type { CreateTheatreGuideStep } from '../_core/guide';
import type { GuideRect } from '../_hooks/useCreateTheatreGuide';
import styles from '../create-theatre.module.css';

type GameGuideOverlayProps = {
  step: CreateTheatreGuideStep;
  index: number;
  total: number;
  rect: GuideRect | null;
  onNext: () => void;
  onPrevious: () => void;
  onClose: () => void;
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

function getCoachStyle(rect: GuideRect | null): CSSProperties {
  if (typeof window === 'undefined' || !rect) {
    return { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' };
  }
  const width = Math.min(380, window.innerWidth - 32);
  const shouldPlaceAbove = rect.top > window.innerHeight * 0.48;
  const left = clamp(rect.left + rect.width / 2 - width / 2, 16, window.innerWidth - width - 16);
  const preferredTop = shouldPlaceAbove ? rect.top - 220 : rect.top + rect.height + 18;
  const top = clamp(preferredTop, 18, window.innerHeight - 250);
  return { width, left, top };
}

function getPointerStyle(rect: GuideRect | null): CSSProperties {
  if (typeof window === 'undefined' || !rect) return { display: 'none' };
  const left = clamp(rect.left + rect.width * 0.72, 28, window.innerWidth - 70);
  const top = clamp(rect.top + rect.height * 0.52, 72, window.innerHeight - 90);
  return { left, top };
}

export function GameGuideOverlay({ step, index, total, rect, onNext, onPrevious, onClose }: GameGuideOverlayProps) {
  const spotlightStyle: CSSProperties = rect
    ? {
        top: rect.top - 10,
        left: rect.left - 10,
        width: rect.width + 20,
        height: rect.height + 20,
      }
    : { top: '18%', left: '8%', width: '84%', height: 170 };

  return (
    <div className={styles.guideOverlay} data-testid="game-guide-overlay" aria-live="polite">
      <div className={styles.guideSpotlight} style={spotlightStyle} />
      <div className={styles.guidePointer} style={getPointerStyle(rect)} aria-hidden="true">
        <span />
      </div>
      <section className={styles.guideCoach} style={getCoachStyle(rect)} aria-label="AIYA 新手引导">
        <div className={styles.guideCoachTopline}>
          <span>{step.badge}</span>
          <small>{index + 1}/{total}</small>
        </div>
        <h3>{step.title}</h3>
        <p>{step.body}</p>
        <blockquote>{step.coachLine}</blockquote>
        <div className={styles.guideProgress} aria-hidden="true">
          <span style={{ width: `${((index + 1) / total) * 100}%` }} />
        </div>
        <div className={styles.guideActions}>
          <button type="button" onClick={onClose}>跳过教程</button>
          <div>
            <button type="button" onClick={onPrevious} disabled={index === 0}>上一步</button>
            <button type="button" onClick={onNext}>{index + 1 === total ? '完成教程' : '下一步'}</button>
          </div>
        </div>
      </section>
    </div>
  );
}
