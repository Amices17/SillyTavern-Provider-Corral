// 逻辑冒烟：从 index.js 提取的核心算法独立验证
'use strict';
const assert = require('assert');

// ---- matchRule（与 index.js 同构）----
const escapeRe = t => String(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const RULE_MODES = new Set(['inherit', 'only', 'order', 'off']);
function matchRule(model, rules) {
    if (!Array.isArray(rules) || !rules.length) return null;
    const m = String(model ?? '');
    for (const rule of rules) {
        if (!rule || typeof rule.pattern !== 'string' || !rule.pattern) continue;
        const pattern = rule.pattern.trim();
        let re;
        if (pattern.includes('*')) {
            re = new RegExp('^' + pattern.split('*').map(escapeRe).join('.*') + '$', 'i');
        } else {
            re = new RegExp('^' + escapeRe(pattern), 'i');
        }
        if (re.test(m)) return rule;
    }
    return null;
}

// glob 命中
assert.strictEqual(matchRule('xiaomi/mimo-v2.6-flash', [{ pattern: 'xiaomi/mimo*', mode: 'only' }])?.mode, 'only');
// 大小写不敏感
assert.strictEqual(matchRule('XIAOMI/mimo', [{ pattern: 'xiaomi/*' }]) !== null, true);
// 不含 * = 前缀匹配
assert.strictEqual(matchRule('xiaomi/mimo-v2', [{ pattern: 'xiaomi' }]) !== null, true);
assert.strictEqual(matchRule('yabam/mimo', [{ pattern: 'xiaomi' }]), null);
// 第一条命中生效
assert.strictEqual(matchRule('anthropic/claude-x', [{ pattern: 'anthropic/*', mode: 'order' }, { pattern: 'anthropic/claude-x', mode: 'off' }])?.mode, 'order');
// 正则元字符不误伤
assert.strictEqual(matchRule('a+b/c', [{ pattern: 'a+b*' }]) !== null, true);
assert.strictEqual(matchRule('aab/c', [{ pattern: 'a+b*' }]), null);
// 空规则
assert.strictEqual(matchRule('any', []), null);
assert.strictEqual(matchRule('any', [{ pattern: '' }]), null);

// ---- validateRules（与新版 index.js 同构：支持数组与字符串双入参）----
function validateRules(input) {
    let parsed = input;
    if (typeof input === 'string') {
        const trimmed = input.trim();
        if (!trimmed) return { ok: true, rules: [] };
        try { parsed = JSON.parse(trimmed); } catch (e) { return { ok: false, error: 'JSON 解析失败: ' + e.message }; }
    }
    if (parsed === undefined || parsed === null) return { ok: true, rules: [] };
    if (!Array.isArray(parsed)) return { ok: false, error: '规则必须是数组 []' };
    for (const [i, r] of parsed.entries()) {
        if (!r || typeof r !== 'object') return { ok: false, error: `第 ${i + 1} 项不是对象` };
        if (typeof r.pattern !== 'string' || !r.pattern.trim()) return { ok: false, error: `第 ${i + 1} 项缺少 pattern` };
        if (r.mode !== undefined && !RULE_MODES.has(r.mode)) return { ok: false, error: `第 ${i + 1} 项 mode 非法（inherit/only/order/off）` };
        if (r.providers !== undefined && !Array.isArray(r.providers)) return { ok: false, error: `第 ${i + 1} 项 providers 必须是数组` };
    }
    return { ok: true, rules: parsed };
}
assert.strictEqual(validateRules('[]').ok, true);
assert.strictEqual(validateRules('').ok, true);
assert.strictEqual(validateRules('[{"pattern":"x","mode":"only"}]').ok, true);
assert.strictEqual(validateRules('not json').ok, false);
assert.strictEqual(validateRules('{"a":1}').ok, false);
assert.strictEqual(validateRules('[{"pattern":"x","mode":"banana"}]').ok, false);
assert.strictEqual(validateRules('[{"mode":"only"}]').ok, false);
// 数组直入（卡片收集路径）与空入参
assert.strictEqual(validateRules([{ pattern: 'xiaomi/mimo*', mode: 'only', providers: ['makora', 'xiaomi'] }]).ok, true);
assert.strictEqual(validateRules(undefined).ok, true);
assert.strictEqual(validateRules(null).ok, true);
assert.strictEqual(validateRules([{ pattern: '', mode: 'only' }]).ok, false);
assert.strictEqual(validateRules([{ pattern: 'x', providers: 'oops' }]).ok, false);

// ---- 路由注入决策（applyRouting + shouldPatch 同构）----
const cfg = { enabled: true, mode: 'order', providers: ['deepseek', 'xiaomi', 'novita'], quantizations: [], modelRules: [], patchTextCompletion: false };
function resolveRouting(model, c) {
    const rule = matchRule(model, c.modelRules);
    let mode = c.mode;
    let list = c.providers;
    if (rule) {
        if (rule.mode && rule.mode !== 'inherit' && RULE_MODES.has(rule.mode)) mode = rule.mode;
        if (Array.isArray(rule.providers) && rule.providers.length) list = rule.providers;
    }
    return { mode, list: Array.isArray(list) ? list : [] };
}
function applyRouting(body, c) {
    if (!c.enabled) return false;
    const { mode, list } = resolveRouting(body.model, c);
    if (mode === 'off' || !list.length) return false;
    body.provider = [...list];
    body.allow_fallbacks = mode === 'order';
    body.use_fallback = body.allow_fallbacks;
    if (Array.isArray(c.quantizations) && c.quantizations.length) body.quantizations = [...c.quantizations];
    return true;
}
const GENERATE_URL_RE = /\/(chat-completions|text-completions)\/generate(\?|$)/;
function shouldPatch(url, method, body, c) {
    if (String(method ?? 'GET').toUpperCase() !== 'POST') return false;
    if (!GENERATE_URL_RE.test(url)) return false;
    if (typeof body?.model !== 'string') return false;
    if (/chat-completions/.test(url)) return body.chat_completion_source === 'openrouter';
    return Boolean(c.patchTextCompletion);
}

// order 模式注入
const b1 = { model: 'deepseek/deepseek-chat', chat_completion_source: 'openrouter' };
assert.strictEqual(applyRouting(b1, cfg), true);
assert.deepStrictEqual(b1.provider, ['deepseek', 'xiaomi', 'novita']);
assert.strictEqual(b1.allow_fallbacks, true);
assert.strictEqual(b1.use_fallback, true);

// only 模式 → allow_fallbacks false
const b2 = { model: 'm', chat_completion_source: 'openrouter' };
applyRouting(b2, { ...cfg, mode: 'only' });
assert.strictEqual(b2.allow_fallbacks, false);

// 规则覆盖：only + 钉死两家
const cfgRule = { ...cfg, modelRules: [{ pattern: 'xiaomi/mimo*', mode: 'only', providers: ['makora', 'xiaomi'] }] };
const b3 = { model: 'xiaomi/mimo-v2.6-flash', chat_completion_source: 'openrouter' };
applyRouting(b3, cfgRule);
assert.deepStrictEqual(b3.provider, ['makora', 'xiaomi']);
assert.strictEqual(b3.allow_fallbacks, false);

// 规则 mode=off → 不注入
const b4 = { model: 'anthropic/claude', chat_completion_source: 'openrouter' };
assert.strictEqual(applyRouting(b4, { ...cfg, modelRules: [{ pattern: 'anthropic/*', mode: 'off' }] }), false);

// 总闸门关闭
const b5 = { model: 'm', chat_completion_source: 'openrouter' };
assert.strictEqual(applyRouting(b5, { ...cfg, enabled: false }), false);

// 端点/来源判断矩阵
const c = cfg;
assert.strictEqual(shouldPatch('/api/backends/chat-completions/generate', 'POST', { model: 'x', chat_completion_source: 'openrouter' }, c), true);
assert.strictEqual(shouldPatch('/api/backends/chat-completions/generate', 'POST', { model: 'x', chat_completion_source: 'claude' }, c), false);
assert.strictEqual(shouldPatch('/api/backends/chat-completions/status', 'POST', { model: 'x', chat_completion_source: 'openrouter' }, c), false);
assert.strictEqual(shouldPatch('/api/backends/text-completions/generate', 'POST', { model: 'x' }, c), false); // 默认关
assert.strictEqual(shouldPatch('/api/backends/text-completions/generate', 'POST', { model: 'x' }, { ...c, patchTextCompletion: true }), true);
assert.strictEqual(shouldPatch('/api/backends/chat-completions/generate', 'GET', { model: 'x', chat_completion_source: 'openrouter' }, c), false);
assert.strictEqual(shouldPatch('/api/characters/create', 'POST', { model: 'x', chat_completion_source: 'openrouter' }, c), false);
assert.strictEqual(shouldPatch('/api/backends/chat-completions/tokenize', 'POST', { model: 'x', chat_completion_source: 'openrouter' }, c), false); // 不含 generate 但含 chat-completions —— 期望？

// ---- 接缝测试：模拟 orpFetch 主流程（body 是 JSON 字符串，必须先 parse 再进 shouldPatch）----
function orpFetchPipeline(initBodyString, config) {
    if (typeof initBodyString !== 'string') return { patched: false };
    let body;
    try { body = JSON.parse(initBodyString); } catch { body = null; }
    if (body && typeof body === 'object' && !Array.isArray(body)
        && shouldPatch('/api/backends/chat-completions/generate', 'POST', body, config)) {
        if (applyRouting(body, config)) return { patched: true, body };
    }
    return { patched: false, body };
}
const seam = orpFetchPipeline(JSON.stringify({ model: 'deepseek/deepseek-chat', chat_completion_source: 'openrouter', messages: [] }), c);
assert.strictEqual(seam.patched, true, 'JSON 字符串 body 必须能进入注入流程');
assert.deepStrictEqual(seam.body.provider, ['deepseek', 'xiaomi', 'novita']);
assert.strictEqual(seam.body.allow_fallbacks, true);
// 字符串 body 直接进 shouldPatch 必须被拒（记录这个曾发生的 bug 形态）
assert.strictEqual(shouldPatch('/api/backends/chat-completions/generate', 'POST', JSON.stringify({ model: 'x', chat_completion_source: 'openrouter' }), c), false);

console.log('ALL PASS — 17 group assertions');