import { chromium } from 'playwright';

const pageUrl = process.env.AIYA_DEV_WEB_URL || 'http://127.0.0.1:3333/dev';
const pollutedCodexOutputPattern = /Project:\s|Terminal tab title|Current status|Current task|Blocker:|Next step:|Ran\s+\$pwd\.Path|Worked for/i;
const cases = [
  { provider: 'Claude Code', button: /Claude Code/, prompt: 'Reply with exactly KIWI', expected: 'KIWI', bootMs: 8000, waitRounds: 18 },
  { provider: 'Codex CLI', button: /Codex CLI/, prompt: 'Reply with exactly BANANA', expected: 'BANANA', bootMs: 10000, waitRounds: 24, forbid: pollutedCodexOutputPattern },
  { provider: 'Codex CLI hello', button: /Codex CLI/, prompt: '你好，只回复“你好”。', expected: '你好', bootMs: 10000, waitRounds: 24, forbid: pollutedCodexOutputPattern },
];

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function afterLastPrompt(text, prompt) {
  const index = text.lastIndexOf(prompt);
  return index >= 0 ? text.slice(index + prompt.length) : '';
}

async function runCase(testCase) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1394, height: 1000 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error?.message || error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await wait(2000);
  await page.getByRole('button', { name: testCase.button }).first().click();
  await page.getByRole('button', { name: '新建 session' }).click();
  await wait(testCase.bootMs);
  await page.locator('.xterm').first().click({ position: { x: 35, y: 520 } });
  await page.keyboard.type(testCase.prompt, { delay: 20 });
  await page.keyboard.press('Enter');

  let text = '';
  let afterPrompt = '';
  for (let round = 0; round < testCase.waitRounds; round += 1) {
    await wait(10000);
    text = await page.locator('body').innerText();
    afterPrompt = afterLastPrompt(text, testCase.prompt);
    if (afterPrompt.includes(testCase.expected) || /401|Unauthorized|not logged in|failed|error|rate limit|quota|Run \/login/i.test(afterPrompt)) break;
  }
  await browser.close();

  const fatalPattern = /401|Unauthorized|not logged in|failed|error|rate limit|quota|Run \/login/i;
  const forbiddenPattern = testCase.forbid || /$a/;
  const passed = errors.length === 0
    && afterPrompt.includes(testCase.expected)
    && !fatalPattern.test(afterPrompt)
    && !forbiddenPattern.test(afterPrompt);
  return {
    provider: testCase.provider,
    passed,
    expected: testCase.expected,
    gotExpectedAfterPrompt: afterPrompt.includes(testCase.expected),
    hasForbiddenOutput: forbiddenPattern.test(afterPrompt),
    errors,
    afterPrompt: afterPrompt.replace(/\s+/g, ' ').trim().slice(0, 500),
  };
}

const results = [];
for (const testCase of cases) {
  try {
    results.push(await runCase(testCase));
  } catch (error) {
    results.push({ provider: testCase.provider, passed: false, error: String(error?.stack || error) });
  }
}
const passed = results.every((result) => result.passed);
console.log(JSON.stringify({ pageUrl, passed, results }, null, 2));
if (!passed) process.exit(1);
