import catalog from './golden-key.json';

export const goldenKeyExamples = catalog.examples;
export type GoldenKeyExample = typeof goldenKeyExamples[number];
export type GoldenKeyUpgrade = GoldenKeyExample['upgrades'][number];
export type GoldenKeyContext = { exampleId: string; upgradeId?: string };
export type GoldenKeyLineage = { exampleId: string; completedUpgradeIds: string[] };
export type GoldenKeyUpgradeDraft = GoldenKeyContext & { targetHtml: string; title: string };

type App = { title?: string; html?: string; goldenKey?: GoldenKeyLineage };

// Older works have no lineage. Only recognize a full, unique sample name, never a fuzzy category.
export function resolveGoldenKeyExample(app: App | null | undefined) {
  if (!app?.html) return undefined;
  if (app.goldenKey) return goldenKeyExamples.find(item => item.id === app.goldenKey?.exampleId);
  const matches = goldenKeyExamples.filter(item => (app.title || '').replace(/\s/g, '').includes(item.title));
  return matches.length === 1 ? matches[0] : undefined;
}

// Completion means the generation returned successfully, not that the user accepted its quality.
export function completedGoldenKeyLineage(app: App | null, context?: GoldenKeyContext): GoldenKeyLineage | undefined {
  const example = context ? goldenKeyExamples.find(item => item.id === context.exampleId) : resolveGoldenKeyExample(app);
  if (!example) return undefined;
  const completed = app?.goldenKey?.exampleId === example.id ? app.goldenKey.completedUpgradeIds : [];
  const upgrade = example.upgrades.find(item => item.id === context?.upgradeId);
  return { exampleId: example.id, completedUpgradeIds: [...new Set([...completed, ...(upgrade ? [upgrade.id] : [])])] };
}
