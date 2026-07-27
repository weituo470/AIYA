import crypto from 'node:crypto';

const DEFAULT_TIMEOUT_MS = 180_000;
const sessionTurns = new Map();

export async function handleCodexDeepPraxisResponses(request, reply, config) {
  const body = request.body || {};
  const model = body.model || 'qwen3.7-max';
  const apiKey = deepPraxisApiKey(config);
  if (!apiKey) {
    return reply.code(500).send({ error: { message: 'DeepPraxis API key is not configured', type: 'configuration_error' } });
  }

  const responseId = `resp_${crypto.randomUUID().replaceAll('-', '')}`;
  const sessionKey = request.headers['session-id'] || request.headers['x-client-request-id'] || responseId;
  const turnCount = (sessionTurns.get(sessionKey) || 0) + 1;
  sessionTurns.set(sessionKey, turnCount);
  cleanupSessionTurns();
  const maxTurns = Number.parseInt(process.env.AIYA_CODEX_DEEPPRAXIS_MAX_TOOL_TURNS || '12', 10);
  if (turnCount > maxTurns) {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    writeResponseStream(reply.raw, {
      responseId,
      model,
      message: { role: 'assistant', content: 'DONE' },
      started: Date.now(),
    });
    reply.raw.end();
    return;
  }
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number.parseInt(process.env.AIYA_CODEX_DEEPPRAXIS_ADAPTER_TIMEOUT_MS || String(DEFAULT_TIMEOUT_MS), 10));

  try {
    const chatPayload = {
      model,
      messages: toChatMessages(body),
      tools: toChatTools(body.tools || []),
      tool_choice: body.tool_choice || 'auto',
      temperature: typeof body.temperature === 'number' ? body.temperature : 0,
      max_tokens: Number.parseInt(process.env.AIYA_CODEX_DEEPPRAXIS_MAX_TOKENS || '4096', 10),
      stream: false,
    };
    if (!chatPayload.tools.length) delete chatPayload.tools;

    const upstream = await fetch(`${trimTrailingSlash(config.codexDeepPraxisUpstreamBaseUrl || 'https://api.deepraxis.ai/openai/v1')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(chatPayload),
      signal: controller.signal,
    });
    const text = await upstream.text();
    if (!upstream.ok) {
      return reply.code(upstream.status).send({
        error: {
          message: `DeepPraxis chat/completions failed: ${text.slice(0, 1000)}`,
          type: 'upstream_error',
        },
      });
    }

    const data = safeJson(text);
    const message = data?.choices?.[0]?.message || {};
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    writeResponseStream(reply.raw, { responseId, model, message, started });
    reply.raw.end();
  } catch (error) {
    const status = error?.name === 'AbortError' ? 504 : 500;
    return reply.code(status).send({
      error: {
        message: error?.name === 'AbortError' ? 'DeepPraxis adapter request timed out' : (error?.message || 'DeepPraxis adapter failed'),
        type: error?.name === 'AbortError' ? 'timeout' : 'adapter_error',
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

function cleanupSessionTurns() {
  if (sessionTurns.size < 200) return;
  for (const key of sessionTurns.keys()) {
    sessionTurns.delete(key);
    if (sessionTurns.size < 120) break;
  }
}

export function codexDeepPraxisAdapterHealth(config) {
  return {
    baseUrl: `http://127.0.0.1:${config.port}/codex-deepraxis/v1`,
    upstreamBaseUrl: config.codexDeepPraxisUpstreamBaseUrl || 'https://api.deepraxis.ai/openai/v1',
    configured: Boolean(deepPraxisApiKey(config)),
    mode: 'responses-to-chat-tool-adapter',
  };
}

function toChatMessages(body) {
  const messages = [{
    role: 'system',
    content: [
      'You are the implementation model behind Codex CLI for AIYA Create.',
      'This is a small local blank Vite/React/TypeScript workspace. Your job is to edit files for the current ProductSpec, then stop.',
      'Use shell_command when you need to read or write files. Prefer Python scripts with encoding="utf-8" for Chinese text.',
      'Stay inside the current app workspace. Do not inspect parent directories. Do not run pnpm install/typecheck/lint/test/build/smoke; the runner validates after you exit.',
      'Do not modify package.json scripts, pnpm-lock.yaml, tests/smoke.spec.ts, tsconfig.json, or vite.config.ts.',
      'Read ProductSpec.md, update src files only, do not reuse unrelated game/tool templates, keep all visible UI Simplified Chinese, and finish with exactly DONE.',
    ].join('\n'),
  }];

  const toolCallsById = new Set();
  const items = compactInputItems(normalizeInputItems(body.input));
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    if (item.type === 'message' || item.role) {
      const role = normalizeRole(item.role);
      const content = contentToText(item.content);
      if (content) messages.push({ role, content });
      continue;
    }
    if (item.type === 'function_call') {
      const callId = item.call_id || item.id || `call_${crypto.randomUUID().slice(0, 8)}`;
      toolCallsById.add(callId);
      messages.push({
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: callId,
          type: 'function',
          function: {
            name: item.name || 'shell_command',
            arguments: typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments || {}),
          },
        }],
      });
      continue;
    }
    if (item.type === 'function_call_output') {
      const callId = item.call_id || item.id || `call_${crypto.randomUUID().slice(0, 8)}`;
      if (!toolCallsById.has(callId)) {
        messages.push({
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: callId,
            type: 'function',
            function: { name: 'shell_command', arguments: '{}' },
          }],
        });
      }
      messages.push({
        role: 'tool',
        tool_call_id: callId,
        content: contentToText(item.output || item.content || ''),
      });
    }
  }

  if (!messages.some((message) => message.role !== 'system')) {
    messages.push({ role: 'user', content: typeof body.input === 'string' ? body.input : 'Continue.' });
  }
  return messages;
}

function toChatTools(tools) {
  return tools
    .filter((tool) => tool && (tool.type === 'function' || tool.name || tool.function))
    .map((tool) => {
      if (tool.function) {
        return {
          type: 'function',
          function: {
            name: tool.function.name,
            description: tool.function.description || '',
            parameters: tool.function.parameters || { type: 'object', properties: {} },
          },
        };
      }
      return {
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description || '',
          parameters: tool.parameters || { type: 'object', properties: {} },
        },
      };
    })
    .filter((tool) => tool.function.name === 'shell_command')
    .filter((tool) => tool.function.name);
}

function compactInputItems(items) {
  const normalized = Array.isArray(items) ? items : [];
  const lastUserIndex = findLastIndex(normalized, (item) => {
    const role = item?.role || (item?.type === 'message' ? item.role : '');
    return role === 'user' && contentToText(item.content).trim();
  });
  const selected = [];
  if (lastUserIndex >= 0) {
    selected.push(normalized[lastUserIndex]);
    selected.push(...normalized.slice(lastUserIndex + 1).filter((item) => item?.type === 'function_call' || item?.type === 'function_call_output').slice(-8));
    return selected;
  }
  return normalized.slice(-10);
}

function findLastIndex(items, predicate) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index], index)) return index;
  }
  return -1;
}

function writeResponseStream(stream, { responseId, model, message, started }) {
  const send = (event, data) => {
    stream.write(`event: ${event}\n`);
    stream.write(`data: ${JSON.stringify(data)}\n\n`);
  };
  const baseResponse = {
    id: responseId,
    object: 'response',
    status: 'in_progress',
    model,
    created_at: Math.floor(started / 1000),
    output: [],
  };
  send('response.created', { type: 'response.created', response: baseResponse });

  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  if (toolCalls.length) {
    const blocked = toolCalls.find((toolCall) => isBlockedToolCall(toolCall));
    if (blocked) {
      const command = extractCommand(toolCalls[0]);
      return writeResponseStream(stream, {
        responseId,
        model,
        message: {
          role: 'assistant',
          content: [
            `Blocked command: ${command.slice(0, 160)}`,
            'Do not run validation, install dependencies, or inspect parent directories.',
            'If edits are complete, reply exactly DONE. Otherwise read ProductSpec.md and edit src files only.',
          ].join('\n'),
        },
        started,
      });
    }
    const output = [];
    toolCalls.forEach((toolCall, index) => {
      const callId = toolCall.id || `call_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;
      const itemId = `fc_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;
      const name = toolCall.function?.name || 'shell_command';
      const args = typeof toolCall.function?.arguments === 'string' ? toolCall.function.arguments : JSON.stringify(toolCall.function?.arguments || {});
      const item = { id: itemId, type: 'function_call', status: 'in_progress', call_id: callId, name, arguments: '' };
      send('response.output_item.added', { type: 'response.output_item.added', output_index: index, item });
      send('response.function_call_arguments.delta', { type: 'response.function_call_arguments.delta', item_id: itemId, output_index: index, delta: args });
      send('response.function_call_arguments.done', { type: 'response.function_call_arguments.done', item_id: itemId, output_index: index, arguments: args });
      const doneItem = { ...item, status: 'completed', arguments: args };
      send('response.output_item.done', { type: 'response.output_item.done', output_index: index, item: doneItem });
      output.push(doneItem);
    });
    send('response.completed', {
      type: 'response.completed',
      response: { ...baseResponse, status: 'completed', output },
    });
    return;
  }

  const text = String(message.content || message.reasoning_content || '').trim() || '完成。';
  const itemId = `msg_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;
  send('response.output_item.added', { type: 'response.output_item.added', output_index: 0, item: { id: itemId, type: 'message', status: 'in_progress', role: 'assistant', content: [] } });
  send('response.content_part.added', { type: 'response.content_part.added', item_id: itemId, output_index: 0, content_index: 0, part: { type: 'output_text', text: '' } });
  send('response.output_text.delta', { type: 'response.output_text.delta', item_id: itemId, output_index: 0, content_index: 0, delta: text });
  send('response.output_text.done', { type: 'response.output_text.done', item_id: itemId, output_index: 0, content_index: 0, text });
  send('response.content_part.done', { type: 'response.content_part.done', item_id: itemId, output_index: 0, content_index: 0, part: { type: 'output_text', text } });
  const item = { id: itemId, type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text }] };
  send('response.output_item.done', { type: 'response.output_item.done', output_index: 0, item });
  send('response.completed', { type: 'response.completed', response: { ...baseResponse, status: 'completed', output: [item] } });
}

function isBlockedToolCall(toolCall) {
  const command = extractCommand(toolCall).toLowerCase();
  if (!command) return false;
  return /\bpnpm\s+(install|typecheck|lint|test|build|smoke)\b/.test(command)
    || /\bnpm\s+(install|test|run)\b/.test(command)
    || /\byarn\s+(install|test|build)\b/.test(command)
    || /\bget-childitem\b[\s\S]{0,120}\.\.[\\/]\.\./.test(command)
    || /\bls\b[\s\S]{0,120}\.\.[\\/]\.\./.test(command)
    || /\bdir\b[\s\S]{0,120}\.\.[\\/]\.\./.test(command)
    || /\bcd\s+\.\./.test(command);
}

function extractCommand(toolCall) {
  const raw = typeof toolCall?.function?.arguments === 'string' ? toolCall.function.arguments : JSON.stringify(toolCall?.function?.arguments || {});
  try {
    const parsed = JSON.parse(raw);
    return String(parsed.command || parsed.cmd || '');
  } catch {
    return raw;
  }
}

function normalizeInputItems(input) {
  if (Array.isArray(input)) return input;
  if (typeof input === 'string') return [{ type: 'message', role: 'user', content: input }];
  return [];
}

function normalizeRole(role) {
  if (role === 'assistant' || role === 'user' || role === 'tool') return role;
  return 'system';
}

function contentToText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (!part || typeof part !== 'object') return '';
        return part.text || part.input_text || part.output_text || '';
      })
      .filter(Boolean)
      .join('\n');
  }
  if (content && typeof content === 'object') return content.text || content.output || JSON.stringify(content);
  return '';
}

function deepPraxisApiKey(config) {
  return config.deepPraxisApiKey
    || process.env.AIYA_CREATE_CLI_DEEPPRAXIS_API_KEY
    || process.env.AIYA_CREATE_FAST_DIRECT_HTML_API_KEY
    || process.env.AIYA_CREATE_FAST_MODEL_API_KEY
    || process.env.AIYA_CREATE_MODEL_API_KEY
    || process.env.OPENAI_API_KEY
    || '';
}

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
