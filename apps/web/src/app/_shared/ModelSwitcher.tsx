'use client';

import { useRef, useState } from 'react';
import styles from './model-switcher.module.css';

type Latency = { available: boolean; durationMs: number; testedAt: string; error?: string };
type Option = { mode: string; label: string; model: string; configured: boolean; reasoning?: string; latency?: Latency };
const seconds = (ms: number) => `${(ms / 1000).toFixed(2)} 秒`;
export function ModelSwitcher() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [options, setOptions] = useState<Option[]>([]);
  const [mode, setMode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [activeLabel, setActiveLabel] = useState('');
  async function open() {
    setError(''); setPassword(''); setBusy(true); setOptions([]);
    dialog.current?.showModal();
    try {
      const response = await fetch('/api/create-theatre/model-selection', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error('无法读取模型配置，请稍后重试。');
      setOptions(data.options); setMode(data.mode);
    } catch (e) { setError(e instanceof Error ? e.message : '读取失败'); }
    finally { setBusy(false); }
  }
  async function submit(action: 'select' | 'test' | 'clear') {
    setBusy(true); setTesting(action === 'test'); setError('');
    try {
      const response = await fetch('/api/create-theatre/model-selection', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, password, action }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || '操作失败，请重试。');
      if (action === 'test') { setOptions(data.options); return; }
      window.dispatchEvent(new Event('aiya-model-selection-changed'));
      setActiveLabel(action === 'clear' ? '' : options.find((item) => item.mode === mode)?.label || '');
      setNotice(action === 'clear' ? '已恢复按生成偏好选择模型。' : '模型已切换，下一次生成生效。');
      setPassword(''); dialog.current?.close();
    } catch (e) { setError(e instanceof Error ? e.message : '操作失败'); }
    finally { setBusy(false); setTesting(false); }
  }
  return <>
    <button className={styles.entry} type="button" title={activeLabel || undefined} onClick={() => void open()}>切换模型</button>
    <span className={styles.srOnly} role="status">{notice}</span>
    <dialog ref={dialog} className={styles.dialog} aria-labelledby="model-switch-title" onClose={() => setPassword('')}>
      <form onSubmit={(event) => { event.preventDefault(); void submit('select'); }}>
        <div className={styles.heading}><h2 id="model-switch-title">切换模型</h2><button type="button" aria-label="关闭" onClick={() => dialog.current?.close()}>×</button></div>
        <p>仅此浏览器生效，下一次生成使用。</p>
        <fieldset disabled={busy} className={styles.options}><legend className={styles.srOnly}>选择模型</legend>
          {options.map((item) => <label key={item.mode} className={styles.option}>
            <input type="radio" name="modelMode" value={item.mode} checked={mode === item.mode} disabled={!item.configured} onChange={() => setMode(item.mode)} />
            <span className={styles.details}>
              <strong>{item.label}</strong>
              <small>{item.model}{item.reasoning ? ` · ${item.reasoning}` : ''}</small>
              <span className={item.latency?.available ? styles.healthy : styles.health}>
                {!item.configured ? '未配置连接信息' : testing ? '正在检测…' : !item.latency ? '尚未检测延时' : item.latency.available ? `可用 · 响应延时 ${seconds(item.latency.durationMs)}` : `不可用 · ${item.latency.error}`}
              </span>
              {item.latency && !testing && <small>
                {!item.latency.available ? `检测用时 ${seconds(item.latency.durationMs)} · ` : ''}
                检测于 {new Date(item.latency.testedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
              </small>}
            </span>
          </label>)}
        </fieldset>
        <label className={styles.password}>操作口令<input autoFocus type="password" value={password} maxLength={128} required autoComplete="off" placeholder="输入操作口令" onChange={(e) => setPassword(e.target.value)} /></label>
        <p className={styles.hint}>延时为服务器完成短句请求的耗时，不是作品生成时间。检测结果复用 5 分钟，打开窗口不会调用模型。</p>
        {options.find((item) => item.mode === mode)?.latency?.available === false && <p className={styles.warning}>所选模型上次检测不可用；生成失败时只尝试另一个模型，不循环切换。</p>}
        {error && <p className={styles.error} role="alert">{error}</p>}
        <div className={styles.actions}>
          <button className={styles.test} type="button" disabled={busy || !password} onClick={() => void submit('test')}>{testing ? '检测中…' : '检测延时'}</button>
          <button className={styles.confirm} type="submit" disabled={busy || !password || !options.find((item) => item.mode === mode)?.configured}>{busy && !testing ? '切换中…' : '确认切换'}</button>
        </div>
        <button className={styles.test} type="button" disabled={busy || !password} onClick={() => void submit('clear')}>恢复按生成偏好选路</button>
      </form>
    </dialog>
  </>;
}
