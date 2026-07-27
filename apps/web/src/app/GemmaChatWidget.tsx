'use client';

import { FormEvent, useMemo, useState } from 'react';

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

const quickPrompts = [
  '我想做一个软件，但还没想清楚',
  '帮我梳理真实需求',
  '深流科技能为我做什么',
];

export default function GemmaChatWidget() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      content: '你好，我是包子。你可以直接说一个想法，我会帮你把模糊需求拆成更清楚的下一步。',
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const lastAssistant = useMemo(
    () => [...messages].reverse().find((item) => item.role === 'assistant')?.content || '',
    [messages]
  );

  const send = async (value?: string) => {
    const text = (value ?? input).trim();
    if (!text || loading) return;
    setError('');
    const nextMessages: ChatMessage[] = [...messages, { role: 'user', content: text }];
    setMessages(nextMessages);
    setInput('');
    setLoading(true);
    try {
      const response = await fetch('/api/gemma-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: nextMessages.slice(-8) }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || `模型暂时不可用：${response.status}`);
      }
      setMessages([...nextMessages, { role: 'assistant', content: data.reply || data.answer || '我已经收到，但这次没有生成有效回复。' }]);
    } catch (err) {
      const message = err instanceof Error ? err.message : '模型连接失败';
      setError(message);
      setMessages([...nextMessages, { role: 'assistant', content: '我这边连接有点不稳定，请稍后再试一次。' }]);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void send();
  };

  return (
    <section className="gemmaConsole" aria-label="包子模型对话窗口">
      <div className="gemmaConsoleHead">
        <div>
          <span className="gemmaConsoleEyebrow">DeepFlow Site Agent</span>
          <h3>包子 · 模型对话</h3>
        </div>
        <span className="gemmaConsoleModel">gemma4-12b</span>
      </div>

      <div className="gemmaConsoleBody">
        <div className="gemmaAvatar">包</div>
        <p>{loading ? '包子正在思考…' : lastAssistant}</p>
      </div>

      <div className="gemmaQuickRow">
        {quickPrompts.map((prompt) => (
          <button key={prompt} type="button" onClick={() => void send(prompt)} disabled={loading}>
            {prompt}
          </button>
        ))}
      </div>

      <form className="gemmaInputRow" onSubmit={handleSubmit}>
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="输入一句真实想法…"
          disabled={loading}
        />
        <button type="submit" disabled={!input.trim() || loading}>{loading ? '…' : '发送'}</button>
      </form>

      {error && <p className="gemmaConsoleError">{error}</p>}
    </section>
  );
}
