import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Source-contract regression check; Gradle compilation and device QA complement it.
const source = readFileSync(new URL('../app/src/main/java/cc/shenliu/aiya/v3/MainActivity.kt', import.meta.url), 'utf8');
const block = source.split('private enum class GenerationModelMode(')[1]?.split('private enum class BuildPreference')[0]?.split('private data class TeacherProfile')[0];
assert.ok(block, 'Model enum exists');
const options = [...block.matchAll(/^\s+(\w+)\("([^"]+)", "([^"]+)"/gm)]
  .map(([, name, id, label]) => ({ name, id, label }));
assert.deepEqual(options, [
  { name: 'Default', id: 'default', label: 'DeepSeek V4.1 Flash' },
  { name: 'Quality', id: 'quality', label: 'GPT-6 Astra · High' },
  { name: 'Fusion', id: 'fusion', label: 'Fusion Max 2.0（实验）' },
]);
assert.match(block, /when \(id\)\s*\{\s*"quality" -> Quality\s*"fusion" -> Fusion\s*else -> Default\s*\}/);
assert.doesNotMatch(source, /GenerationModelMode\.Fast/);
assert.match(source, /GenerationModelMode\.entries\.forEach/);
assert.match(source, /GenerationModelMode\.fromId\(appPreferences\.getString\(PREF_MODEL_MODE, null\)\)/);
assert.match(source, /modelMode = GenerationModelMode\.fromId\(request\.modelModeId\)/);
assert.match(source, /\.put\("modelMode", modelMode\.id\)/);
assert.match(source, /Text\(mode\.description,[^\n]*fontSize = 16\.sp, lineHeight = 24\.sp\)/);
assert.match(block, /Default\("default", "DeepSeek V4\.1 Flash", "deepseek-flash"/);
assert.match(block, /Quality\("quality", "GPT-6 Astra · High", "gpt-6-astra"/);
assert.match(block, /Fusion\("fusion", "Fusion Max 2\.0（实验）", "fusion-max-2\.0"/);
assert.match(block, /生成和继续修改可能超时/);
assert.match(source, /Text\(mode\.modelId,[^\n]*fontSize = 16\.sp, lineHeight = 24\.sp\)/);
assert.match(source, /Text\(mode\.label, modifier = Modifier\.weight\(1f\)/);
const inlineSelector = source.split('Text("模型选择",')[1]?.split('OutlinedTextField(')[0];
assert.ok(inlineSelector, 'Visible inline model selector exists');
assert.match(inlineSelector, /GenerationModelMode\.entries\.forEach \{ mode ->/);
assert.match(inlineSelector, /onClick = \{ onModelModeSelected\(mode\) \}/);
assert.match(inlineSelector, /enabled = !isGenerating/);
assert.match(inlineSelector, /mode == selectedModelMode/);
assert.match(inlineSelector, /height\(IntrinsicSize\.Min\)/);
assert.match(inlineSelector, /heightIn\(min = 88\.dp\)\.fillMaxHeight\(\)/);
assert.match(inlineSelector, /Text\(mode\.label, fontSize = 16\.sp, lineHeight = 24\.sp, textAlign = TextAlign\.Center/);
assert.doesNotMatch(inlineSelector, /maxLines|TextOverflow\.Ellipsis|fontSize = 1[0-5]\.sp/);
assert.match(inlineSelector, /selectedModelMode\.modelId/);
assert.doesNotMatch(source, /Text\("生成偏好"|BuildPreference\.entries\.forEach|onBuildPreferenceSelected/);
const enqueue = source.split('fun generateWork(requestIdea: String) {')[1]?.split('fun startVoiceInputNow()')[0];
assert.ok(enqueue);
assert.match(enqueue, /val requestModelMode = selectedModelMode/);
assert.match(enqueue, /modelModeId = requestModelMode\.id/);
assert.match(enqueue, /buildPreferenceId = BuildPreference\.Auto\.id/);
assert.match(enqueue, /manualModel = true/);
assert.match(source, /if \(mode != GenerationModelMode\.Fusion\)/);
assert.match(source, /runCatching \{ isFusionConfiguredOnServer\(\) \}/);
assert.match(source, /val selectionRequestId = \+\+modelSelectionRequestId/);
assert.match(source, /if \(selectionRequestId != modelSelectionRequestId\) return@post/);
assert.match(enqueue, /modelSelectionRequestId \+= 1/);
assert.match(source, /Fusion 服务端尚未开放，当前模型未改变/);
const availability = source.split('private fun isFusionConfiguredOnServer(): Boolean {')[1]?.split('private fun fetchClassroomRuntimeSettings')[0];
assert.ok(availability);
assert.match(availability, /requestMethod = "GET"/);
assert.match(availability, /connectTimeout = 8_000/);
assert.match(availability, /readTimeout = 8_000/);
assert.match(availability, /option\?\.optString\("mode"\) == "fusion" && option\.optString\("model"\) == "fusion-max-2.0" && option\.optBoolean\("configured"\)/);
assert.doesNotMatch(source, /api\.fumolab\.ai|console\.cloudsway\.net|sk-[A-Za-z0-9_-]{20,}/);
console.log('PASS: three named models; legacy fast/null/unknown -> default; quality/Fusion retained; saved preference and pending request normalization; request mode; readable model description; no provider credential in client source.');
