import { createHash } from 'node:crypto';
import {
  createTheatreModelModes,
  readCreateTheatreAdminSettings,
  resolveCreateTheatreRuntimeModelConfig,
  type CreateTheatreModelMode,
} from './_admin-settings';
import { chatWithHermesModel } from './_hermes-model-health';

export const appIconSymbols = [
  'snake',
  'calculator',
  'drawing',
  'game',
  'balloon',
  'fan',
  'music',
  'book',
  'rocket',
  'timer',
  'food',
  'camera',
  'chat',
  'puzzle',
  'utility',
] as const;

export const appIconPalettes = [
  'mint',
  'ocean',
  'violet',
  'sunset',
  'berry',
  'sky',
  'lime',
  'indigo',
] as const;

export type AppIconSymbol = (typeof appIconSymbols)[number];
export type AppIconPalette = (typeof appIconPalettes)[number];

export type AppIconDesign = {
  symbol: AppIconSymbol;
  palette: AppIconPalette;
  concept: string;
};

export type AppIconResult = {
  source: 'hermes' | 'fallback';
  model: string;
  modelMode: CreateTheatreModelMode;
  durationMs: number;
  design: AppIconDesign;
  vectorXml: string;
  previewSvg: string;
  brand: 'AIYA';
  failover: Array<{
    mode: CreateTheatreModelMode;
    model: string;
    configFingerprint: string;
    status: 'failed' | 'succeeded';
    error?: string;
  }>;
  error?: string;
};

type GlyphPath = { fill: 'surface' | 'accent' | 'highlight'; data: string };

const paletteColors: Record<AppIconPalette, { background: string; accent: string; highlight: string }> = {
  mint: { background: '#08B989', accent: '#007B62', highlight: '#9FF4D5' },
  ocean: { background: '#3B82F6', accent: '#1D4ED8', highlight: '#BFDBFE' },
  violet: { background: '#8B5CF6', accent: '#5B21B6', highlight: '#DDD6FE' },
  sunset: { background: '#F97316', accent: '#C2410C', highlight: '#FED7AA' },
  berry: { background: '#EC4899', accent: '#BE185D', highlight: '#FBCFE8' },
  sky: { background: '#06B6D4', accent: '#0E7490', highlight: '#CFFAFE' },
  lime: { background: '#65A30D', accent: '#3F6212', highlight: '#D9F99D' },
  indigo: { background: '#6366F1', accent: '#3730A3', highlight: '#C7D2FE' },
};

const glyphs: Record<AppIconSymbol, GlyphPath[]> = {
  snake: [
    { fill: 'surface', data: 'M6,3 H15 C18.9,3 21,5.1 21,8 C21,10.9 18.9,13 15,13 H9 C7.7,13 7,13.7 7,15 C7,16.3 7.7,17 9,17 H18 V21 H9 C5.1,21 3,18.9 3,15 C3,12.1 5.1,9 9,9 H15 C16.3,9 17,8.3 17,8 C17,7.3 16.3,7 15,7 H6 Z' },
    { fill: 'accent', data: 'M6,3 H10 V7 H6 Z M18,18 A1.25,1.25 0,1 0,18,20.5 A1.25,1.25 0,1 0,18,18' },
  ],
  calculator: [
    { fill: 'surface', data: 'M5,2 H19 C20.1,2 21,2.9 21,4 V20 C21,21.1 20.1,22 19,22 H5 C3.9,22 3,21.1 3,20 V4 C3,2.9 3.9,2 5,2 Z' },
    { fill: 'accent', data: 'M6,5 H18 V9 H6 Z M6,12 H9 V15 H6 Z M10.5,12 H13.5 V15 H10.5 Z M15,12 H18 V15 H15 Z M6,16.5 H9 V19.5 H6 Z M10.5,16.5 H13.5 V19.5 H10.5 Z M15,16.5 H18 V19.5 H15 Z' },
  ],
  drawing: [
    { fill: 'surface', data: 'M3,17.25 V21 H6.75 L17.81,9.94 L14.06,6.19 Z M20.71,7.04 C21.1,6.65 21.1,6.02 20.71,5.63 L18.37,3.29 C17.98,2.9 17.35,2.9 16.96,3.29 L15.13,5.12 L18.88,8.87 Z' },
    { fill: 'highlight', data: 'M3,21 L7.2,20.2 L3.8,16.8 Z' },
  ],
  game: [
    { fill: 'surface', data: 'M7,6 H17 C20.9,6 23,9.4 23,15.2 C23,18.4 21.4,20 19.4,20 C17.8,20 16.8,18.7 15.5,17 H8.5 C7.2,18.7 6.2,20 4.6,20 C2.6,20 1,18.4 1,15.2 C1,9.4 3.1,6 7,6 Z' },
    { fill: 'accent', data: 'M6,9 H8 V11 H10 V13 H8 V15 H6 V13 H4 V11 H6 Z M16.5,10 A1.5,1.5 0,1 0,16.5,13 A1.5,1.5 0,1 0,16.5,10 M19.5,13 A1.5,1.5 0,1 0,19.5,16 A1.5,1.5 0,1 0,19.5,13' },
  ],
  balloon: [
    { fill: 'surface', data: 'M12,2 C7.6,2 5,5.4 5,9.5 C5,13.5 7.5,17 11,17.8 L10,20 H14 L13,17.8 C16.5,17 19,13.5 19,9.5 C19,5.4 16.4,2 12,2 Z M10,21 H14 V23 H10 Z' },
    { fill: 'highlight', data: 'M9,5 C7.5,6.2 7,7.8 7.2,9.4 C8.2,8.2 9.3,7.5 10.8,7 Z' },
  ],
  fan: [
    { fill: 'surface', data: 'M12,9 C10.3,9 9,10.3 9,12 C9,13.7 10.3,15 12,15 C13.7,15 15,13.7 15,12 C15,10.3 13.7,9 12,9 Z M11,2 C15,2 17,4 16,7.5 L14.3,10 C13.8,8.5 12.5,7.5 11,7 Z M22,11 C22,15 20,17 16.5,16 L14,14.3 C15.5,13.8 16.5,12.5 16.5,11 Z M13,22 C9,22 7,20 8,16.5 L9.7,14 C10.2,15.5 11.5,16.5 13,16.5 Z M2,13 C2,9 4,7 7.5,8 L10,9.7 C8.5,10.2 7.5,11.5 7.5,13 Z' },
  ],
  music: [
    { fill: 'surface', data: 'M12,3 V15.5 C11.4,15.2 10.7,15 10,15 C7.8,15 6,16.3 6,18 C6,19.7 7.8,21 10,21 C12.2,21 14,19.7 14,18 V8 H19 V5 Z' },
    { fill: 'highlight', data: 'M14,8 H19 V11 H14 Z' },
  ],
  book: [
    { fill: 'surface', data: 'M3,4 C6.8,3.2 9.6,3.8 12,5.5 C14.4,3.8 17.2,3.2 21,4 V19 C17.2,18.2 14.4,18.8 12,20.5 C9.6,18.8 6.8,18.2 3,19 Z' },
    { fill: 'accent', data: 'M11,6 H13 V18 H11 Z' },
  ],
  rocket: [
    { fill: 'surface', data: 'M14,2 C18,3 21,6 22,10 L16,16 L8,8 Z M7,9 L3,11 L2,16 L7,15 L9,13 Z M15,17 L13,19 L14,22 L19,21 L21,17 Z M8,16 L5,19 L5,22 L8,22 L11,19 Z' },
    { fill: 'accent', data: 'M16,6 A2,2 0,1 0,16,10 A2,2 0,1 0,16,6' },
  ],
  timer: [
    { fill: 'surface', data: 'M9,2 H15 V5 H9 Z M11,6 C6,6 3,9.6 3,14 C3,18.4 6.6,22 11,22 C15.4,22 19,18.4 19,14 C19,9.6 15.4,6 11,6 Z M20,7 L22,9 L19.5,11.5 L17.5,9.5 Z' },
    { fill: 'accent', data: 'M10,9 H12 V15 L16,17 L15,19 L10,16 Z' },
  ],
  food: [
    { fill: 'surface', data: 'M3,3 H5 V10 H7 V3 H9 V10 C9,12 8,13 6,14 V22 H4 V14 C2,13 1,12 1,10 V3 Z M15,3 C19,3 21,7 21,11 C21,14 19.5,16 17,16 V22 H15 Z' },
  ],
  camera: [
    { fill: 'surface', data: 'M4,6 H8 L10,3 H14 L16,6 H20 C21.1,6 22,6.9 22,8 V19 C22,20.1 21.1,21 20,21 H4 C2.9,21 2,20.1 2,19 V8 C2,6.9 2.9,6 4,6 Z' },
    { fill: 'accent', data: 'M12,9 A4,4 0,1 0,12,17 A4,4 0,1 0,12,9 M18,8 A1,1 0,1 0,18,10 A1,1 0,1 0,18,8' },
  ],
  chat: [
    { fill: 'surface', data: 'M4,3 H20 C21.1,3 22,3.9 22,5 V16 C22,17.1 21.1,18 20,18 H9 L4,22 V18 C2.9,18 2,17.1 2,16 V5 C2,3.9 2.9,3 4,3 Z' },
    { fill: 'accent', data: 'M6,8 H18 V10 H6 Z M6,12 H15 V14 H6 Z' },
  ],
  puzzle: [
    { fill: 'surface', data: 'M3,4 H9 C9,2.3 10.3,1 12,1 C13.7,1 15,2.3 15,4 H21 V10 C19.3,10 18,11.3 18,13 C18,14.7 19.3,16 21,16 V22 H15 C15,20.3 13.7,19 12,19 C10.3,19 9,20.3 9,22 H3 V16 C4.7,16 6,14.7 6,13 C6,11.3 4.7,10 3,10 Z' },
  ],
  utility: [
    { fill: 'surface', data: 'M3,3 H10 V10 H3 Z M14,3 H21 V10 H14 Z M3,14 H10 V21 H3 Z M14,14 H21 V21 H14 Z' },
    { fill: 'highlight', data: 'M5,5 H8 V8 H5 Z M16,5 H19 V8 H16 Z M5,16 H8 V19 H5 Z M16,16 H19 V19 H16 Z' },
  ],
};

const fallbackKeywords: Array<[RegExp, AppIconSymbol]> = [
  [/(贪吃蛇|snake)/i, 'snake'],
  [/(计算器|calculator|算数|数学)/i, 'calculator'],
  [/(画板|绘画|涂鸦|drawing|paint)/i, 'drawing'],
  [/(游戏|打地鼠|反应|对战|点击|闯关|game|reaction|battle|tap|click|棋|迷宫)/i, 'game'],
  [/(气球|balloon)/i, 'balloon'],
  [/(风扇|fan)/i, 'fan'],
  [/(音乐|钢琴|music|音符)/i, 'music'],
  [/(书|阅读|book|单词)/i, 'book'],
  [/(火箭|rocket|太空)/i, 'rocket'],
  [/(计时|倒计时|timer|时钟)/i, 'timer'],
  [/(食物|菜单|food|餐)/i, 'food'],
  [/(相机|camera|拍照)/i, 'camera'],
  [/(聊天|对话|chat)/i, 'chat'],
  [/(拼图|puzzle)/i, 'puzzle'],
];

const htmlSummary = (html: string) => html
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&(?:nbsp|amp|lt|gt|quot|#39);/gi, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 1400);

const hashIndex = (value: string, length: number) => Number.parseInt(
  createHash('sha256').update(value).digest('hex').slice(0, 8),
  16,
) % length;

const fallbackDesign = (title: string, brief: string, html: string): AppIconDesign => {
  const sample = `${title} ${brief} ${htmlSummary(html)}`;
  const symbol = fallbackKeywords.find(([pattern]) => pattern.test(sample))?.[1] || 'utility';
  return {
    symbol,
    palette: appIconPalettes[hashIndex(sample, appIconPalettes.length)],
    concept: `${title}的简洁功能图标`,
  };
};

const parseModelJson = (content: string): AppIconDesign => {
  const match = content.replace(/```(?:json)?/gi, '').replace(/```/g, '').match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Hermes 未返回图标设计 JSON');
  const value = JSON.parse(match[0]) as Record<string, unknown>;
  const symbol = String(value.symbol || '') as AppIconSymbol;
  const palette = String(value.palette || '') as AppIconPalette;
  if (!appIconSymbols.includes(symbol)) throw new Error(`Hermes 返回了不支持的图形：${symbol || '空'}`);
  if (!appIconPalettes.includes(palette)) throw new Error(`Hermes 返回了不支持的配色：${palette || '空'}`);
  return {
    symbol,
    palette,
    concept: String(value.concept || '').replace(/\s+/g, ' ').trim().slice(0, 80) || `${symbol} app icon`,
  };
};

export type ShowcaseShortTitleResult = {
  source: 'hermes' | 'fallback';
  title: string;
  model: string;
  modelMode: CreateTheatreModelMode;
  durationMs: number;
  failover: Array<{
    mode: CreateTheatreModelMode;
    model: string;
    configFingerprint: string;
    status: 'failed' | 'succeeded';
    error?: string;
  }>;
  error?: string;
};

const parseShowcaseShortTitle = (content: string) => {
  const plain = content.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  const match = plain.match(/\{[\s\S]*\}/);
  const value = match ? JSON.parse(match[0]) as Record<string, unknown> : { name: plain };
  const title = String(value.name || value.title || '')
    .replace(/[\s\p{P}\p{S}]/gu, '')
    .trim();
  if (!/^[\p{Script=Han}]{2,5}$/u.test(title)) {
    throw new Error('Hermes short title must be 2 to 5 Chinese characters.');
  }
  return title;
};

const fallbackShowcaseShortTitle = (title: string, brief: string, html: string) => {
  const sample = `${title} ${brief} ${htmlSummary(html)}`;
  if (/(计算器|算术|数学)/i.test(sample)) {
    return /(发声|语音|朗读|播报|声音)/i.test(sample) ? '发声计算器' : '计算器';
  }
  if (/(贪吃蛇|snake)/i.test(sample)) return '贪吃蛇';
  if (/(画板|绘画|涂鸦|drawing|paint)/i.test(sample)) return '小画板';
  if (/(打地鼠|反应|对战|点击|闯关|游戏|game|reaction|battle|tap|click)/i.test(sample)) return '反应挑战';
  if (/(音乐|钢琴|music)/i.test(sample)) return '音乐盒';
  if (/(计时|倒计时|timer|时钟)/i.test(sample)) return '计时器';
  if (/(相机|camera|拍照)/i.test(sample)) return '拍照机';
  if (/(聊天|对话|chat)/i.test(sample)) return '聊天助手';
  return '互动作品';
};

export const summarizeShowcaseTitleWithHermes = async ({
  title,
  brief = '',
  html = '',
}: {
  title: string;
  brief?: string;
  html?: string;
}): Promise<ShowcaseShortTitleResult> => {
  const startedAt = Date.now();
  const settings = await readCreateTheatreAdminSettings();
  const candidateModes: CreateTheatreModelMode[] = [
    settings.modelMode,
    ...createTheatreModelModes.filter((mode) => mode !== settings.modelMode),
  ];
  const seen = new Set<string>();
  const candidates = candidateModes.flatMap((mode) => {
    const runtime = resolveCreateTheatreRuntimeModelConfig(mode, settings.hermesProfiles[mode]);
    if (!runtime.baseUrl || !runtime.model || !runtime.apiKey) return [];
    const fingerprint = createHash('sha256').update([runtime.baseUrl, runtime.model, runtime.apiKey].join('\n')).digest('hex').slice(0, 16);
    if (seen.has(fingerprint)) return [];
    seen.add(fingerprint);
    return [{ mode, runtime, fingerprint }];
  }).slice(0, createTheatreModelModes.length);
  const fallback = fallbackShowcaseShortTitle(title, brief, html);
  const failover: ShowcaseShortTitleResult['failover'] = [];
  let lastError = '';
  let fallbackModel = candidates[0]?.runtime.model || 'AIYA';

  for (const candidate of candidates) {
    try {
      const response = await chatWithHermesModel(
        { baseUrl: candidate.runtime.baseUrl, model: candidate.runtime.model, apiKey: candidate.runtime.apiKey },
        [{
          role: 'user',
          content: `你是 AIYA 的应用命名助手。请理解应用功能后，为优秀作品生成一个简洁、准确、适合儿童阅读的展示名称。\n\n原始名称：${title.slice(0, 80)}\n功能说明：${brief.slice(0, 400) || '未提供'}\n页面可见内容：${htmlSummary(html) || '未提供'}\n\n严格规则：\n1. 名称必须是 2 到 5 个汉字；\n2. 必须重新概括功能，不能机械截断原始名称；\n3. 不要使用“AIYA”“作品”“应用”等泛化词，除非功能无法判断；\n4. 例如“快速发声儿童计算器”可命名为“儿童计算器”或“发声计算器”；\n5. 只返回一行 JSON，不要 Markdown 或解释：{"name":"发声计算器"}`,
        }],
        { temperature: 0.1, maxTokens: 80, timeoutMs: 35_000 },
      );
      const shortTitle = parseShowcaseShortTitle(response.content);
      failover.push({
        mode: candidate.mode,
        model: candidate.runtime.model,
        configFingerprint: candidate.fingerprint,
        status: 'succeeded',
      });
      return {
        source: 'hermes',
        title: shortTitle,
        model: response.model,
        modelMode: candidate.mode,
        durationMs: Date.now() - startedAt,
        failover,
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'Hermes showcase title generation failed.';
      fallbackModel = candidate.runtime.model;
      failover.push({
        mode: candidate.mode,
        model: candidate.runtime.model,
        configFingerprint: candidate.fingerprint,
        status: 'failed',
        error: lastError,
      });
    }
  }

  return {
    source: 'fallback',
    title: fallback,
    model: fallbackModel,
    modelMode: settings.modelMode,
    durationMs: Date.now() - startedAt,
    failover,
    ...(lastError ? { error: lastError } : {}),
  };
};

const brandBadgeAndroid = `
    <path android:fillColor="#FFFFFFFF" android:pathData="M37,74 H95 C98.3,74 101,76.7 101,80 V95 C101,98.3 98.3,101 95,101 H37 C33.7,101 31,98.3 31,95 V80 C31,76.7 33.7,74 37,74 Z" />
    <path android:fillColor="#FF00A97A" android:pathData="M38,97 L43,81 H47 L42,97 Z M47,81 H51 L56,97 H52 L47,81 Z M42,90 H52 V93 H42 Z M59,81 H63 V97 H59 Z M66,81 H70 L73,87 L76,81 H80 L75,92 V97 H71 V92 Z M82,97 L87,81 H91 L86,97 Z M91,81 H95 L100,97 H96 L91,81 Z M86,90 H96 V93 H86 Z" />`;

const brandBadgeSvg = `
  <path fill="#fff" d="M37 74H95C98.3 74 101 76.7 101 80V95C101 98.3 98.3 101 95 101H37C33.7 101 31 98.3 31 95V80C31 76.7 33.7 74 37 74Z"/>
  <path fill="#00A97A" d="M38 97L43 81H47L42 97ZM47 81H51L56 97H52L47 81ZM42 90H52V93H42ZM59 81H63V97H59ZM66 81H70L73 87L76 81H80L75 92V97H71V92ZM82 97L87 81H91L86 97ZM91 81H95L100 97H96L91 81ZM86 90H96V93H86Z"/>`;

export const renderAndroidVectorIcon = (design: AppIconDesign) => {
  const colors = paletteColors[design.palette];
  const paths = glyphs[design.symbol].map((path) => {
    const fill = path.fill === 'surface' ? '#FFFFFFFF' : path.fill === 'accent' ? colors.accent : colors.highlight;
    return `        <path android:fillColor="${fill}" android:pathData="${path.data}" />`;
  }).join('\n');
  return `<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <path android:fillColor="${colors.background}" android:pathData="M20,4 H88 C96.8,4 104,11.2 104,20 V88 C104,96.8 96.8,104 88,104 H20 C11.2,104 4,96.8 4,88 V20 C4,11.2 11.2,4 20,4 Z" />
    <path android:fillColor="${colors.highlight}" android:fillAlpha="0.22" android:pathData="M61,4 H88 C96.8,4 104,11.2 104,20 V56 C88,42 75,24 61,4 Z" />
    <group android:scaleX="2.4" android:scaleY="2.4" android:translateX="25.2" android:translateY="8">
${paths}
    </group>${brandBadgeAndroid}
</vector>
`;
};

export const renderAppIconPreviewSvg = (design: AppIconDesign) => {
  const colors = paletteColors[design.palette];
  const paths = glyphs[design.symbol].map((path) => {
    const fill = path.fill === 'surface' ? '#fff' : path.fill === 'accent' ? colors.accent : colors.highlight;
    return `    <path fill="${fill}" d="${path.data}"/>`;
  }).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 108 108">
  <path fill="${colors.background}" d="M20 4H88C96.8 4 104 11.2 104 20V88C104 96.8 96.8 104 88 104H20C11.2 104 4 96.8 4 88V20C4 11.2 11.2 4 20 4Z"/>
  <path fill="${colors.highlight}" opacity=".22" d="M61 4H88C96.8 4 104 11.2 104 20V56C88 42 75 24 61 4Z"/>
  <g transform="translate(25.2 8) scale(2.4)">
${paths}
  </g>${brandBadgeSvg}
</svg>`;
};

export const designAppIconWithHermes = async ({
  title,
  brief = '',
  html = '',
}: {
  title: string;
  brief?: string;
  html?: string;
}): Promise<AppIconResult> => {
  const startedAt = Date.now();
  const settings = await readCreateTheatreAdminSettings();
  let modelMode = settings.modelMode;
  const candidateModes: CreateTheatreModelMode[] = [
    settings.modelMode,
    ...createTheatreModelModes.filter((mode) => mode !== settings.modelMode),
  ];
  const seen = new Set<string>();
  const candidates = candidateModes.flatMap((mode) => {
    const candidateRuntime = resolveCreateTheatreRuntimeModelConfig(mode, settings.hermesProfiles[mode]);
    if (!candidateRuntime.baseUrl || !candidateRuntime.model || !candidateRuntime.apiKey) return [];
    const fingerprint = createHash('sha256').update([
      candidateRuntime.baseUrl,
      candidateRuntime.model,
      candidateRuntime.apiKey,
    ].join('\n')).digest('hex').slice(0, 16);
    if (seen.has(fingerprint)) return [];
    seen.add(fingerprint);
    return [{ mode, runtime: candidateRuntime, fingerprint }];
  }).slice(0, createTheatreModelModes.length);
  let runtime = candidates[0]?.runtime || resolveCreateTheatreRuntimeModelConfig(
    settings.modelMode,
    settings.hermesProfiles[settings.modelMode],
  );
  const fallback = fallbackDesign(title, brief, html);
  let design = fallback;
  let source: AppIconResult['source'] = 'fallback';
  let model = runtime.model;
  let error = '';
  const failover: AppIconResult['failover'] = [];

  for (const candidate of candidates) {
    runtime = candidate.runtime;
    modelMode = candidate.mode;
    try {
    if (!runtime.baseUrl || !runtime.model) throw new Error('Hermes 模型尚未配置');
    const prompt = `你是 AIYA 的移动应用图标设计器。请根据作品内容选择最准确、最容易识别的桌面图标语义和配色。

作品标题：${title.slice(0, 80)}
用户说明：${brief.slice(0, 500) || '未提供'}
页面可见内容：${htmlSummary(html) || '未提供'}

可用图形（只能选一个）：${appIconSymbols.join(', ')}
可用配色（只能选一个）：${appIconPalettes.join(', ')}

规则：
1. 图形必须直接表达应用用途，例如贪吃蛇选 snake、计算器选 calculator。
2. 优先高辨识度、高对比度，不要选择与用途无关的通用图形。
3. 不要在语义图形里加入文字，服务端会固定叠加 AIYA 品牌标识。
4. 只返回一行 JSON，不要 Markdown，不要解释。

格式：{"symbol":"snake","palette":"mint","concept":"绿色贪吃蛇游戏图标"}`;
    const response = await chatWithHermesModel(
      { baseUrl: runtime.baseUrl, model: runtime.model, apiKey: runtime.apiKey },
      [{ role: 'user', content: prompt }],
      { temperature: 0.2, maxTokens: 160, timeoutMs: 45_000 },
    );
    design = parseModelJson(response.content);
    source = 'hermes';
    model = response.model;
      error = '';
      failover.push({
        mode: candidate.mode,
        model: runtime.model,
        configFingerprint: candidate.fingerprint,
        status: 'succeeded',
      });
      break;
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'Hermes 图标设计失败';
      failover.push({
        mode: candidate.mode,
        model: runtime.model,
        configFingerprint: candidate.fingerprint,
        status: 'failed',
        error,
      });
    }
  }

  return {
    source,
    model,
    modelMode,
    durationMs: Date.now() - startedAt,
    design,
    vectorXml: renderAndroidVectorIcon(design),
    previewSvg: renderAppIconPreviewSvg(design),
    brand: 'AIYA',
    failover,
    ...(error ? { error } : {}),
  };
};
