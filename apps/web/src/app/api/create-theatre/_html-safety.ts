import { parse as parseHtml } from 'parse5';
import { parse as parseJs } from 'acorn';

export type SafetyViolation = { rule: string; context: string };
/** Structural guard, not a claim that arbitrary JavaScript is safe. Runtime is isolated too. */
export function inspectGeneratedHtml(html: string, options: { sandboxUi?: boolean } = {}): SafetyViolation[] {
  const violations: SafetyViolation[] = [];
  const add = (rule: string, context: string) => { if (violations.length < 12) violations.push({ rule, context: context.slice(0, 220) }); };
  const forbidden = new Set(['fetch', 'XMLHttpRequest', 'WebSocket', 'localStorage', 'sessionStorage', 'indexedDB']);
  const inspectScript = (code: string) => {
    let ast: any;
    try { ast = parseJs(code, { ecmaVersion: 'latest', allowReturnOutsideFunction: true }); }
    catch { add('invalid-javascript', '脚本无法解析'); return; }
    const visit = (node: any) => {
      if (!node || typeof node !== 'object') return;
      if (options.sandboxUi && node.type === 'CallExpression') {
        const callee = node.callee;
        const name = callee?.type === 'Identifier' ? callee.name
          : callee?.type === 'MemberExpression' && ['window', 'globalThis', 'self'].includes(callee.object?.name)
            ? callee.computed && callee.property?.type === 'Literal' ? callee.property.value : callee.property?.name
            : null;
        if (['alert', 'confirm', 'prompt', 'print'].includes(name)) add('sandbox-native-dialog', code.slice(node.start, node.end));
      }
      if (node.type === 'Identifier' && forbidden.has(node.name)) add(`forbidden-api:${node.name}`, code.slice(Math.max(0, node.start - 35), node.end + 45));
      if (node.type === 'MemberExpression') {
        const name = node.computed && node.property.type === 'Literal' ? node.property.value : node.property?.name;
        if (forbidden.has(name) || name === 'cookie' && node.object?.name === 'document') add(`forbidden-member:${name}`, code.slice(node.start, node.end + 45));
      }
      if (node.type === 'Literal' && typeof node.value === 'string' && /https?:\/\//i.test(node.value) && !/^https?:\/\/www\.w3\.org\/2000\/svg$/.test(node.value)) add('external-url', node.value);
      for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === 'object') visit(value);
    };
    visit(ast);
  };
  const visit = (node: any) => {
    const tag = node.tagName;
    const attrs: Record<string, string> = Object.fromEntries((node.attrs || []).map((a: any) => [a.name.toLowerCase(), a.value]));
    if (options.sandboxUi && tag === 'form') add('sandbox-native-form', 'Use a div with explicit button click and input keydown handlers; native form submission is blocked.');
    if (['iframe', 'object', 'embed', 'base'].includes(tag)) add(`forbidden-element:${tag}`, `<${tag}>`);
    if (tag === 'script' && 'src' in attrs || tag === 'link' && 'href' in attrs) add('external-resource-element', `<${tag}>`);
    if (tag === 'meta' && attrs['http-equiv']?.toLowerCase() === 'refresh') add('meta-redirect', attrs.content || '');
    for (const [name, value] of Object.entries(attrs)) {
      if (['src', 'href', 'action', 'formaction', 'poster', 'srcset'].includes(name) && /^(?:\s*(?:https?:|\/\/|javascript:|vbscript:|file:))|https?:\/\//i.test(value)) add('external-or-active-attribute', `${tag}.${name}=${value}`);
      if (name.startsWith('on')) inspectScript(value);
      if (name === 'style' && /@import|url\s*\(\s*['"]?(?:https?:|\/\/|file:)/i.test(value)) add('external-css', value);
    }
    if (tag === 'script' && !attrs.type?.includes('json')) inspectScript((node.childNodes || []).map((n: any) => n.value || '').join(''));
    if (tag === 'style') {
      // Comments are not loaded resources; do not reject a comment explaining a forbidden API.
      const css = (node.childNodes || []).map((n: any) => n.value || '').join('').replace(/\/\*[\s\S]*?\*\//g, '');
      if (/@import|url\s*\(\s*['"]?(?:https?:|\/\/|file:)/i.test(css)) add('external-css', css.slice(0, 180));
    }
    (node.childNodes || []).forEach(visit);
    if (node.content) visit(node.content);
  };
  visit(parseHtml(html));
  return violations;
}
