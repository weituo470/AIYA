import assert from 'node:assert/strict';
import { completedGoldenKeyLineage, resolveGoldenKeyExample, goldenKeyExamples } from '../src/app/_shared/golden-key-flow';
assert.equal(resolveGoldenKeyExample(null), undefined);
assert.equal(resolveGoldenKeyExample({ title: '光绘工坊' }), undefined, 'No upgrade before a generated work exists');
assert.equal(resolveGoldenKeyExample({ title: '普通画板', html: 'x' }), undefined, 'No fuzzy theme match');
assert.equal(resolveGoldenKeyExample({ title: '光绘工坊 第1版', html: 'x' })?.id, 'light-drawing', 'Old sample recognized');
assert.equal(resolveGoldenKeyExample({ title: '光绘工坊声音花园', html: 'x' }), undefined, 'Ambiguous names not auto-associated');
for (const example of goldenKeyExamples) {
  const first = completedGoldenKeyLineage(null, { exampleId: example.id });
  assert.deepEqual(first, { exampleId: example.id, completedUpgradeIds: [] });
  const old = { html: 'old', title: example.title, goldenKey: first };
  const revised = completedGoldenKeyLineage(old, { exampleId: example.id, upgradeId: example.upgrades[0].id });
  assert.deepEqual(revised?.completedUpgradeIds, [example.upgrades[0].id]);
  assert.deepEqual(completedGoldenKeyLineage({ ...old, goldenKey: revised }), revised, 'Manual revision preserves lineage');
  assert.deepEqual(completedGoldenKeyLineage({ ...old, goldenKey: revised }, { exampleId: example.id, upgradeId: example.upgrades[0].id }), revised, 'Repeated upgrade is not counted twice');
  assert.deepEqual(completedGoldenKeyLineage({ ...old, goldenKey: revised }, { exampleId: example.id, upgradeId: 'unknown' }), revised);
  assert.equal(resolveGoldenKeyExample({ ...old, title: '自定义名称' })?.id, example.id, 'Lineage survives renaming');
}
assert.equal(completedGoldenKeyLineage(null, { exampleId: 'unknown' }), undefined);
console.log('Golden Key lineage: old works, new works, 6 x 3 upgrades, manual revisions and duplicate completions passed');
