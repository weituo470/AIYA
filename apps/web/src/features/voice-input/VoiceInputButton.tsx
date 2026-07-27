'use client';

import { type PointerEvent as ReactPointerEvent, type TouchEvent as ReactTouchEvent, useEffect, useRef, useState } from 'react';
import type { UseVoiceInputReturn } from './VoiceInputController';

type VoiceInputButtonProps = {
  voice: UseVoiceInputReturn;
  disabled?: boolean;
  className?: string;
  activeClassName?: string;
  cancelReadyClassName?: string;
  dotClassName?: string;
  labelIdle?: string;
  labelArming?: string;
  labelActive?: string;
  labelCancel?: string;
  armDelayMs?: number;
};

export function VoiceInputButton({
  voice,
  disabled,
  className = '',
  activeClassName = '',
  cancelReadyClassName = '',
  dotClassName = '',
  labelIdle = '按住说话',
  labelArming = '继续按住，变绿后再说',
  labelActive = '松开输入',
  labelCancel = '松开取消',
  armDelayMs = 1000,
}: VoiceInputButtonProps) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const holdActiveRef = useRef(false);
  const holdArmingRef = useRef(false);
  const armTimerRef = useRef<number | null>(null);
  const pressStartRef = useRef<{ clientX: number; clientY: number } | null>(null);
  const releaseGlobalListenersRef = useRef<(() => void) | null>(null);
  const [isArming, setIsArming] = useState(false);
  const isDisabled = Boolean(disabled || !voice.isSupported);
  const isPreheating = isArming || voice.state === 'connecting';
  const isReadyToSpeak = voice.isActive && !isPreheating && !voice.isCancelReady;
  const armMoveCancelPx = 90;
  const classNames = [
    className,
    isReadyToSpeak ? activeClassName : '',
    voice.isCancelReady ? cancelReadyClassName : '',
  ].filter(Boolean).join(' ');
  const label = isPreheating ? labelArming : voice.isCancelReady ? labelCancel : voice.isActive ? labelActive : labelIdle;

  const clearGlobalListeners = () => {
    releaseGlobalListenersRef.current?.();
    releaseGlobalListenersRef.current = null;
  };

  const clearArmTimer = () => {
    if (armTimerRef.current != null) {
      window.clearTimeout(armTimerRef.current);
      armTimerRef.current = null;
    }
  };

  const resetArming = () => {
    clearArmTimer();
    holdArmingRef.current = false;
    setIsArming(false);
  };

  useEffect(() => () => {
    clearArmTimer();
    clearGlobalListeners();
  }, []);

  const endHold = (cancelled = false) => {
    if (holdArmingRef.current) {
      resetArming();
      holdActiveRef.current = false;
      activePointerIdRef.current = null;
      clearGlobalListeners();
      void voice.cancel();
      return;
    }

    if (!holdActiveRef.current) return;
    holdActiveRef.current = false;
    activePointerIdRef.current = null;
    clearGlobalListeners();
    if (cancelled) void voice.cancel();
    else void voice.finish();
  };

  const bindGlobalPointerFinish = (pointerId: number) => {
    clearGlobalListeners();
    const finishFromWindow = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      endHold(false);
    };
    const cancelFromWindow = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      endHold(true);
    };
    window.addEventListener('pointerup', finishFromWindow, true);
    window.addEventListener('pointercancel', cancelFromWindow, true);
    releaseGlobalListenersRef.current = () => {
      window.removeEventListener('pointerup', finishFromWindow, true);
      window.removeEventListener('pointercancel', cancelFromWindow, true);
    };
  };

  const bindGlobalTouchFinish = () => {
    clearGlobalListeners();
    const finishFromWindow = () => endHold(false);
    const cancelFromWindow = () => endHold(true);
    window.addEventListener('touchend', finishFromWindow, true);
    window.addEventListener('touchcancel', cancelFromWindow, true);
    releaseGlobalListenersRef.current = () => {
      window.removeEventListener('touchend', finishFromWindow, true);
      window.removeEventListener('touchcancel', cancelFromWindow, true);
    };
  };

  const beginHold = (point: { clientX: number; clientY: number }, pointerId?: number) => {
    if (isDisabled || holdActiveRef.current || holdArmingRef.current) return false;
    holdArmingRef.current = true;
    holdActiveRef.current = true;
    setIsArming(true);
    activePointerIdRef.current = pointerId ?? null;
    pressStartRef.current = point;
    if (pointerId != null) bindGlobalPointerFinish(pointerId);
    else bindGlobalTouchFinish();
    void voice.start(point);
    armTimerRef.current = window.setTimeout(() => {
      if (!holdArmingRef.current) return;
      holdArmingRef.current = false;
      setIsArming(false);
    }, armDelayMs);
    return true;
  };

  const start = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || holdActiveRef.current || holdArmingRef.current) return;
    event.preventDefault();
    buttonRef.current?.setPointerCapture?.(event.pointerId);
    beginHold({ clientX: event.clientX, clientY: event.clientY }, event.pointerId);
  };

  const move = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if ((!holdActiveRef.current && !holdArmingRef.current) || (activePointerIdRef.current != null && event.pointerId !== activePointerIdRef.current)) return;
    event.preventDefault();
    const rect = buttonRef.current?.getBoundingClientRect();
    if (holdArmingRef.current) {
      const startPoint = pressStartRef.current;
      const movedTooFar = startPoint
        ? Math.abs(event.clientX - startPoint.clientX) > armMoveCancelPx || Math.abs(event.clientY - startPoint.clientY) > armMoveCancelPx
        : false;
      const outside = rect
        ? event.clientX < rect.left - 18 || event.clientX > rect.right + 18 || event.clientY < rect.top - 18 || event.clientY > rect.bottom + 18
        : false;
      if (movedTooFar || outside) endHold(true);
      return;
    }
    voice.move(
      { clientX: event.clientX, clientY: event.clientY },
      rect ? { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom } : undefined,
    );
  };

  const finish = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if ((!holdActiveRef.current && !holdArmingRef.current) || (activePointerIdRef.current != null && event.pointerId !== activePointerIdRef.current)) return;
    event.preventDefault();
    buttonRef.current?.releasePointerCapture?.(event.pointerId);
    endHold(false);
  };

  const cancelCapture = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if ((!holdActiveRef.current && !holdArmingRef.current) || (activePointerIdRef.current != null && event.pointerId !== activePointerIdRef.current)) return;
    event.preventDefault();
    endHold(true);
  };

  const startTouchFallback = (event: ReactTouchEvent<HTMLButtonElement>) => {
    if (holdActiveRef.current || holdArmingRef.current) {
      event.preventDefault();
      return;
    }
    const touch = event.touches[0];
    if (!touch) return;
    event.preventDefault();
    beginHold({ clientX: touch.clientX, clientY: touch.clientY });
  };

  const moveTouchFallback = (event: ReactTouchEvent<HTMLButtonElement>) => {
    if (!holdActiveRef.current && !holdArmingRef.current) return;
    const touch = event.touches[0];
    if (!touch) return;
    event.preventDefault();
    const rect = buttonRef.current?.getBoundingClientRect();
    if (holdArmingRef.current) {
      const startPoint = pressStartRef.current;
      const movedTooFar = startPoint
        ? Math.abs(touch.clientX - startPoint.clientX) > armMoveCancelPx || Math.abs(touch.clientY - startPoint.clientY) > armMoveCancelPx
        : false;
      const outside = rect
        ? touch.clientX < rect.left - 18 || touch.clientX > rect.right + 18 || touch.clientY < rect.top - 18 || touch.clientY > rect.bottom + 18
        : false;
      if (movedTooFar || outside) endHold(true);
      return;
    }
    voice.move(
      { clientX: touch.clientX, clientY: touch.clientY },
      rect ? { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom } : undefined,
    );
  };

  const finishTouchFallback = (event: ReactTouchEvent<HTMLButtonElement>) => {
    if (!holdActiveRef.current && !holdArmingRef.current) return;
    event.preventDefault();
    endHold(false);
  };

  const cancelTouchFallback = (event: ReactTouchEvent<HTMLButtonElement>) => {
    if (!holdActiveRef.current && !holdArmingRef.current) return;
    event.preventDefault();
    endHold(true);
  };

  return (
    <button
      ref={buttonRef}
      className={classNames}
      type="button"
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={finish}
      onPointerCancel={cancelCapture}
      onLostPointerCapture={() => endHold(false)}
      onTouchStart={startTouchFallback}
      onTouchMove={moveTouchFallback}
      onTouchEnd={finishTouchFallback}
      onTouchCancel={cancelTouchFallback}
      onContextMenu={(event) => event.preventDefault()}
      disabled={isDisabled}
      data-arming={isArming ? 'true' : 'false'}
      aria-pressed={voice.isActive}
      aria-label={label}
    >
      <span className={dotClassName} aria-hidden="true" />
      {label}
    </button>
  );
}
