'use client';
import { useEffect, useState } from 'react';
import { buildPreferenceDescriptions, buildPreferenceLabels, type BuildPreference } from '../../lib/build-contract';
import { buildPreferenceEvent, buildPreferenceStorageKey, readBuildPreference } from './build-preference-storage';
import styles from './build-preference.module.css';

export function BuildPreferenceSelector() {
  const [preference, setPreference] = useState<BuildPreference>('auto');
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  useEffect(() => {
    const refresh = () => setPreference(readBuildPreference());
    refresh(); window.addEventListener('storage', refresh); window.addEventListener(buildPreferenceEvent, refresh);
    return () => { window.removeEventListener('storage', refresh); window.removeEventListener(buildPreferenceEvent, refresh); };
  }, []);
  const choose = (next: BuildPreference) => {
    try { window.localStorage.setItem(buildPreferenceStorageKey, next); setStorageUnavailable(false); }
    catch { setStorageUnavailable(true); return; }
    setPreference(next); window.dispatchEvent(new Event(buildPreferenceEvent));
  };
  return <section className={styles.selector} aria-label="生成偏好">
    <fieldset><legend>生成偏好</legend><div className={styles.choices}>
      {(['speed', 'auto', 'quality'] as const).map(value => <label key={value}>
        <input type="radio" name="buildPreference" checked={value === preference} onChange={() => choose(value)} />
        <span>{buildPreferenceLabels[value]}</span>
      </label>)}
    </div></fieldset>
    <p role="status">{storageUnavailable ? '浏览器禁止保存偏好，本次仍使用智能判断。' : `${buildPreferenceDescriptions[preference]} 切换仅影响下一次任务；已手选模型时保留该模型。`}</p>
  </section>;
}
