'use strict';

/**
 * OpenRouter 上游围栏 (SillyTavern extension: Provider Corral)
 *
 * 按模型规则圈定允许使用的 OpenRouter 提供商：命中规则的模型只在勾选的
 * 上游“栏”内活动（provider.order + allow_fallbacks 注入），越栏不贷；
 * 单选 = 死钉一家（挂了就报错），多选 = 栏内交给 OpenRouter 分配。
 * 目录实时拉取官方端点，24h 缓存 + 内置快照兜底。
 *
 * 隐私：只向 https://openrouter.ai/api/v1/providers 发起公开目录请求，
 * 不接触、不存储、不外传任何 API 密钥；配置仅含 provider slug 列表，无遥测。
 */

(() => {
    const MODULE = 'provider_corral';
    const LEGACY_MODULE = 'openrouter_providers_ext'; // 1.2.0 改名前的设置 key
    const CATALOG_URL = 'https://openrouter.ai/api/v1/providers';
    const CACHE_KEY = 'provider_corral_catalog_v1';
    const CACHE_TTL = 24 * 60 * 60 * 1000;      // 24 小时
    const OFFLINE_RETRY = 60 * 1000;             // 拉取失败 60 秒后重试
    /** 面板模板所在扩展目录（兼容手动目录名与 Git 安装目录名） */
    const PANEL_FOLDER_CANDIDATES = [
        'third-party/SillyTavern-Provider-Corral',
        'third-party/provider-corral',
        'third-party/openrouter-providers',
    ];

    /** 内置快照（离线兜底），2026-10-31 拉取自官方目录，共 117 家 */
    const SNAPSHOT = [
        ["ionstream", "Ionstream"],
        ["deepgram", "Deepgram"],
        ["moonshotai", "Moonshot AI"],
        ["featherless", "Featherless"],
        ["arcee-ai", "Arcee AI"],
        ["voyageai", "VoyageAI by MongoDB"],
        ["pareto-alpha", "ParetoAlpha"],
        ["morph", "Morph"],
        ["particle-ai", "Particle AI"],
        ["mistral", "Mistral"],
        ["ai21", "AI21"],
        ["black-forest-labs", "Black Forest Labs"],
        ["recursive", "Recursive"],
        ["io-net", "Io Net"],
        ["claude-on-aws", "Claude Platform on AWS"],
        ["stepfun", "StepFun"],
        ["darkbloom", "Darkbloom"],
        ["modal", "Modal"],
        ["primalabs", "PrimaLabs"],
        ["sail-research", "Sail Research"],
        ["tencent", "Tencent"],
        ["perplexity", "Perplexity"],
        ["sambanova", "SambaNova"],
        ["stealth", "Stealth"],
        ["fireworks", "Fireworks"],
        ["switchpoint", "Switchpoint"],
        ["ollama", "Ollama"],
        ["krea", "Krea"],
        ["mara", "Mara"],
        ["amazon-nova", "Amazon Nova"],
        ["cosine", "Cosine"],
        ["sourceful", "Sourceful"],
        ["cloudflare", "Cloudflare"],
        ["groq", "Groq"],
        ["mancer", "Mancer 2"],
        ["amazon-bedrock", "Amazon Bedrock"],
        ["kt", "KT"],
        ["crucible", "Crucible"],
        ["recraft", "Recraft"],
        ["decart", "Decart"],
        ["dekallm", "DekaLLM"],
        ["minimax", "Minimax"],
        ["modelrun", "ModelRun"],
        ["perceptron", "Perceptron"],
        ["poolside", "Poolside"],
        ["seed", "Seed"],
        ["inferact-vllm", "Inferact vLLM"],
        ["coreweave", "CoreWeave"],
        ["runway", "Runway"],
        ["baidu", "Baidu"],
        ["modular", "Modular"],
        ["cirrascale", "Cirrascale"],
        ["baseten", "BaseTen"],
        ["ambient", "Ambient"],
        ["crusoe", "Crusoe"],
        ["inceptron", "Inceptron"],
        ["cohere", "Cohere"],
        ["deepseek", "DeepSeek"],
        ["nex-agi", "Nex AGI"],
        ["reka", "Reka"],
        ["upstage", "Upstage"],
        ["thinkingmachines", "Thinking Machines"],
        ["xiaomi", "Xiaomi"],
        ["nextbit", "NextBit"],
        ["databricks", "Databricks"],
        ["nvidia", "Nvidia"],
        ["relace", "Relace"],
        ["infermatic", "Infermatic"],
        ["makora", "Makora"],
        ["streamlake", "StreamLake"],
        ["avian", "Avian"],
        ["assemblyai", "AssemblyAI"],
        ["near-ai", "Near AI"],
        ["typesafe", "TypeSafe"],
        ["quiver", "Quiver"],
        ["clarifai", "Clarifai"],
        ["z-ai", "Z.AI"],
        ["deepinfra", "DeepInfra"],
        ["heygen", "HeyGen"],
        ["tenstorrent", "Tenstorrent"],
        ["sakana", "Sakana AI"],
        ["unbiased", "Unbiased"],
        ["fish-audio", "Fish Audio"],
        ["akashml", "AkashML"],
        ["inflection", "Inflection"],
        ["scaledown", "ScaleDown"],
        ["wafer", "Wafer"],
        ["respan", "Respan"],
        ["open-inference", "OpenInference"],
        ["xai", "xAI"],
        ["primeintellect", "PrimeIntellect"],
        ["nebius", "Nebius"],
        ["azure", "Azure"],
        ["cerebras", "Cerebras"],
        ["elevenlabs", "ElevenLabs"],
        ["parasail", "Parasail"],
        ["aion-labs", "AionLabs"],
        ["inference-net", "InferenceNet"],
        ["liquid", "Liquid"],
        ["meta", "Meta"],
        ["siliconflow", "SiliconFlow"],
        ["fake-provider", "FakeProvider"],
        ["phala", "Phala"],
        ["anthropic", "Anthropic"],
        ["atlas-cloud", "AtlasCloud"],
        ["chutes", "Chutes"],
        ["google-ai-studio", "Google AI Studio"],
        ["google-vertex", "Google"],
        ["venice", "Venice"],
        ["openai", "OpenAI"],
        ["together", "Together"],
        ["friendli", "Friendli"],
        ["inception", "Inception"],
        ["gmicloud", "GMICloud"],
        ["alibaba", "Alibaba"],
        ["digitalocean", "DigitalOcean"],
        ["novita", "Novita"],
    ].map(([slug, name]) => ({ slug, name }));

    /** 读不到原生量化下拉时的兜底枚举 */
    const DEFAULT_QUANTIZATIONS = [
        { value: 'int4', label: '整数 (4 bit)' },
        { value: 'int8', label: '整数 (8 bit)' },
        { value: 'fp4', label: '浮点数 (4 bit)' },
        { value: 'fp6', label: '浮点数 (6 bit)' },
        { value: 'fp8', label: '浮点数 (8 bit)' },
        { value: 'fp16', label: '浮点数 (16 bit)' },
        { value: 'bf16', label: 'Brain 浮点数 (16 bit)' },
    ];

    const DEFAULTS = Object.freeze({
        enabled: true,
        mode: 'order',              // 'order' | 'only' | 'off'
        providers: [],              // slug 数组，顺序即 provider.order 优先级
        quantizations: [],          // slug 数组，空 = 不限制
        modelRules: [],             // [{pattern, mode, providers}]
        patchTextCompletion: false, // 是否同时注入 text-completions 请求
    });

    const RULE_MODES = new Set(['inherit', 'only', 'order', 'off']);

    // ======================= 设置 =======================

    function getSettings() {
        const { extensionSettings } = SillyTavern.getContext();
        if (!extensionSettings[MODULE] || typeof extensionSettings[MODULE] !== 'object') {
            // 1.2.0 改名：从旧 key 迁移已有配置
            const legacy = extensionSettings[LEGACY_MODULE];
            if (legacy && typeof legacy === 'object') {
                extensionSettings[MODULE] = { ...structuredClone(DEFAULTS), ...structuredClone(legacy) };
            } else {
                extensionSettings[MODULE] = structuredClone(DEFAULTS);
            }
        }
        const s = extensionSettings[MODULE];
        for (const key of Object.keys(DEFAULTS)) {
            if (!Object.hasOwn(s, key)) s[key] = structuredClone(DEFAULTS[key]);
        }
        return s;
    }

    function persist() {
        SillyTavern.getContext().saveSettingsDebounced();
    }

    function toastMsg(text, type) {
        const fn = globalThis.toast;
        if (typeof fn === 'function') fn(text, type);
        else console.log('[ProviderCorral]', text);
    }

    // ======================= 提供商目录 =======================

    let offlineUntil = 0;
    let catalogCache = null; // {items, source, at}

    async function loadCatalog({ force = false } = {}) {
        if (!force) {
            // 新鲜缓存直接用
            if (catalogCache && Date.now() - catalogCache.at < CACHE_TTL) {
                return catalogCache;
            }
            try {
                const cached = JSON.parse(localStorage.getItem(CACHE_KEY));
                if (Array.isArray(cached?.items) && cached.items.length && Date.now() - cached.at < CACHE_TTL) {
                    catalogCache = { items: cached.items, source: cached.source || 'live', at: cached.at };
                    return catalogCache;
                }
            } catch { /* 缓存损坏，继续走网络 */ }
            // 离线冷却期内不打网络
            if (Date.now() < offlineUntil) {
                return { items: SNAPSHOT, source: 'builtin', at: Date.now(), stale: true };
            }
        }

        try {
            const res = await fetch(CATALOG_URL, { headers: { Accept: 'application/json' } });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            const raw = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);
            const items = raw
                .map(p => ({
                    slug: String(p?.slug ?? p?.name ?? '').trim().toLowerCase().replace(/\s+/g, '-'),
                    name: String(p?.name ?? p?.slug ?? '').trim(),
                }))
                .filter(p => p.slug);
            if (!items.length) throw new Error('目录为空');

            const at = Date.now();
            offlineUntil = 0;
            catalogCache = { items, source: 'live', at };
            try {
                localStorage.setItem(CACHE_KEY, JSON.stringify({ at, source: 'live', items }));
            } catch { /* localStorage 满/禁用：内存缓存仍生效 */ }
            return catalogCache;
        } catch (err) {
            console.warn('[ProviderCorral] 官方目录拉取失败，使用内置快照：', err?.message ?? err);
            offlineUntil = Date.now() + OFFLINE_RETRY;
            const cachedAt = (() => {
                try { return JSON.parse(localStorage.getItem(CACHE_KEY))?.at ?? 0; } catch { return 0; }
            })();
            return { items: SNAPSHOT, source: 'builtin', at: cachedAt || Date.now(), stale: true };
        }
    }

    /** 目录 + 已选但不在目录里的手填 slug（选中项永不丢） */
    async function getDisplayItems() {
        const { items, source, stale } = await loadCatalog();
        const map = new Map(items.map(p => [p.slug, p.name]));
        for (const slug of getSettings().providers) {
            if (!map.has(slug)) map.set(slug, slug);
        }
        return {
            items: [...map].map(([slug, name]) => ({ slug, name })),
            source,
            stale: stale || source === 'builtin',
        };
    }

    // ======================= 酒馆原生下拉注入 =======================

    const NATIVE_PROVIDER_SELECTS = ['#openrouter_providers_chat', '#openrouter_providers_text'];

    async function injectNativeSelects() {
        const { items } = await getDisplayItems();
        const jq = globalThis.jQuery ?? globalThis.$;
        let touched = false;

        for (const selector of NATIVE_PROVIDER_SELECTS) {
            const el = document.querySelector(selector);
            if (!el) continue;
            const seen = new Set([...el.options].map(o => o.value));
            for (const p of items) {
                if (!seen.has(p.slug)) {
                    el.add(new Option(p.name, p.slug));
                    touched = true;
                }
            }
            // 更新已存在 option 的显示名（官方改名时跟进）
            for (const o of el.options) {
                const fresh = items.find(p => p.slug === o.value);
                if (fresh && fresh.name && o.text !== fresh.name && o.value !== fresh.name) {
                    o.text = fresh.name;
                }
            }
            if (touched && jq) {
                try { jq(el).trigger('change.select2'); } catch { /* select2 未挂载时忽略 */ }
            }
        }
        return touched;
    }

    async function getQuantizationOptions() {
        const src = document.querySelector('#openrouter_quantizations_chat')
            || document.querySelector('#openrouter_quantizations_text');
        if (src && src.options.length) {
            return [...src.options].map(o => ({ value: o.value, label: o.textContent.trim() }));
        }
        return DEFAULT_QUANTIZATIONS;
    }

    // ======================= 按模型规则 =======================

    const escapeRe = t => String(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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
                re = new RegExp('^' + escapeRe(pattern), 'i'); // 不含 * = 命名空间前缀匹配
            }
            if (re.test(m)) return rule;
        }
        return null;
    }

    // ======================= 请求注入层 =======================

    const GENERATE_URL_RE = /\/(chat-completions|text-completions)\/generate(\?|$)/;

    function resolveRouting(model) {
        const cfg = getSettings();
        const rule = matchRule(model, cfg.modelRules);
        let mode = cfg.mode;
        let list = cfg.providers;
        if (rule) {
            if (rule.mode && rule.mode !== 'inherit' && RULE_MODES.has(rule.mode)) mode = rule.mode;
            if (Array.isArray(rule.providers) && rule.providers.length) list = rule.providers;
        }
        return { mode, list: Array.isArray(list) ? list : [] };
    }

    function applyRouting(body) {
        const cfg = getSettings();
        if (!cfg.enabled) return false;

        const { mode, list } = resolveRouting(body.model);
        if (mode === 'off' || !list.length) return false;

        body.provider = [...list];
        body.allow_fallbacks = mode === 'order';   // 后端 chat-completions.js 读取此字段
        body.use_fallback = body.allow_fallbacks;  // 兼容前端字段名
        if (Array.isArray(cfg.quantizations) && cfg.quantizations.length) {
            body.quantizations = [...cfg.quantizations];
        }
        return true;
    }

    function shouldPatch(url, method, body) {
        if (String(method ?? 'GET').toUpperCase() !== 'POST') return false;
        if (!GENERATE_URL_RE.test(url)) return false;
        if (typeof body?.model !== 'string') return false;

        if (/chat-completions/.test(url)) {
            return body.chat_completion_source === 'openrouter';
        }
        return Boolean(getSettings().patchTextCompletion);
    }

    const realFetchHint = 'orpFetch';

    /**
     * 构造注入层包装。prev = 被垫在下面的 fetch（原生或其他插件的包装）。
     * 用 __orp 标记识别自己，若别的插件在我们之后又包了 fetch（会把我们顶掉），
     * ensureFetchHook() 会重新把他们垫到下面、把我们换回最外层。
     */
    function makeOurs(prev) {
        const hooked = async function orpFetch(input, init) {
            try {
                const url = typeof input === 'string' ? input
                    : (input instanceof URL ? input.href : (input?.url ?? ''));
                const cfg = getSettings();

                if (cfg.enabled && init && typeof init.body === 'string') {
                    let body;
                    try { body = JSON.parse(init.body); } catch { body = null; }
                    if (body && typeof body === 'object' && !Array.isArray(body) && shouldPatch(url, init.method, body)) {
                        if (applyRouting(body)) {
                            console.debug('[ProviderCorral] 注入:', url, {
                                provider: body.provider,
                                allow_fallbacks: body.allow_fallbacks,
                                quantizations: body.quantizations,
                            });
                            return prev(input, { ...init, body: JSON.stringify(body) });
                        }
                    }
                }
            } catch (err) {
                console.warn('[ProviderCorral] 注入层出错（放行原请求）:', err);
            }
            return prev(input, init);
        };
        hooked.__orp = true;
        return hooked;
    }

    window.fetch = makeOurs(window.fetch.bind(window));

    function ensureFetchHook() {
        try {
            if (window.fetch && window.fetch.__orp) return false;
            window.fetch = makeOurs(window.fetch.bind(window));
            console.debug(`[${realFetchHint}] 检测到其他扩展重包了 fetch，已重新抢占最外层`);
            return true;
        } catch (err) {
            console.warn('[ProviderCorral] fetch 守护失败:', err);
            return false;
        }
    }
    // 晚到的包装（其他插件异步挂钩）交给定时守护兜底
    setInterval(() => { try { ensureFetchHook(); } catch { /* 忽略 */ } }, 10_000);

    // ======================= 面板 =======================

    const dom = {}; // 面板元素缓存

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
            if (!r || typeof r !== 'object') return { ok: false, error: `第 ${i + 1} 项不是对象` }; // 中文序数用 i+1
            if (typeof r.pattern !== 'string' || !r.pattern.trim()) return { ok: false, error: `第 ${i + 1} 项缺少 pattern` };
            if (r.mode !== undefined && !RULE_MODES.has(r.mode)) return { ok: false, error: `第 ${i + 1} 项 mode 非法（inherit/only/order/off）` };
            if (r.providers !== undefined && !Array.isArray(r.providers)) return { ok: false, error: `第 ${i + 1} 项 providers 必须是数组` };
        }
        return { ok: true, rules: parsed };
    }

    function renderStatus(catalog) {
        if (!dom.status) return;
        const stale = catalog.stale || catalog.source === 'builtin';
        dom.status.textContent = stale
            ? `· 离线/未刷新，共 ${catalog.items.length} 家（内置快照），60s 后自动重试`
            : `· 官方目录 ${catalog.items.length} 家`;
        dom.status.classList.toggle('orp-err', stale);
    }

    function renderQuantizationRow() {
        const cfg = getSettings();
        getQuantizationOptions().then(options => {
            if (!dom.quant) return;
            dom.quant.textContent = '';
            for (const opt of options) {
                const label = document.createElement('label');
                label.className = 'orp-switch';
                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.value = opt.value;
                cb.checked = cfg.quantizations.includes(opt.value);
                cb.addEventListener('change', () => {
                    const set = new Set(getSettings().quantizations);
                    cb.checked ? set.add(cb.value) : set.delete(cb.value);
                    getSettings().quantizations = [...set];
                    persist();
                });
                const span = document.createElement('span');
                span.textContent = opt.label;
                label.append(cb, span);
                dom.quant.append(label);
            }
        });
    }

    async function renderList() {
        if (!dom.list) return;
        const cfg = getSettings();
        const { items, source, stale } = await getDisplayItems();
        renderStatus({ items, source, stale });

        const query = (dom.search?.value ?? '').trim().toLowerCase();
        const selected = cfg.providers;                       // 顺序即优先级
        const selectedSet = new Set(selected);

        // 已选项按优先级置顶，其余按名称排序
        const rest = items.filter(p => !selectedSet.has(p.slug)).sort((a, b) => a.name.localeCompare(b.name));
        const ordered = [
            ...selected.map(slug => items.find(p => p.slug === slug) ?? { slug, name: slug }),
            ...rest,
        ].filter(p => !query || p.slug.toLowerCase().includes(query) || p.name.toLowerCase().includes(query));

        dom.list.textContent = '';
        for (const item of ordered) {
            const idx = selected.indexOf(item.slug);
            const row = document.createElement('label');
            row.className = 'orp-item';
            row.dataset.slug = item.slug;

            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = idx >= 0;

            const badge = document.createElement('span');
            badge.className = 'orp-badge';
            badge.textContent = idx >= 0 ? String(idx + 1) : '';
            badge.style.visibility = idx >= 0 ? 'visible' : 'hidden';

            const name = document.createElement('span');
            name.className = 'orp-name';
            name.textContent = item.name;

            const slug = document.createElement('span');
            slug.className = 'orp-slug';
            slug.textContent = item.slug;

            row.append(cb, badge, name, slug);

            if (idx >= 0) {
                const move = document.createElement('span');
                move.className = 'orp-move';
                const up = document.createElement('button');
                up.type = 'button';
                up.className = 'menu_button';
                up.textContent = '↑';
                up.title = '提高优先级';
                const down = document.createElement('button');
                down.type = 'button';
                down.className = 'menu_button';
                down.textContent = '↓';
                down.title = '降低优先级';

                up.addEventListener('click', e => {
                    e.preventDefault();
                    const s = getSettings().providers;
                    const i = s.indexOf(item.slug);
                    if (i > 0) {
                        [s[i - 1], s[i]] = [s[i], s[i - 1]];
                        persist();
                        renderList();
                    }
                });
                down.addEventListener('click', e => {
                    e.preventDefault();
                    const s = getSettings().providers;
                    const i = s.indexOf(item.slug);
                    if (i >= 0 && i < s.length - 1) {
                        [s[i + 1], s[i]] = [s[i], s[i + 1]];
                        persist();
                        renderList();
                    }
                });
                move.append(up, down);
                row.append(move);
            }

            cb.addEventListener('change', () => {
                const s = getSettings();
                if (cb.checked) {
                    if (!s.providers.includes(item.slug)) s.providers.push(item.slug);
                } else {
                    s.providers = s.providers.filter(x => x !== item.slug);
                }
                persist();
                renderList();
            });

            dom.list.append(row);
        }

        if (!ordered.length) {
            const empty = document.createElement('div');
            empty.className = 'orp-hint';
            empty.style.padding = '6px';
            empty.textContent = '没有匹配的提供商';
            dom.list.append(empty);
        }

        const countEl = dom.count ?? document.querySelector('#orp-count');
        if (countEl) countEl.textContent = `已选 ${cfg.providers.length} 个`;
    }

    // ======================= 按模型规则卡片 =======================

    const RULE_MODE_OPTIONS = [
        ['inherit', '跟随全局模式'],
        ['order', '按序优先（order + 后备）'],
        ['only', '仅允许规则提供商 (only)'],
        ['off', '跳过注入（不限制）'],
    ];

    const getRuleProviders = card => {
        try {
            const arr = JSON.parse(card.dataset.providers || '[]');
            return Array.isArray(arr) ? arr.map(String) : [];
        } catch { return []; }
    };
    const setRuleProviders = (card, arr) => { card.dataset.providers = JSON.stringify(arr); };

    function markDirty(text = '有未保存的修改') {
        setMsg(dom.dirty, text, '');
    }

    async function renderRuleProvidersInCard(card) {
        const listEl = card.querySelector('.orp-rule-list');
        if (!listEl) return;
        const { items } = await getDisplayItems();
        const query = (card.querySelector('.orp-rule-search')?.value ?? '').trim().toLowerCase();
        const selected = getRuleProviders(card);
        const selectedSet = new Set(selected);

        const rest = items.filter(p => !selectedSet.has(p.slug)).sort((a, b) => a.name.localeCompare(b.name));
        const ordered = [
            ...selected.map(slug => items.find(p => p.slug === slug) ?? { slug, name: slug }),
            ...rest,
        ].filter(p => !query || p.slug.toLowerCase().includes(query) || p.name.toLowerCase().includes(query));

        listEl.textContent = '';
        for (const item of ordered) {
            const idx = selected.indexOf(item.slug);
            const row = document.createElement('label');
            row.className = 'orp-item';
            row.dataset.slug = item.slug;

            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = idx >= 0;

            const badge = document.createElement('span');
            badge.className = 'orp-badge';
            badge.textContent = idx >= 0 ? String(idx + 1) : '';
            badge.style.visibility = idx >= 0 ? 'visible' : 'hidden';

            const name = document.createElement('span');
            name.className = 'orp-name';
            name.textContent = item.name;

            const slug = document.createElement('span');
            slug.className = 'orp-slug';
            slug.textContent = item.slug;

            row.append(cb, badge, name, slug);

            if (idx >= 0) {
                const move = document.createElement('span');
                move.className = 'orp-move';
                const up = document.createElement('button');
                up.type = 'button';
                up.className = 'menu_button';
                up.textContent = '↑';
                up.title = '提高优先级';
                const down = document.createElement('button');
                down.type = 'button';
                down.className = 'menu_button';
                down.textContent = '↓';
                down.title = '降低优先级';

                up.addEventListener('click', e => {
                    e.preventDefault();
                    const s = getRuleProviders(card);
                    const i = s.indexOf(item.slug);
                    if (i > 0) {
                        [s[i - 1], s[i]] = [s[i], s[i - 1]];
                        setRuleProviders(card, s);
                        renderRuleProvidersInCard(card);
                        markDirty();
                    }
                });
                down.addEventListener('click', e => {
                    e.preventDefault();
                    const s = getRuleProviders(card);
                    const i = s.indexOf(item.slug);
                    if (i >= 0 && i < s.length - 1) {
                        [s[i + 1], s[i]] = [s[i], s[i + 1]];
                        setRuleProviders(card, s);
                        renderRuleProvidersInCard(card);
                        markDirty();
                    }
                });
                move.append(up, down);
                row.append(move);
            }

            cb.addEventListener('change', () => {
                const s = getRuleProviders(card);
                if (cb.checked) {
                    if (!s.includes(item.slug)) s.push(item.slug);
                } else {
                    const i = s.indexOf(item.slug);
                    if (i >= 0) s.splice(i, 1);
                }
                setRuleProviders(card, s);
                renderRuleProvidersInCard(card);
                markDirty();
            });

            listEl.append(row);
        }

        const countEl = card.querySelector('.orp-rule-count');
        if (countEl) countEl.textContent = `已选 ${selected.length} 个`;
    }

    function buildRuleCard(rule = {}) {
        const card = document.createElement('div');
        card.className = 'orp-rule-card';
        setRuleProviders(card, Array.isArray(rule.providers) ? rule.providers.map(String) : []);

        const head = document.createElement('div');
        head.className = 'orp-rule-head';

        const pattern = document.createElement('input');
        pattern.type = 'text';
        pattern.className = 'text_pole orp-rule-pattern';
        pattern.placeholder = '模型匹配，如 xiaomi/mimo* 或 anthropic';
        pattern.value = typeof rule.pattern === 'string' ? rule.pattern : '';
        pattern.addEventListener('input', () => markDirty());

        const mode = document.createElement('select');
        mode.className = 'orp-rule-mode';
        const initialMode = ['inherit', 'order', 'only', 'off'].includes(rule.mode) ? rule.mode : 'inherit';
        for (const [value, label] of RULE_MODE_OPTIONS) {
            const opt = new Option(label, value);
            if (value === initialMode) opt.selected = true;
            mode.add(opt);
        }
        mode.addEventListener('change', () => markDirty());

        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'menu_button orp-rule-del';
        del.textContent = '×';
        del.title = '删除该规则';
        del.addEventListener('click', () => {
            card.remove();
            markDirty('已删除一条规则，记得保存');
        });

        head.append(pattern, mode, del);

        const label = document.createElement('div');
        label.className = 'orp-rule-label';
        label.textContent = '规则提供商（留空 = 继承全局）';

        const search = document.createElement('input');
        search.type = 'text';
        search.className = 'text_pole orp-rule-search';
        search.placeholder = '搜索提供商（名称或 slug）…';
        search.addEventListener('input', () => renderRuleProvidersInCard(card));

        const headRow = document.createElement('div');
        headRow.className = 'orp-listhead';
        const count = document.createElement('span');
        count.className = 'orp-rule-count orp-count';
        count.textContent = '已选 0 个';
        const clear = document.createElement('button');
        clear.type = 'button';
        clear.className = 'menu_button orp-shrink';
        clear.textContent = '清空';
        clear.addEventListener('click', () => {
            setRuleProviders(card, []);
            renderRuleProvidersInCard(card);
            markDirty();
        });
        headRow.append(count, clear);

        const list = document.createElement('div');
        list.className = 'orp-list orp-rule-list';

        const slugRow = document.createElement('div');
        slugRow.className = 'orp-row';
        const slugInput = document.createElement('input');
        slugInput.type = 'text';
        slugInput.className = 'text_pole';
        slugInput.placeholder = '自定义 slug（逗号分隔）';
        const slugAdd = document.createElement('button');
        slugAdd.type = 'button';
        slugAdd.className = 'menu_button orp-shrink';
        slugAdd.textContent = '添加';
        const slugAddFn = () => {
            const slugs = String(slugInput.value ?? '').split(/[\s,，;；]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
            if (!slugs.length) { markDirty('先输入要添加的 slug'); return; }
            const s = getRuleProviders(card);
            let added = 0;
            for (const slug of slugs) {
                if (!s.includes(slug)) { s.push(slug); added++; }
            }
            setRuleProviders(card, s);
            slugInput.value = '';
            if (search) search.value = '';
            renderRuleProvidersInCard(card);
            markDirty(added ? `已添加 ${added} 家到该规则` : '这些 slug 已在规则里');
        };
        slugAdd.addEventListener('click', slugAddFn);
        slugInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); slugAddFn(); } });
        slugRow.append(slugInput, slugAdd);

        card.append(head, label, search, headRow, list, slugRow);
        renderRuleProvidersInCard(card);
        return card;
    }

    function renderRuleCards(rules) {
        const host = document.querySelector('#orp-rules-cards');
        if (!host) return;
        host.textContent = '';
        const list = Array.isArray(rules) ? rules : [];
        for (const rule of list) host.append(buildRuleCard(rule));
    }

    function collectRulesFromCards() {
        const cards = [...document.querySelectorAll('#orp-rules-cards .orp-rule-card')];
        const rules = [];
        const errors = [];
        for (const [i, card] of cards.entries()) {
            const pattern = (card.querySelector('.orp-rule-pattern')?.value ?? '').trim();
            const mode = card.querySelector('.orp-rule-mode')?.value ?? 'inherit';
            if (!pattern) { errors.push(`第 ${i + 1} 条规则的匹配串是空的`); continue; }
            rules.push({ pattern, mode, providers: getRuleProviders(card) });
        }
        return { rules, errors };
    }

    function syncFormFromSettings() {
        const cfg = getSettings();
        if (dom.enabled) dom.enabled.checked = Boolean(cfg.enabled);
        for (const radio of document.querySelectorAll('input[name="orp-mode"]')) {
            radio.checked = radio.value === cfg.mode;
        }
        if (dom.textPatch) dom.textPatch.checked = Boolean(cfg.patchTextCompletion);
        if (dom.dirty) dom.dirty.textContent = '';
        renderRuleCards(cfg.modelRules);
    }

    function bindPanel(root) {
        const $id = id => root.querySelector(`#${id}`);
        dom.status = root.querySelector('#orp-status') || document.querySelector('#orp-status');
        dom.enabled = $id('orp-enabled');
        dom.search = $id('orp-search');
        dom.list = $id('orp-list');
        dom.quant = $id('orp-quant');
        dom.rulesMsg = $id('orp-rules-msg');
        dom.count = $id('orp-count');
        dom.dirty = $id('orp-dirty');
        dom.transfer = $id('orp-transfer');
        dom.textPatch = $id('orp-text-patch');

        syncFormFromSettings();
        renderQuantizationRow();
        renderList();

        dom.enabled?.addEventListener('change', () => {
            getSettings().enabled = dom.enabled.checked;
            persist();
            setMsg(dom.dirty, dom.enabled.checked ? '已启用' : '已停用（不注入，使用酒馆原生选择）', 'ok');
        });

        for (const radio of root.querySelectorAll('input[name="orp-mode"]')) {
            radio.addEventListener('change', () => {
                if (radio.checked) {
                    getSettings().mode = radio.value;
                    persist();
                }
            });
        }

        dom.search?.addEventListener('input', () => renderList());

        root.querySelector('#orp-refresh')?.addEventListener('click', async ev => {
            const btn = ev.currentTarget;
            btn.disabled = true;
            setMsg(dom.dirty, '正在拉取官方目录…', '');
            try {
                const catalog = await loadCatalog({ force: true });
                await injectNativeSelects();
                renderStatus(catalog);
                await renderList();
                setMsg(dom.dirty, `目录已刷新：${catalog.items.length} 家`, 'ok');
            } catch (e) {
                setMsg(dom.dirty, '刷新失败：' + (e?.message ?? e), 'err');
            } finally {
                btn.disabled = false;
            }
        });

        const slugAddFn = () => {
            const input = $id('orp-slug-input');
            const slugs = String(input?.value ?? '').split(/[\s,，;；]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
            if (!slugs.length) { setMsg(dom.dirty, '先输入要添加的 slug', 'err'); return; }
            const s = getSettings();
            let added = 0;
            for (const slug of slugs) {
                if (!s.providers.includes(slug)) { s.providers.push(slug); added++; }
            }
            input.value = '';
            if (dom.search) dom.search.value = ''; // 清掉搜索过滤，保证新项立刻可见
            persist();
            renderList();
            setMsg(dom.dirty, added ? `已添加 ${added} 家` : '这些 slug 已在列表里', added ? 'ok' : '');
            if (added) toastMsg(`已添加 ${added} 家提供商`, 'success');
        };
        root.querySelector('#orp-slug-add')?.addEventListener('click', slugAddFn);
        $id('orp-slug-input')?.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); slugAddFn(); }
        });

        root.querySelector('#orp-save')?.addEventListener('click', () => {
            const { rules, errors } = collectRulesFromCards();
            if (errors.length) {
                setMsg(dom.rulesMsg, errors[0], 'err');
                return;
            }
            const check = validateRules(rules);
            if (!check.ok) {
                setMsg(dom.rulesMsg, check.error, 'err');
                return;
            }
            getSettings().modelRules = check.rules;
            getSettings().patchTextCompletion = Boolean(dom.textPatch?.checked);
            persist();
            setMsg(dom.rulesMsg, '', '');
            setMsg(dom.dirty, '已保存', 'ok');
            toastMsg('上游围栏设置已保存', 'success');
            injectNativeSelects();
        });

        root.querySelector('#orp-rule-add')?.addEventListener('click', () => {
            const host = document.querySelector('#orp-rules-cards');
            if (!host) return;
            const card = buildRuleCard({ mode: 'inherit' });
            host.append(card);
            card.querySelector('.orp-rule-pattern')?.focus();
            markDirty('已添加一条规则，填好后点“保存设置”');
        });

        root.querySelector('#orp-clear')?.addEventListener('click', () => {
            getSettings().providers = [];
            persist();
            renderList();
            setMsg(dom.dirty, '已清空全局提供商列表', 'ok');
        });

        dom.textPatch?.addEventListener('change', () => {
            getSettings().patchTextCompletion = Boolean(dom.textPatch.checked);
            persist();
        });

        // ---- 跨设备迁移 ----
        root.querySelector('#orp-export')?.addEventListener('click', () => {
            const data = JSON.stringify(getSettings(), null, 2);
            if (dom.transfer) dom.transfer.value = data;
            copyText(data);
            setMsg(dom.dirty, '配置已导出并尝试复制到剪贴板', 'ok');
        });

        root.querySelector('#orp-copy')?.addEventListener('click', () => {
            copyText(dom.transfer?.value ?? '');
            setMsg(dom.dirty, '已复制', 'ok');
        });

        root.querySelector('#orp-import')?.addEventListener('click', () => {
            const text = String(dom.transfer?.value ?? '').trim();
            if (!text) { setMsg(dom.dirty, '导入框是空的', 'err'); return; }
            let data;
            try { data = JSON.parse(text); } catch (e) { setMsg(dom.dirty, 'JSON 解析失败: ' + e.message, 'err'); return; }
            if (!data || typeof data !== 'object' || Array.isArray(data)) { setMsg(dom.dirty, '配置必须是对象', 'err'); return; }

            const rulesCheck = validateRules(Array.isArray(data.modelRules) ? data.modelRules : []);
            if (!rulesCheck.ok) { setMsg(dom.dirty, '规则校验失败: ' + rulesCheck.error, 'err'); return; }

            const s = getSettings();
            if (typeof data.enabled === 'boolean') s.enabled = data.enabled;
            if (['order', 'only', 'off'].includes(data.mode)) s.mode = data.mode;
            if (Array.isArray(data.providers)) s.providers = data.providers.map(String);
            if (Array.isArray(data.quantizations)) s.quantizations = data.quantizations.map(String);
            if (Array.isArray(data.modelRules)) s.modelRules = data.modelRules;
            if (typeof data.patchTextCompletion === 'boolean') s.patchTextCompletion = data.patchTextCompletion;
            persist();
            syncFormFromSettings();
            renderQuantizationRow();
            renderList();
            setMsg(dom.dirty, '导入成功', 'ok');
            toastMsg('上游围栏配置已导入', 'success');
        });
    }

    function setMsg(el, text, cls) {
        if (!el) return;
        el.textContent = text;
        el.classList.remove('orp-ok', 'orp-err');
        if (cls === 'ok') el.classList.add('orp-ok');
        if (cls === 'err') el.classList.add('orp-err');
    }

    function copyText(text) {
        if (!text) return;
        if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
        } else {
            fallbackCopy(text);
        }
    }

    function fallbackCopy(text) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.append(ta);
        ta.select();
        try { document.execCommand('copy'); } catch { /* 忽略 */ }
        ta.remove();
    }

    async function mountPanel() {
        const ctx = SillyTavern.getContext();
        const host = document.querySelector('#extensions_settings2') ?? document.querySelector('#extensions_settings');
        if (!host) { console.warn('[ProviderCorral] 找不到扩展面板挂载点'); return; }

        for (const folder of PANEL_FOLDER_CANDIDATES) {
            try {
                const html = await ctx.renderExtensionTemplateAsync(folder, 'settings');
                // 防重复挂载（页面热重载时）
                host.querySelector('.orp-panel')?.remove();
                const holder = document.createElement('div');
                holder.innerHTML = html;
                const panel = holder.firstElementChild ?? holder;
                host.append(panel);
                bindPanel(panel);
                return;
            } catch (err) {
                console.debug(`[ProviderCorral] 模板 ${folder} 未命中，试下一个`, err?.message ?? '');
            }
        }
        console.warn('[ProviderCorral] 面板模板未在任何候选目录中找到');
    }

    // ======================= 生命周期 =======================

    async function bootstrap() {
        ensureFetchHook();
        try {
            await injectNativeSelects();
        } catch (err) {
            console.warn('[ProviderCorral] 原生下拉注入失败:', err);
        }
        await mountPanel();
        // 拉一次官方目录（异步，不阻塞面板；成功后补进原生下拉）
        loadCatalog().then(() => injectNativeSelects()).catch(() => { /* 已在 loadCatalog 内兜底 */ });
    }

    const ctx = SillyTavern.getContext();
    ctx.eventSource.on(ctx.event_types.APP_READY, bootstrap);
    // 切换聊天补全来源时 DOM 可能重建，重新注入原生下拉
    ctx.eventSource.on(ctx.event_types.CHATCOMPLETION_SOURCE_CHANGED, () => {
        injectNativeSelects().catch(() => { /* 忽略 */ });
        const list = dom.list;
        if (list) renderList().catch(() => { /* 忽略 */ });
    });
})();