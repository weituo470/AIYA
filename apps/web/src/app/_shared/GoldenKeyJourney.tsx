'use client';

import { useState } from 'react';
import { resolveGoldenKeyExample, type GoldenKeyLineage, type GoldenKeyUpgrade } from './golden-key-flow';
import styles from './golden-key.module.css';

export function GoldenKeyJourney({ app, version, disabled, onChoose }: {
  app: { html?: string; title?: string; goldenKey?: GoldenKeyLineage } | null;
  version: number;
  disabled: boolean;
  onChoose: (exampleId: string, upgrade: GoldenKeyUpgrade) => void;
}) {
  const example = resolveGoldenKeyExample(app);
  const [selected, setSelected] = useState('');
  if (!example) return null;
  const upgrade = example.upgrades.find(item => item.id === selected) || example.upgrades[0];
  const completed = app?.goldenKey?.completedUpgradeIds || [];
  return <details className={styles.journey} data-testid="golden-key-journey" key={example.id}>
    <summary>🔑 {example.title} · 继续加强 <span>已有第{version}版</span></summary>
    <div className={styles.journeyBody}>
      <p className={styles.flow}>创意 → 初步产出 → 改进意见 → 更好产出</p>
      <p>先试玩，找到值得改进的地方。一次选一项，填入后可调整；点击发送才开始修改当前作品。</p>
      <div className={styles.upgradeChoices} aria-label="选择加强方向">
        {example.upgrades.map(item => <button type="button" key={item.id} data-upgrade-id={item.id}
          aria-pressed={item.id === upgrade.id} disabled={disabled} onClick={() => setSelected(item.id)}>
          {item.title}{completed.includes(item.id) ? <span>已生成 · 请验收</span> : null}
        </button>)}
      </div>
      <h3>{upgrade.title}</h3><p>{upgrade.outcome}</p>
      <ul>{upgrade.checks.map(check => <li key={check}>{check}</li>)}</ul>
      <button type="button" className={styles.primary} disabled={disabled} data-testid="golden-upgrade-fill"
        onClick={() => onChoose(example.id, upgrade)}>填入这轮改进意见</button>
      <p className={styles.journeyNote}>{disabled ? '当前任务结束后再选择下一轮改进。' : '不是一键变完美：生成后，对照上面的验收点，亲自比较改进前后的效果。'}</p>
    </div>
  </details>;
}
