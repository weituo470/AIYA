import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../app/src/main/java/cc/shenliu/aiya/v3/MainActivity.kt', import.meta.url), 'utf8');
const start = source.indexOf('fun GeneratedWorkWebView(');
const end = source.indexOf('private data class WebViewRuntimeState', start);
const preview = source.slice(start, end);
assert.ok(start >= 0 && end > start);
assert.match(preview, /remember\(html\) \{ prepareGeneratedPreview\(html, ::prepareGeneratedHtmlForWebView\) \}/);
assert.ok(preview.indexOf('if (preparedHtml == null)') < preview.indexOf('AndroidView('));
assert.match(preview, /loadDataWithBaseURL\([^\n]+preparedHtml/);
assert.doesNotMatch(preview, /loadDataWithBaseURL\([^\n]+prepareGeneratedHtml/);
const fallback = preview.slice(preview.indexOf('if (preparedHtml == null)'), preview.indexOf('val context = LocalContext.current'));
assert.match(fallback, /return/);
assert.match(fallback, /verticalScroll\(rememberScrollState\(\)\)/);
for (const text of fallback.matchAll(/Text\([^\n]+/g)) {
  assert.match(text[0], /fontSize = (?:18|22)\.sp/);
  assert.match(text[0], /lineHeight = 32\.sp/);
  assert.doesNotMatch(text[0], /(?:fontSize|lineHeight)\s*=\s*(?:[0-9]|1[0-5])\.sp/);
}
console.log('PASS: preview is validated before WebView creation; rejected works use readable, scrollable native UI. Static contract only, not real-device proof.');
