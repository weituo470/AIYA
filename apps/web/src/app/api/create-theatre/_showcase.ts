import { prisma } from '@aiya/database';
import {
  designAppIconWithHermes,
  summarizeShowcaseTitleWithHermes,
  type AppIconDesign,
} from './_hermes-app-icon';

type JsonRecord = Record<string, unknown>;

const record = (value: unknown): JsonRecord => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {}
);

const text = (value: unknown, max: number) => String(value || '').trim().slice(0, max);

export type TheatreShowcaseIcon = {
  source: 'hermes' | 'fallback';
  symbol: AppIconDesign['symbol'];
  palette: AppIconDesign['palette'];
  concept: string;
  generatedAt: string;
};

export type TheatreShowcaseWork = {
  id: string;
  title: string;
  brief: string;
  author: string;
  model: string;
  initialPrompt: string;
  html: string;
  featuredAt: string;
  icon: TheatreShowcaseIcon | null;
};

const readShowcaseIcon = (value: unknown): TheatreShowcaseIcon | null => {
  const icon = record(value);
  const source = icon.source === 'hermes' ? 'hermes' : icon.source === 'fallback' ? 'fallback' : null;
  const symbol = text(icon.symbol, 32) as AppIconDesign['symbol'];
  const palette = text(icon.palette, 32) as AppIconDesign['palette'];
  if (!source || !symbol || !palette) return null;
  return {
    source,
    symbol,
    palette,
    concept: text(icon.concept, 100),
    generatedAt: text(icon.generatedAt, 64),
  };
};

const createShowcaseIcon = async (title: string, brief: string, html: string): Promise<TheatreShowcaseIcon> => {
  const generated = await designAppIconWithHermes({ title, brief, html });
  return {
    source: generated.source,
    symbol: generated.design.symbol,
    palette: generated.design.palette,
    concept: text(generated.design.concept, 100),
    generatedAt: new Date().toISOString(),
  };
};

export const readShowcaseMeta = (value: unknown) => {
  const showcase = record(record(value).showcase);
  return {
    enabled: showcase.enabled === true,
    title: text(showcase.title, 80),
    brief: text(showcase.brief, 220),
    author: text(showcase.author, 80),
    shortTitle: text(showcase.shortTitle, 10),
    initialPrompt: text(showcase.initialPrompt, 2_000),
    featuredAt: text(showcase.featuredAt, 64),
    icon: readShowcaseIcon(showcase.icon),
  };
};

export async function setTheatreTaskShowcase(taskId: string, enabled: boolean) {
  const task = await prisma.theatreTask.findUnique({ where: { id: taskId } });
  if (!task) throw new Error('任务不存在。');
  if (task.status !== 'succeeded') throw new Error('只有已成功完成的任务可以设为展示作品。');

  const result = record(task.result);
  if (!text(result.html, 1)) throw new Error('该任务没有可展示的作品内容。');
  const previous = readShowcaseMeta(result);
  const title = previous.title || text(result.title, 80) || 'AIYA 作品';
  const brief = previous.brief || text(result.brief, 220);
  const shortTitle = enabled
    ? await summarizeShowcaseTitleWithHermes({ title, brief, html: text(result.html, 500_000) })
    : null;
  const icon = enabled
    ? await createShowcaseIcon(title, brief, text(result.html, 500_000))
    : previous.icon;
  const nextResult = {
    ...result,
    showcase: {
      enabled,
      title,
      brief,
      author: previous.author || 'AIYA 创作者',
      shortTitle: shortTitle?.title || previous.shortTitle || title,
      initialPrompt: previous.initialPrompt || text(task.idea, 2_000),
      ...(shortTitle ? {
        shortTitleSource: shortTitle.source,
        shortTitleModel: shortTitle.model,
        shortTitleGeneratedAt: new Date().toISOString(),
      } : {}),
      featuredAt: enabled ? new Date().toISOString() : previous.featuredAt,
      ...(icon ? { icon } : {}),
    },
  };
  await prisma.theatreTask.update({
    where: { id: task.id },
    data: { result: nextResult as any },
  });
  return task.id;
}

export async function refreshTheatreShowcaseShortTitles(limit = 60) {
  const tasks = await prisma.theatreTask.findMany({
    where: { status: 'succeeded' },
    orderBy: { updatedAt: 'desc' },
    take: Math.max(1, Math.min(limit, 200)),
    select: { id: true, result: true },
  });
  const updated: Array<{ id: string; title: string; source: 'hermes' | 'fallback'; model: string }> = [];
  const skipped: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];

  for (const task of tasks) {
    const result = record(task.result);
    const meta = readShowcaseMeta(result);
    const html = text(result.html, 500_000);
    if (!meta.enabled || !html) {
      skipped.push(task.id);
      continue;
    }
    try {
      const title = meta.title || text(result.title, 80) || 'AIYA 作品';
      const brief = meta.brief || text(result.brief, 220);
      const shortTitle = await summarizeShowcaseTitleWithHermes({ title, brief, html });
      const showcase = record(result.showcase);
      await prisma.theatreTask.update({
        where: { id: task.id },
        data: {
          result: {
            ...result,
            showcase: {
              ...showcase,
              shortTitle: shortTitle.title,
              shortTitleSource: shortTitle.source,
              shortTitleModel: shortTitle.model,
              shortTitleGeneratedAt: new Date().toISOString(),
            },
          } as any,
        },
      });
      updated.push({
        id: task.id,
        title: shortTitle.title,
        source: shortTitle.source,
        model: shortTitle.model,
      });
    } catch (error) {
      failed.push({
        id: task.id,
        error: (error instanceof Error ? error.message : 'Showcase short title generation failed.').slice(0, 220),
      });
    }
  }

  return { updated, skipped, failed };
}

export async function listTheatreShowcaseWorks(limit = 30): Promise<TheatreShowcaseWork[]> {
  const tasks = await prisma.theatreTask.findMany({
    where: { status: 'succeeded' },
    orderBy: { updatedAt: 'desc' },
    take: 500,
    select: {
      id: true,
      result: true,
      userName: true,
      model: true,
      provider: true,
      idea: true,
      finishedAt: true,
      updatedAt: true,
    },
  });
  return tasks.flatMap((task) => {
    const result = record(task.result);
    const meta = readShowcaseMeta(result);
    const taskAuthor = text(task.userName, 80);
    if (taskAuthor) meta.author = taskAuthor;
    const html = text(result.html, 500_000);
    if (!meta.enabled || !html) return [];
    return [{
      id: task.id,
      title: meta.shortTitle || meta.title || text(result.title, 80) || 'AIYA 作品',
      brief: meta.brief || text(result.brief, 220) || '一件由 AIYA 创作的互动作品。',
      author: meta.author || 'AIYA 创作者',
      model: text(task.model, 200) || text(task.provider, 80) || 'AIYA',
      initialPrompt: meta.initialPrompt || text(task.idea, 2_000),
      html,
      featuredAt: meta.featuredAt || (task.finishedAt || task.updatedAt).toISOString(),
      icon: meta.icon,
    }];
  }).slice(0, Math.max(1, Math.min(limit, 60)));
}
