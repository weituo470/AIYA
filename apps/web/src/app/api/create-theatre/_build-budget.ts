export class BuildBudget {
  readonly deadline: number;
  readonly maxCalls: number;
  readonly maxReservedOutputTokens: number;
  calls = 0;
  reservedOutputTokens = 0;
  constructor(startedAt: number) {
    const number = (key: string, fallback: number, min: number, max: number) => { const value = Number(process.env[key] || fallback); return Number.isFinite(value) ? Math.floor(Math.max(min, Math.min(max, value))) : fallback; };
    this.deadline = startedAt + number('AIYA_BUILD_TOTAL_TIMEOUT_MS', 480000, 1000, 900000);
    this.maxCalls = number('AIYA_BUILD_MAX_MODEL_CALLS', 5, 1, 8);
    this.maxReservedOutputTokens = number('AIYA_BUILD_MAX_OUTPUT_TOKENS', 80000, 1000, 128000);
  }
  remainingMs() { return Math.max(0, this.deadline - Date.now()); }
  assertAvailable() { if (!this.remainingMs()) throw new Error('应用构建总时间预算已用完。'); }
  assertCanReserve(maxOutputTokens: number) {
    this.assertAvailable();
    if (this.calls >= this.maxCalls || this.reservedOutputTokens + maxOutputTokens > this.maxReservedOutputTokens) throw new Error('应用构建模型调用或输出 Token 上限已达到，不再继续重试。');
  }
  reserve(maxOutputTokens: number) {
    this.assertCanReserve(maxOutputTokens);
    this.calls++; this.reservedOutputTokens += maxOutputTokens;
  }
  snapshot() { return { maxCalls: this.maxCalls, calls: this.calls, maxReservedOutputTokens: this.maxReservedOutputTokens, reservedOutputTokens: this.reservedOutputTokens, deadline: new Date(this.deadline).toISOString() }; }
}
