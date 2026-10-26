'use client';

import { useRef, useState } from 'react';
import { goldenKeyExamples, type GoldenKeyExample } from './golden-key-flow';
import styles from './golden-key.module.css';

export { goldenKeyExamples, type GoldenKeyExample } from './golden-key-flow';

export function GoldenKeyPicker({ onChoose, disabled = false }: {
  onChoose: (example: GoldenKeyExample) => void;
  disabled?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [selected, setSelected] = useState<string>(goldenKeyExamples[0].id);
  const [notice, setNotice] = useState('');
  const example = goldenKeyExamples.find((item) => item.id === selected) || goldenKeyExamples[0];
  const close = () => dialog.current?.close();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(example.prompt);
      setNotice('完整初始提示词已复制。');
    } catch {
      setNotice('复制未获授权，请在下方提示词中手动全选复制。');
    }
  };
  return <div className={styles.entry}>
    <button ref={opener} type="button" className={styles.open} data-testid="golden-key-open" disabled={disabled}
      onClick={() => { setNotice(''); dialog.current?.showModal(); }}>
      <span aria-hidden="true">🔑</span> 金钥匙
    </button>
    <span className={styles.entryNote}>电脑版样板 · 先创作，再试玩，逐轮加强</span>
    <dialog ref={dialog} className={styles.dialog} aria-labelledby="golden-key-title"
      onClose={() => opener.current?.focus()} onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
          'button:not(:disabled), textarea, [tabindex="0"]',
        )).filter((element) => element.getClientRects().length);
        const first = controls[0], last = controls.at(-1);
        if (!first || !last) return;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault(); first.focus();
        }
      }} onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close();
      }}>
      <div className={styles.frame}>
        <header className={styles.header}>
          <div><h2 id="golden-key-title">金钥匙</h2><p>电脑版专用提示词：按网页试玩的布局、键鼠操作与能力边界设计，与 APP 样板分开。</p></div>
          <button type="button" className={styles.close} aria-label="关闭金钥匙" onClick={close}>×</button>
        </header>
        <div className={styles.body}>
          <nav className={styles.list} aria-label="金钥匙样板">
            {goldenKeyExamples.map((item) => <button key={item.id} type="button" aria-pressed={selected === item.id}
              data-example-id={item.id} onClick={() => {
                setSelected(item.id); setNotice('');
                requestAnimationFrame(() => heading.current?.focus({ preventScroll: true }));
              }}><strong>{item.title}</strong><span>{item.category}</span></button>)}
          </nav>
          <article className={styles.detail} key={example.id}>
            <h3 ref={heading} tabIndex={-1}>{example.title}</h3>
            <p>{example.summary}</p>
            <h4>使用条件</h4><p>{example.requirements}</p>
            <h4>完整初始提示词</h4>
            <textarea className={styles.prompt} readOnly aria-label="完整初始提示词" value={example.prompt} />
            <h4>生成后，亲自验收</h4>
            <ul>{example.checks.map((check) => <li key={check}>{check}</li>)}</ul>
            <p className={styles.warning}>提示词不等于测试通过。生成后请在电脑上验证键鼠操作、焦点切换、实际计算与暂停恢复；本组样板不依赖手机传感器或麦克风。</p>
            <h4>第一版不是终点</h4>
            <p>生成并试玩后，作品旁会出现以下加强选项。一次选一项，也可以写自己的改进意见。</p>
            <ol>{example.upgrades.map(upgrade => <li key={upgrade.id}><strong>{upgrade.title}</strong>：{upgrade.outcome}</li>)}</ol>
          </article>
        </div>
        <footer className={styles.footer}>
          <div><p>填入为新作品需求，不自动发送；已有作品在发送前保持不变。</p><span role="status" className={styles.status}>{notice}</span></div>
          <div className={styles.actions}><button type="button" onClick={() => void copy()}>复制提示词</button>
            <button type="button" className={styles.primary} onClick={() => { onChoose(example); close(); }}>填入需求</button></div>
        </footer>
      </div>
    </dialog>
  </div>;
}
