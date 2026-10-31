# SillyTavern-Provider-Corral

English | [中文](README.md)

A per-model **corral** for your OpenRouter upstreams: each model matches its own rule and lands in a corral of approved providers — requests may only use providers inside the fence, **no fence-jumping**. Picking a single provider pins it hard (if it rate-limits or dies, the request fails rather than switching); picking two or more keeps traffic inside the corral and lets OpenRouter decide how to distribute it. The corral parameters are injected into every OpenRouter request as `provider.order` / `allow_fallbacks` / `provider.quantizations` — when a provider rate-limits, OpenRouter automatically moves to the next one in your order, and SillyTavern never notices.

Ships with a built-in snapshot of **117 providers** (pulled 2026-10-31), plus live refreshes of the official catalog — all the new homes missing from SillyTavern's hard-coded list are here.

## Features

- **Live official catalog**: pulls `https://openrouter.ai/api/v1/providers` with a 24-hour cache; on failure it falls back to the built-in snapshot with an "offline / not refreshed" badge and retries after 60 seconds (your existing selections are never lost).
- **Searchable checklist**: selected-count + one-click clear; selected providers float to the top with priority numbers and ↑↓ reordering; hand-add any slug missing from the catalog (out-of-catalog selections always stay visible; Enter works too).
- **Three routing modes**:
  - **Try in order** (`order` + `allow_fallbacks: true`) — the core anti-rate-limit switch: when the first provider throttles or dies, OpenRouter automatically moves down the list;
  - **Only listed providers** (`only` + `allow_fallbacks: false`) — nothing outside the list, ever;
  - **No injection** — keep SillyTavern's native "Model Providers" selection.
- **Quantization limits**: `provider.quantizations` (options are read dynamically from SillyTavern's native dropdown, so they always match your ST version).
- **Per-model rules (card-based editor)**: click "＋ Add rule" to configure each card — model match pattern + mode dropdown + that rule's own provider checklist (independent search / hand-written slugs / priority sorting / clear). Top-down, the first match wins; everything is saved in one go with "Save settings".
- **Native dropdown sync**: the full official catalog is appended to SillyTavern's built-in "Model Providers" dropdown (`#openrouter_providers_chat` / `#openrouter_providers_text`), so you can pick new providers even without opening this panel.
- **Cross-device migration**: one-click export / import of the configuration JSON — set it up on your PC, paste it into the phone (Termux) panel and you're done.
- **Text-completion side injection** (off by default): also covers `text-completions` requests; enable it only if you use OpenRouter in Text Completion mode.

## Installation

SillyTavern → top-right **Extensions** → **Install extension** → paste this repo's Git URL → **Install** (same steps on Termux):

```
https://github.com/Amices17/SillyTavern-Provider-Corral
```

After installation refresh the page; the panel lives in the **Extensions** settings area under the "OpenRouter 上游围栏" drawer. `auto_update: true`, so SillyTavern upgrades it automatically whenever the repo updates.

Manual install (development): copy this directory (with `manifest.json`) into
`public/scripts/extensions/third-party/SillyTavern-Provider-Corral/` (global, effective after refresh),
or `data/<username>/extensions/SillyTavern-Provider-Corral/` (per-user, requires a server restart).

> **Pick one**: don't install manually *and* via Git URL at the same time — the two copies would double-load. Delete the old directory before switching methods.

## Usage

1. Set the Chat Completion source to **OpenRouter** (a relay/proxy key stored in the OpenRouter key slot works too).
2. Open the panel → check the providers you want (order = priority) → keep the mode at **Try in order** → save.
3. From then on every OpenRouter request carries `provider: { order: [...], allow_fallbacks: true }` — rate limits are absorbed by OpenRouter itself instead of interrupting you.

Per-model rules: click "＋ Add rule" on the panel and fill each card. Field meanings (the exported config's `modelRules` is isomorphic):

```json
[
  { "pattern": "xiaomi/mimo*", "mode": "only", "providers": ["makora", "xiaomi"] },
  { "pattern": "anthropic/*", "mode": "order", "providers": ["anthropic", "claude-on-aws"] },
  { "pattern": "cheap-*", "mode": "off", "providers": [] }
]
```

- `pattern` is case-insensitive; with `*` it matches as a glob, without `*` it matches as a namespace prefix;
- `mode` is `inherit` (follow the global mode) / `only` / `order` / `off` (skip injection for this model);
- an empty `providers` list inherits the global list;
- when the global "Enable routing injection" toggle is off, every per-model rule is disabled as well (master switch).

## Privacy & Security

**No leakage risk — safe to keep the repo public and install via Git URL:**

- **Zero keys**: the extension never reads, stores, or transmits any API key; the OpenRouter provider catalog is an unauthenticated public endpoint.
- **The only external request**: `https://openrouter.ai/api/v1/providers` (official public catalog, plain HTTPS).
- **Zero telemetry**: no analytics, no trackers, no third-party domains.
- **What's stored**: provider slugs, mode toggles, and model rules only — all non-sensitive, saved in the extension settings section of your local `settings.json`, never propagated through Git.
- Open the browser console to audit every network request.

## How it works

The SillyTavern pipeline (release branch sources):

1. The frontend `public/scripts/openai.js` sends `generate_data.provider` / `use_fallback` when generating;
2. The backend OpenRouter branch in `src/endpoints/backends/chat-completions.js` assembles:
   ```js
   bodyParams['provider'] = {
       allow_fallbacks: request.body.allow_fallbacks ?? true,
       order: request.body.provider ?? [],
   };
   ```
3. This extension wraps `window.fetch` in the browser and rewrites the body of OpenRouter `chat-completions` requests (`provider` / `allow_fallbacks` / `quantizations`), and appends the official catalog to the native dropdown — no SillyTavern source modifications, no backend plugin required.

## Known limitations

- `service_tier` is not injected: the backend rebuilds the request body from a whitelist and drops unknown top-level fields, so browser-side injection alone has no effect.
- This extension only rewrites routing parameters; it does not participate in generation retries. Failover across *different API sources* (e.g. OpenRouter ↔ official DeepSeek) requires a connection-profile-level solution.
- If a SillyTavern upgrade changes endpoint paths or body field names, `GENERATE_URL_RE` and the field mapping in `index.js` need a matching tweak (`minimum_client_version` is pinned).

## License

MIT