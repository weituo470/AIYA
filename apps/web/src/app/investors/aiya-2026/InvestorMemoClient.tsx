'use client';

import { useEffect, type CSSProperties } from 'react';
import styles from './investor-memo.module.css';
import {
  businessPaths,
  productProof,
  progressAxes,
  systemLayers,
  validationStages,
} from './memo-data';

export type ApkManifest = {
  versionCode?: number;
  versionName?: string;
  apkPath?: string;
  apkUrl?: string;
  filename?: string;
  apkBytes?: number;
  apkSha256?: string;
  publishedAt?: string;
};

const formatMegabytes = (bytes?: number) => {
  if (!bytes) return '';
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

export default function InvestorMemoClient({ apk }: { apk: ApkManifest }) {
  useEffect(() => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'));
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) {
      nodes.forEach((node) => { node.dataset.visible = 'true'; });
      return undefined;
    }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        (entry.target as HTMLElement).dataset.visible = 'true';
        observer.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.12 });
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, []);

  const versionName = apk.versionName || '0.6.60';
  const apkHref = apk.apkPath || apk.apkUrl || '/downloads/aiya-v3-debug.apk';
  const filename = apk.filename || `aiya-v3-${versionName}.apk`;
  const size = formatMegabytes(apk.apkBytes);

  return (
    <main className={styles.page}>
      <section className={styles.hero} id="top">
        <div className={styles.heroMedia} aria-hidden="true">
          <img src="/investors/aiya-2026/hero-cover.webp" alt="" />
        </div>
        <div className={styles.heroShade} aria-hidden="true" />
        <header className={styles.topbar}>
          <a className={styles.brand} href="#top" aria-label="返回 AIYA 项目首页">
            <img src="/investors/aiya-2026/aiya-logo.png" alt="" />
            <span>AIYA</span>
          </a>
          <nav className={styles.nav} aria-label="项目导航">
            <a href="#product">产品</a>
            <a href="#validation">验证计划</a>
            <button type="button" onClick={() => window.print()}>打印 / PDF</button>
          </nav>
        </header>

        <div className={styles.heroInner}>
          <div className={styles.heroCopy} data-reveal>
            <p className={styles.eyebrow}>AI 编程教育 · 2026</p>
            <h1>让每个人都能<br />创造数字世界</h1>
            <p className={styles.heroLead}>从“第一次做出作品”，到“掌握 AI 时代的创造方法”。</p>
            <div className={styles.heroActions}>
              <a className={styles.primaryAction} href="/create-theatre" target="_blank" rel="noreferrer">在线体验网页版</a>
              <a className={styles.downloadAction} href={apkHref} download={filename}>下载 V3 APK</a>
            </div>
            <p className={styles.apkMeta}>Android 8.0+ · v{versionName}{size ? ` · ${size}` : ''} · 安装包来自本站</p>
          </div>

          <dl className={styles.heroFacts} data-reveal>
            <div><dt>产品定位</dt><dd>普通人的 AI 创造入口</dd></div>
            <div><dt>当前进度</dt><dd>V2 网页版 + V3 原生移动端</dd></div>
            <div><dt>事实边界</dt><dd>产品能力已落地，商业规模待验证</dd></div>
          </dl>
        </div>
      </section>

      <section className={styles.introSection} id="product">
        <div className={styles.sectionLead} data-reveal>
          <span>PRODUCT PROOF</span>
          <h2>10–20 分钟，完成第一次“我也能创造”</h2>
          <p>AIYA 不要求用户先学语法。用户先把想法变成能玩的作品，再在观察、判断和修改中进入学习。</p>
        </div>

        <div className={styles.phoneRail}>
          {productProof.map((item, index) => (
            <figure key={item.index} className={styles.phoneStory} data-reveal style={{ '--delay': `${index * 90}ms` } as CSSProperties}>
              <div className={styles.phoneFrame}><img src={item.image} alt={`${item.title}的 AIYA 手机端界面`} /></div>
              <figcaption><span>{item.index}</span><strong>{item.title}</strong><p>{item.detail}</p></figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section className={styles.darkSection}>
        <div className={styles.darkCopy} data-reveal>
          <span>LEARNING SYSTEM</span>
          <h2>我们卖的不是代码，<br />也不是课程时长。</h2>
          <p>AIYA 把模型调用封装成老师引导、作品生成、质量验证、课程路径和学习证据。用户购买的是“做成并学会”的结果。</p>
        </div>
        <div className={styles.loop} data-reveal aria-label="AIYA 学习闭环">
          {['做', '看', '想', '验'].map((item, index) => (
            <div key={item}><span>{String(index + 1).padStart(2, '0')}</span><strong>{item}</strong></div>
          ))}
        </div>
      </section>

      <section className={styles.systemSection}>
        <div className={styles.sectionLead} data-reveal>
          <span>CURRICULUM</span>
          <h2>从兴趣启蒙，走向独立创造</h2>
          <p>V3 负责点燃兴趣；AIYA LAB 紧接学习进度，把文件、数据、通信和工程实践逐层引入。</p>
        </div>
        <div className={styles.layerList} data-reveal>
          {systemLayers.map(([level, title, detail, status]) => (
            <div key={level} className={styles.layerRow}>
              <span>{level}</span><strong>{title}</strong><p>{detail}</p><em>{status}</em>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.executionSection}>
        <div className={styles.sectionLead} data-reveal>
          <span>EXECUTION THESIS</span>
          <h2>不谈护城河，先用数据证明四种进步</h2>
          <p>模型能力会快速扩散，功能也会被复制。AIYA 现阶段只承诺建立可观测、可复盘、可持续改进的执行系统。</p>
        </div>
        <div className={styles.axes}>
          {progressAxes.map(([title, detail], index) => (
            <div key={title} className={styles.axis} data-reveal style={{ '--height': `${62 + index * 10}%`, '--delay': `${index * 80}ms` } as CSSProperties}>
              <span>{String(index + 1).padStart(2, '0')}</span><strong>{title}</strong><p>{detail}</p>
            </div>
          ))}
        </div>
        <p className={styles.executionConclusion} data-reveal>用户持续选择、成功成本下降、渠道能够复用之后，防御性才可能出现。</p>
      </section>

      <section className={styles.businessSection}>
        <div className={styles.tokenStatement} data-reveal>
          <span>BUSINESS PROPOSITION</span>
          <h2>把 TOKEN<br />卖给非程序员</h2>
          <p>不是转售调用量，而是把模型成本封装成可交付的创造结果。</p>
        </div>
        <div className={styles.businessPaths} data-reveal>
          <p className={styles.hypothesisLabel}>以下为三个月待验证的商业假设，并非既成收入。</p>
          {businessPaths.map(([title, detail], index) => (
            <div key={title}><span>0{index + 1}</span><strong>{title}</strong><p>{detail}</p></div>
          ))}
        </div>
      </section>

      <section className={styles.validationSection} id="validation">
        <div className={styles.sectionLead} data-reveal>
          <span>12-WEEK VALIDATION</span>
          <h2>三个月，不写远期故事；每两周交付一个答案</h2>
          <p>先确认价值，再确认留存、复制和单位经济。任何判断都由真实任务和真实用户校准。</p>
        </div>
        <ol className={styles.timeline}>
          {validationStages.map(([period, question, evidence], index) => (
            <li key={period} data-reveal style={{ '--delay': `${index * 70}ms` } as CSSProperties}>
              <span>{period}</span><strong>{question}</strong><p>{evidence}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className={styles.finalSection}>
        <img src="/investors/aiya-2026/hero-future.webp" alt="学习者向他人展示自己创作的数字作品" />
        <div className={styles.finalShade} aria-hidden="true" />
        <div className={styles.finalCopy} data-reveal>
          <span>AIYA · AI 编程教育</span>
          <h2>所有伟大，<br />都源于一次勇敢的开始。</h2>
          <p>产品发起 / 作者：君维<br />联系微信：16675143990</p>
          <div className={styles.heroActions}>
            <a className={styles.primaryAction} href="/create-theatre" target="_blank" rel="noreferrer">打开网页版</a>
            <a className={styles.downloadAction} href={apkHref} download={filename}>下载 V3 v{versionName}</a>
          </div>
        </div>
      </section>
    </main>
  );
}
