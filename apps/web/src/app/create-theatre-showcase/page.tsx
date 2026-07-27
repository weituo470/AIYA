'use client';

import { useEffect, useMemo, useState } from 'react';
import styles from './page.module.css';

type ShowcaseWork = {
  id: string;
  title: string;
  brief: string;
  author: string;
  html: string;
  featuredAt: string;
};

const formatDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' });
};

export default function CreateTheatreShowcasePage() {
  const [works, setWorks] = useState<ShowcaseWork[]>([]);
  const [activeId, setActiveId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const activeWork = useMemo(
    () => works.find((work) => work.id === activeId) || works[0],
    [activeId, works],
  );

  useEffect(() => {
    let cancelled = false;
    fetch('/api/create-theatre/showcase', { cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.ok) throw new Error(payload?.error || '作品集加载失败。');
        if (!cancelled) {
          setWorks(Array.isArray(payload.works) ? payload.works : []);
          setActiveId(payload.works?.[0]?.id || '');
        }
      })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : '作品集加载失败。'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <div className={styles.heroGlow} />
        <div className={styles.brand}>AIYA</div>
        <p className={styles.eyebrow}>优秀作品展示</p>
        <h1>把好想法，<br />做成能玩的作品。</h1>
        <p className={styles.intro}>每一件作品都来自真实的创作需求，点击即可试玩。</p>
        <a className={styles.createLink} href="/create-theatre-v2">我也要创作 <span>→</span></a>
      </header>

      <section className={styles.gallery} aria-label="优秀作品列表">
        {loading && <p className={styles.state}>正在整理优秀作品…</p>}
        {error && <p className={styles.error}>{error}</p>}
        {!loading && !error && works.length === 0 && (
          <p className={styles.state}>优秀作品正在准备中，下一件可能就来自你的创作。</p>
        )}
        {works.map((work, index) => (
          <button
            type="button"
            key={work.id}
            className={`${styles.workRow} ${activeWork?.id === work.id ? styles.workRowActive : ''}`}
            onClick={() => setActiveId(work.id)}
          >
            <span className={styles.workIndex}>{String(index + 1).padStart(2, '0')}</span>
            <span className={styles.workMain}>
              <strong>{work.title}</strong>
              <small>{work.brief}</small>
            </span>
            <span className={styles.workMeta}>{work.author}<br />{formatDate(work.featuredAt)}</span>
          </button>
        ))}
      </section>

      {activeWork && (
        <section className={styles.previewSection} aria-label={`${activeWork.title}试玩`}>
          <div className={styles.previewHeader}>
            <div><p>正在试玩</p><h2>{activeWork.title}</h2></div>
            <span>安全试玩模式</span>
          </div>
          <div className={styles.previewFrame}>
            <iframe
              key={activeWork.id}
              title={`${activeWork.title}试玩`}
              srcDoc={activeWork.html}
              sandbox="allow-scripts"
              referrerPolicy="no-referrer"
            />
          </div>
        </section>
      )}
    </main>
  );
}
