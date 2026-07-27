import type { TeacherChatMessage } from './types';

export const teacherVoiceStorageKey = 'aiya:create-theatre:teacher-voice';
export const defaultTeacherVoice = 'zh_female_shuangkuaisisi_uranus_bigtts';
export const teacherVoiceOptions = [
  { value: 'zh_female_shuangkuaisisi_uranus_bigtts', label: '爽快思思', note: '清亮、自然', prompt: '用清亮自然、像年轻女老师一样的中文声音朗读' },
  { value: 'zh_female_cancan_uranus_bigtts', label: '灿灿女声', note: '温暖、亲和', prompt: '用温暖亲和、节奏轻快的中文女声朗读' },
  { value: 'zh_female_vv_uranus_bigtts', label: 'VV 女声', note: '活泼、明亮', prompt: '用活泼明亮、有陪伴感的中文女声朗读' },
  { value: 'zh_male_qingshuangnanda_uranus_bigtts', label: '清爽男声', note: '干净、年轻', prompt: '用清爽干净、年轻自然的中文男声朗读' },
  { value: 'zh_male_yangguangqingnian_uranus_bigtts', label: '阳光青年', note: '积极、清晰', prompt: '用阳光积极、清晰有活力的中文男声朗读' },
  { value: 'zh_male_m191_uranus_bigtts', label: '沉稳男声', note: '稳重、清楚', prompt: '用沉稳清楚、像耐心老师一样的中文男声朗读' },
] as const;
export const firstAppSuggestions = [
  { label: '打地鼠', prompt: '做一个打地鼠小游戏，有倒计时、分数、重新开始按钮，地鼠会随机出现。' },
  { label: '画板', prompt: '做一个简洁画板，可以选择颜色、调节画笔大小、清空画布，并适配手机触控。' },
  { label: '计算器', prompt: '做一个四则运算计算器，支持加减乘除、清空、退格，并显示计算历史。' },
  { label: '贪食蛇', prompt: '做一个贪食蛇小游戏，有分数、食物、重新开始按钮，方向键控制，撞墙从另一边出来。' },
  { label: '抽签工具', prompt: '做一个抽签小工具，可以输入候选人，一键随机抽取，并显示抽取结果。' },
  { label: '番茄钟', prompt: '做一个番茄钟，有开始、暂停、重置按钮，并显示学习和休息倒计时。' },
] as const;

export const welcomeTeacherText = '你好呀，让我们从一个小应用开始学习AI编程吧';
export const welcomeTeacherAudioPath = '/audio/teacher-welcome.mp3?v=20260705-welcome-fixed';
export const warmupTeacherTitle = welcomeTeacherText;
export const warmupTeacherTip = '你可以直接说自己的想法，我会亲自写出第一版。';
export const warmupTeacherVoiceText = welcomeTeacherText;
export const teacherWelcomePlaybackRate = 0.8;
export const teacherBrowserSpeechRate = 0.76;

export const stages = [
  { key: 'queued', label: '排队', note: '老师正在整理你的想法，准备亲自写代码。' },
  { key: 'preparing', label: '理解需求', note: '把一句话拆成页面结构、交互状态和验收目标。' },
  { key: 'fast_generating', label: '编写代码', note: '我会快速写出 HTML/CSS/JS。' },
  { key: 'preview_ready', label: '\u53ef\u8bd5\u73a9\u9884\u89c8', note: '\u4f5c\u54c1\u5df2\u7ecf\u5148\u53d1\u5230\u53f3\u4fa7\uff0cAIYA \u6b63\u5728\u540e\u53f0\u7ee7\u7eed\u68c0\u67e5\u3002' },
  { key: 'fast_verify', label: '静态检查', note: 'AIYA 会检查代码是否完整、是否有危险外链。' },
  { key: 'browser_verify', label: '浏览器验证', note: '在真实浏览器里打开 Demo，确认能交互。' },
  { key: 'succeeded', label: '完成', note: '你可以试玩、看源码，并继续提出修改要求。' },
];

export const fallbackHtml = '<!doctype html><html><body style="font-family:system-ui;padding:40px"><h1>等待生成</h1><p>提交想法后，这里会出现可运行的 Demo。</p></body></html>';
export const safeHtml = (html?: string) => html || fallbackHtml;

const previewMobileFitInjection = `
<style id="aiya-preview-mobile-fit-style">
  html, body {
    max-width: 100%;
    overflow-x: hidden !important;
    -webkit-text-size-adjust: 100%;
    text-size-adjust: 100%;
  }
  *, *::before, *::after {
    box-sizing: border-box;
  }
  img, canvas, svg, video {
    max-width: 100%;
  }
</style>
<script id="aiya-preview-mobile-fit-script">
(function () {
  var scheduled = false;
  function applyAiyaPreviewMobileFit() {
    scheduled = false;
    var root = document.body;
    if (!root) return;
    var viewportWidth = Math.max(1, document.documentElement.clientWidth || window.innerWidth || 0);
    root.style.transform = '';
    root.style.transformOrigin = '';
    root.style.width = '';
    root.style.minHeight = '';
    document.documentElement.style.minHeight = '';
    document.documentElement.style.overflowX = 'hidden';
    root.style.overflowX = 'hidden';
    var scrollWidth = Math.max(root.scrollWidth || 0, document.documentElement.scrollWidth || 0);
    if (scrollWidth > viewportWidth + 4) {
      var scale = Math.max(0.42, Math.min(1, (viewportWidth - 2) / scrollWidth));
      var scrollHeight = Math.max(root.scrollHeight || 0, document.documentElement.scrollHeight || 0, window.innerHeight || 0);
      root.style.transformOrigin = 'top left';
      root.style.transform = 'scale(' + scale + ')';
      root.style.width = (100 / scale) + '%';
      root.style.minHeight = Math.ceil(scrollHeight * scale) + 'px';
      document.documentElement.style.minHeight = Math.ceil(scrollHeight * scale) + 'px';
    }
  }
  function scheduleAiyaPreviewMobileFit() {
    if (scheduled) return;
    scheduled = true;
    window.setTimeout(applyAiyaPreviewMobileFit, 40);
  }
  window.addEventListener('load', scheduleAiyaPreviewMobileFit);
  window.addEventListener('resize', scheduleAiyaPreviewMobileFit);
  window.setTimeout(applyAiyaPreviewMobileFit, 80);
  window.setTimeout(applyAiyaPreviewMobileFit, 450);
  window.setTimeout(applyAiyaPreviewMobileFit, 1100);
})();
</script>`;

export const safePreviewHtml = (html?: string) => {
  const source = safeHtml(html);
  if (source.includes('aiya-preview-mobile-fit-script')) return source;
  if (/<\/body>/i.test(source)) {
    return source.replace(/<\/body>/i, `${previewMobileFitInjection}</body>`);
  }
  return `${source}${previewMobileFitInjection}`;
};

export const formatDuration = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60).toString().padStart(2, '0')}:${(total % 60).toString().padStart(2, '0')}`;
};

export const stageLabel = (stage?: string) => stages.find((item) => item.key === stage)?.label || stage || '等待开始';
export const versionLabel = (version: number) => `第${version}版`;
export const makeChatId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
export const corruptedTextMarkers = ['???', '\uFFFD', '\u951B', '\u9470', '\u59DD'];
export const looksLikeCorruptedText = (text: string) => corruptedTextMarkers.some((marker) => text.includes(marker));
export const safeTeacherText = (text: string) => (looksLikeCorruptedText(text) ? welcomeTeacherText : text);
export const makeTeacherMessage = (text: string): TeacherChatMessage => ({
  id: makeChatId(),
  role: 'teacher',
  text: safeTeacherText(text),
  at: new Date().toISOString(),
});
export const makeStudentMessage = (text: string): TeacherChatMessage => ({
  id: makeChatId(),
  role: 'student',
  text,
  at: new Date().toISOString(),
});
export const teacherProgressScript = (stage?: string, attempts?: number) => {
  const round = attempts && attempts > 1 ? `我已经试到第 ${attempts} 轮` : '';
  const linesByStage: Record<string, string[]> = {
    queued: ['我接到你的需求', '我先把它放进生成队列', '我准备开始做第一版'],
    preparing: ['我理了一遍逻辑', '我把想法拆成界面和交互', '我定下最小可运行版本'],
    fast_generating: ['我写下第一行代码', '我搭好了页面框架', '我填进核心逻辑', '我正在把它变成能玩的 Demo'],
    preview_ready: ['\u6211\u5148\u628a\u80fd\u73a9\u7684\u7248\u672c\u53d1\u7ed9\u4f60', '\u6211\u8fd8\u5728\u540e\u53f0\u505a\u68c0\u67e5', '\u4f60\u53ef\u4ee5\u5148\u8bd5\u73a9\uff0c\u6709\u95ee\u9898\u6211\u4f1a\u7ee7\u7eed\u4fee'],
    fast_verify: ['我做了一遍校验', '我检查代码是否完整', '我排除危险外链', round || '我准备进入浏览器测试'],
    browser_verify: ['我打开了浏览器', '我点了一下关键按钮', '我看页面有没有响应', round || '我正在确认它真的能用'],
    succeeded: ['我通过了校验', '我整理好代码', '我把作品发给你', '我等你试玩'],
    failed: ['我出了错', '我看到了失败原因', '我会换一种写法再试'],
  };
  return (linesByStage[stage || 'queued'] || linesByStage.queued).filter(Boolean).join('\n');
};
