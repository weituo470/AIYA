import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const code = readFileSync(new URL('../app/src/main/java/cc/shenliu/aiya/v3/MainActivity.kt', import.meta.url), 'utf8');
for (const id of ['speed', 'auto', 'quality']) assert(code.includes(`("${id}",`), 'Missing preference ' + id);
for (const text of ['.put("buildPreference", buildPreference.id)', '.put("modelSelectionMode", if (manualModel) "manual" else "auto")', '.put("buildPreferenceId", request.buildPreferenceId)', '.put("manualModel", request.manualModel)', 'buildPreference = BuildPreference.fromId(request.buildPreferenceId)', 'manualModel = request.manualModel', 'manualModel = json.optBoolean("manualModel", true)', '.put("buildExecutionJson", work.buildExecutionJson)', 'id = result.optString("id", "")']) assert(code.includes(text), 'Missing snapshot/recovery field: ' + text);
// Build strategy fields remain for old pending tasks, but the creation UI now selects a concrete model.
assert(code.includes('buildPreferenceId = BuildPreference.Auto.id'));
assert(code.includes('manualModel = true'));
assert(!code.includes('selectedBuildPreference'));
assert(!code.includes('onBuildPreferenceSelected'));
console.log('PASS Android legacy preference IDs, request snapshot/recovery compatibility, explicit new-task model selection and artifact metadata. Not a real-device UI test.');
