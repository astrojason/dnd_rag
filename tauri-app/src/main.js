import { invoke } from '@tauri-apps/api/core';
import chevronLeftSvg from 'heroicons/24/outline/chevron-left.svg?raw';
import chevronRightSvg from 'heroicons/24/outline/chevron-right.svg?raw';
import userGroupSvg from 'heroicons/24/outline/user-group.svg?raw';
import storefrontSvg from 'heroicons/24/outline/building-storefront.svg?raw';
import sparklesSvg from 'heroicons/24/outline/sparkles.svg?raw';
import xMarkSvg from 'heroicons/24/outline/x-mark.svg?raw';
import bookmarkSvg from 'heroicons/24/outline/bookmark.svg?raw';
import checkCircleSvg from 'heroicons/24/outline/check-circle.svg?raw';

const API = 'http://127.0.0.1:8765';

let isQuerying = false;
let isIngesting = false;
let sourcesCollapsed = false;
let suggestions = [];
let _wasLoaded = false;

// ── Bootstrap ──────────────────────────────────────────────────────────
document.getElementById('app').innerHTML = `
  <header class="app-header">
    <div class="header-title" id="header-title">
      <span class="header-icon">⚔</span>
      <span class="header-name">Azorian's Bounty Oracle</span>
    </div>
    <div class="header-controls">
      <div class="status-badge">
        <div class="status-dot" id="status-dot"></div>
        <span id="status-text">Connecting...</span>
      </div>
      <button class="settings-btn" id="settings-btn" title="Settings">⚙</button>
    </div>
  </header>

  <div class="main-layout">
    <main class="chat-area">
      <div class="content-overlay" id="content-overlay">
        <div class="overlay-content">
          <div class="overlay-spinner"></div>
          <div class="overlay-text" id="overlay-text">Connecting to server...</div>
        </div>
      </div>

      <div class="messages" id="messages">
        <div class="welcome" id="welcome">
          <div class="welcome-rune">
            <svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg" class="oracle-svg">
              <!-- Outer glow ring -->
              <circle cx="40" cy="36" r="26" stroke="#c8972a" stroke-width="1" stroke-dasharray="4 3" opacity="0.5"/>
              <!-- Crystal ball -->
              <circle cx="40" cy="36" r="22" fill="url(#ballGrad)" stroke="#c8972a" stroke-width="1.5"/>
              <!-- Inner shimmer -->
              <ellipse cx="33" cy="28" rx="6" ry="4" fill="white" opacity="0.12" transform="rotate(-20 33 28)"/>
              <ellipse cx="35" cy="30" rx="2.5" ry="1.5" fill="white" opacity="0.18" transform="rotate(-20 35 30)"/>
              <!-- Mystical eye inside ball -->
              <ellipse cx="40" cy="36" rx="10" ry="6" fill="none" stroke="#c8972a" stroke-width="1" opacity="0.7"/>
              <circle cx="40" cy="36" r="3.5" fill="#c8972a" opacity="0.85"/>
              <circle cx="41.2" cy="34.8" r="1" fill="white" opacity="0.4"/>
              <!-- Stand -->
              <path d="M28 58 Q40 52 52 58" stroke="#c8972a" stroke-width="1.5" stroke-linecap="round" fill="none"/>
              <path d="M32 58 L30 64 Q40 61 50 64 L48 58" fill="#0f0f1a" stroke="#c8972a" stroke-width="1" stroke-linejoin="round"/>
              <!-- Rays -->
              <line x1="40" y1="8"  x2="40" y2="3"  stroke="#c8972a" stroke-width="1" stroke-linecap="round" opacity="0.4"/>
              <line x1="58" y1="14" x2="61" y2="10" stroke="#c8972a" stroke-width="1" stroke-linecap="round" opacity="0.4"/>
              <line x1="68" y1="32" x2="73" y2="31" stroke="#c8972a" stroke-width="1" stroke-linecap="round" opacity="0.4"/>
              <line x1="22" y1="14" x2="19" y2="10" stroke="#c8972a" stroke-width="1" stroke-linecap="round" opacity="0.4"/>
              <line x1="12" y1="32" x2="7"  y2="31" stroke="#c8972a" stroke-width="1" stroke-linecap="round" opacity="0.4"/>
              <defs>
                <radialGradient id="ballGrad" cx="38%" cy="35%" r="60%">
                  <stop offset="0%"   stop-color="#1a1a40"/>
                  <stop offset="60%"  stop-color="#0a0a20"/>
                  <stop offset="100%" stop-color="#050510"/>
                </radialGradient>
              </defs>
            </svg>
          </div>
          <div class="welcome-title">The Oracle Awaits</div>
          <div class="welcome-subtitle">Ask anything about Azorian's Bounty — lore, characters, locations, events. Answers are drawn only from your campaign notes.</div>
          <div class="welcome-examples" id="welcome-chips">
            <div class="chips-loading">Generating suggestions…</div>
          </div>
        </div>
      </div>

      <div class="sources-bar" id="sources-bar" style="display:none">
        <div class="sources-header" id="sources-toggle-btn">
          <div class="sources-title">
            Sources
            <span class="sources-count" id="sources-count">0</span>
          </div>
          <span class="sources-toggle">▲</span>
        </div>
        <div class="sources-scroll-wrap">
          <button class="sources-nav-btn" id="sources-prev" aria-label="Scroll left"></button>
          <div class="sources-list" id="sources-list"></div>
          <button class="sources-nav-btn" id="sources-next" aria-label="Scroll right"></button>
        </div>
      </div>

      <div class="input-area">
        <div class="input-container">
          <textarea
            id="query-input"
            class="query-input"
            placeholder="Ask the Oracle..."
            rows="1"
            disabled
          ></textarea>
          <button class="send-btn" id="send-btn" disabled title="Send (Enter)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"></line>
              <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
            </svg>
          </button>
        </div>
      </div>
    </main>

    <aside class="sidebar">
      <div class="sidebar-top">
        <div class="sidebar-section-title">Oracle Index</div>
        <div class="index-card">
          <div class="index-status-row">
            <div class="status-dot" id="index-dot"></div>
            <span class="index-status-label" id="index-label">Connecting...</span>
          </div>
          <div class="index-doc-count" id="index-doc-count"></div>
          <div class="index-last-ingest" id="index-last-ingest"></div>
          <div class="index-error" id="index-error" style="display:none">
            <span id="index-error-text"></span>
            <button class="error-details-btn" id="index-error-details-btn" style="display:none">Details</button>
          </div>
        </div>
      </div>
      <div class="token-section">
        <div class="sidebar-section-title">Daily Tokens</div>
        <div class="token-bar-track">
          <div class="token-bar-fill" id="token-bar"></div>
        </div>
        <div class="token-bar-label" id="token-label">— / 250,000</div>
      </div>
      <div class="sidebar-tools">
        <div class="sidebar-section-title">Tools</div>
        <button class="tool-btn" id="tool-npc-btn">
          <span class="tool-btn-icon" id="tool-npc-icon"></span>
          Generate NPCs
        </button>
        <button class="tool-btn" id="tool-shop-btn">
          <span class="tool-btn-icon" id="tool-shop-icon"></span>
          Generate Shops
        </button>
      </div>
    </aside>
  </div>

  <div class="modal-overlay" id="npc-modal" style="display:none">
    <div class="modal modal-tool">
      <div class="tool-modal-header">
        <div class="tool-modal-title-row">
          <span class="tool-modal-icon" id="npc-modal-icon"></span>
          <span class="modal-title" style="margin-bottom:0">NPC Generator</span>
        </div>
        <button class="modal-x-btn" id="npc-modal-close"></button>
      </div>
      <div class="tool-form">
        <div class="tool-field">
          <label class="tool-label">Location</label>
          <select class="tool-select" id="npc-location-select">
            <option value="">— no location seed —</option>
          </select>
        </div>
        <div class="tool-field tool-field-inline">
          <label class="tool-label">Count</label>
          <input class="tool-input-num" id="npc-count" type="number" value="10" min="1" max="20">
        </div>
        <button class="btn btn-primary tool-generate-btn" id="npc-generate-btn">
          <span id="npc-generate-icon"></span>
          Generate
        </button>
      </div>
      <div class="tool-results" id="npc-results" style="display:none">
        <div class="tool-results-scroll">
          <div class="npc-stream-pre" id="npc-stream-pre"></div>
          <div class="npc-cards" id="npc-cards" style="display:none"></div>
        </div>
      </div>
    </div>
  </div>

  <div class="modal-overlay" id="shop-modal" style="display:none">
    <div class="modal modal-tool">
      <div class="tool-modal-header">
        <div class="tool-modal-title-row">
          <span class="tool-modal-icon" id="shop-modal-icon"></span>
          <span class="modal-title" style="margin-bottom:0">Shop Generator</span>
        </div>
        <button class="modal-x-btn" id="shop-modal-close"></button>
      </div>
      <div class="tool-form">
        <div class="tool-field">
          <label class="tool-label">Location</label>
          <select class="tool-select" id="shop-location-select">
            <option value="">— no location seed —</option>
          </select>
        </div>
        <button class="btn btn-primary tool-generate-btn" id="shop-generate-btn">
          <span id="shop-generate-icon"></span>
          Generate
        </button>
      </div>
      <div class="tool-results" id="shop-results" style="display:none">
        <div class="tool-results-scroll">
          <div class="npc-stream-pre" id="shop-stream-pre"></div>
          <div class="npc-cards" id="shop-cards" style="display:none"></div>
        </div>
      </div>
    </div>
  </div>

  <div class="modal-overlay" id="shop-save-modal" style="display:none">
    <div class="modal" style="max-width:480px">
      <div class="modal-title">Save Shop — Choose Location</div>
      <div class="tool-field" style="margin-bottom:8px">
        <label class="tool-label">Location</label>
        <select class="tool-select" id="shop-save-location" size="1" style="width:100%">
          <option value="">Loading locations…</option>
        </select>
      </div>
      <div class="shop-save-npc-note" id="shop-save-npc-note"></div>
      <div class="modal-actions" style="margin-top:20px">
        <button class="btn btn-ghost" id="shop-save-cancel">Cancel</button>
        <button class="btn btn-primary" id="shop-save-confirm">Save</button>
      </div>
    </div>
  </div>

  <div class="modal-overlay" id="settings-modal" style="display:none">
    <div class="modal modal-settings">
      <div class="modal-title">Settings</div>
      <div class="settings-section">
        <div class="settings-section-label">Index Vault</div>
        <label class="rebuild-toggle" style="margin-bottom:12px; display:flex">
          <input type="checkbox" id="rebuild-checkbox">
          Full rebuild (clears existing index)
        </label>
        <button class="btn btn-primary" id="reindex-btn" style="width:100%">⟳ Re-index Vault</button>
      </div>
      <div class="ingest-log" id="ingest-log" style="display:none; max-height:260px; overflow-y:auto; margin-top:12px">
        <div class="ingest-log-title">Progress</div>
        <div class="ingest-log-entries" id="ingest-entries"></div>
      </div>
      <div class="modal-actions" style="margin-top:16px">
        <button class="btn btn-ghost" id="settings-close">Close</button>
      </div>
    </div>
  </div>

  <div class="modal-overlay" id="error-modal" style="display:none">
    <div class="modal modal-wide">
      <div class="modal-title">Index Error</div>
      <pre class="error-detail-pre" id="error-detail-pre"></pre>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="error-modal-close">Close</button>
      </div>
    </div>
  </div>

  <div class="modal-overlay" id="limit-modal" style="display:none">
    <div class="modal">
      <div class="modal-icon">⚠</div>
      <div class="modal-title">Daily Limit Reached</div>
      <div class="modal-body" id="modal-body"></div>
      <div class="modal-bar-track">
        <div class="modal-bar-fill" id="modal-bar"></div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="modal-cancel">Cancel</button>
        <button class="btn btn-primary" id="modal-confirm">Proceed Anyway</button>
      </div>
    </div>
  </div>
`;

// ── DOM refs (resolved after innerHTML set) ────────────────────────────
const queryInput   = document.getElementById('query-input');
const sendBtn      = document.getElementById('send-btn');
const reindexBtn   = document.getElementById('reindex-btn');
const messagesEl   = document.getElementById('messages');
const sourcesBar   = document.getElementById('sources-bar');
const sourcesList  = document.getElementById('sources-list');
const sourcesCount = document.getElementById('sources-count');
const sourcesToggleBtn = document.getElementById('sources-toggle-btn');
const ingestLog    = document.getElementById('ingest-log');
const ingestEntries = document.getElementById('ingest-entries');

const DAILY_LIMIT = 250_000;

// ── Sources nav buttons ────────────────────────────────────────────────
const sourcesPrev = document.getElementById('sources-prev');
const sourcesNext = document.getElementById('sources-next');
sourcesPrev.innerHTML = chevronLeftSvg;
sourcesNext.innerHTML = chevronRightSvg;

function scrollSources(dir) {
  const list = document.getElementById('sources-list');
  list.scrollBy({ left: dir * 240, behavior: 'smooth' });
}
sourcesPrev.addEventListener('click', () => scrollSources(-1));
sourcesNext.addEventListener('click', () => scrollSources(1));

// ── Tools ──────────────────────────────────────────────────────────────
document.getElementById('tool-npc-icon').innerHTML  = userGroupSvg;
document.getElementById('tool-shop-icon').innerHTML = storefrontSvg;
document.getElementById('npc-modal-icon').innerHTML  = userGroupSvg;
document.getElementById('npc-modal-close').innerHTML = xMarkSvg;
document.getElementById('npc-generate-icon').innerHTML = sparklesSvg;
document.getElementById('shop-modal-icon').innerHTML  = storefrontSvg;
document.getElementById('shop-modal-close').innerHTML = xMarkSvg;
document.getElementById('shop-generate-icon').innerHTML = sparklesSvg;

// Open / close
document.getElementById('tool-npc-btn').addEventListener('click', () => {
  document.getElementById('npc-modal').style.display = 'flex';
  loadLocations('npc-location-select', 'npc-generate-btn');
});
document.getElementById('npc-modal-close').addEventListener('click', () => {
  document.getElementById('npc-modal').style.display = 'none';
});
document.getElementById('tool-shop-btn').addEventListener('click', () => {
  document.getElementById('shop-modal').style.display = 'flex';
  loadLocations('shop-location-select', 'shop-generate-btn');
});
document.getElementById('shop-modal-close').addEventListener('click', () => {
  document.getElementById('shop-modal').style.display = 'none';
});

// ── World locations cache ───────────────────────────────────────────────
let _worldLocations = null;

async function loadWorldLocations() {
  if (_worldLocations) return _worldLocations;
  const res = await fetch(`${API}/locations/world`);
  const { locations } = await res.json();
  _worldLocations = locations;
  return locations;
}

function promptShopLocation(npcNames) {
  return new Promise(async (resolve) => {
    const modal   = document.getElementById('shop-save-modal');
    const select  = document.getElementById('shop-save-location');
    const note    = document.getElementById('shop-save-npc-note');
    const confirm = document.getElementById('shop-save-confirm');
    const cancel  = document.getElementById('shop-save-cancel');

    select.innerHTML = '<option value="">Loading…</option>';
    confirm.disabled = true;
    modal.style.display = 'flex';

    // Show NPC creation note
    note.textContent = npcNames.length
      ? `Will also create Minor NPC ${npcNames.length > 1 ? 'files' : 'file'} for: ${npcNames.join(', ')}`
      : '';

    try {
      const locs = await loadWorldLocations();
      select.innerHTML = '<option value="">— choose a location —</option>'
        + locs.map(l =>
            `<option value="${encodeURIComponent(JSON.stringify({ folder: l.folder_path, name: l.name }))}">${escapeHtml(l.display_name)}</option>`
          ).join('');
    } catch {
      select.innerHTML = '<option value="">Failed to load locations</option>';
    }

    select.addEventListener('change', () => {
      confirm.disabled = !select.value;
    });

    const cleanup = () => {
      modal.style.display = 'none';
      confirm.removeEventListener('click', onConfirm);
      cancel.removeEventListener('click', onCancel);
    };
    const onConfirm = () => {
      if (!select.value) return;
      const loc = JSON.parse(decodeURIComponent(select.value));
      cleanup();
      resolve(loc);
    };
    const onCancel = () => { cleanup(); resolve(null); };

    confirm.addEventListener('click', onConfirm);
    cancel.addEventListener('click', onCancel);
  });
}

function parseProprietorNames(text) {
  if (!text) return [];
  const namesPart = text.split(/\s*[—–]\s*/)[0].trim();
  return namesPart.split(/\s+and\s+/i).map(n => n.trim()).filter(Boolean);
}

// ── Card save (event delegation) ────────────────────────────────────────
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.card-save-btn');
  if (!btn || btn.dataset.saved) return;

  const data = JSON.parse(decodeURIComponent(btn.dataset.save));
  btn.disabled = true;

  try {
    let endpoint, payload;

    if (data.kind === 'npc') {
      endpoint = '/save/npc';
      payload  = {
        name: data.name, pronunciation: data.pronunciation,
        race: data.race, gender: data.gender,
        appearance: data.appearance, characteristics: data.characteristics,
        location_name: data.location_name, npc_type: 'Minor',
      };
    } else {
      // Shop: prompt for location first
      const npcNames = (data.npcs || []).map(n => n.name);
      const loc = await promptShopLocation(npcNames);
      if (!loc) { btn.disabled = false; return; }

      endpoint = '/save/shop';
      payload  = {
        name: data.name, shop_type: data.shop_type,
        description: data.description, inventory: data.inventory,
        location_name: loc.name, location_folder_path: loc.folder,
        npcs: data.npcs || [],
      };
    }

    const res    = await fetch(`${API}${endpoint}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await res.json();

    if (result.success) {
      btn.innerHTML = checkCircleSvg;
      btn.classList.add('saved');
      btn.dataset.saved = '1';
      btn.title = result.npc_paths?.length
        ? `Saved to vault + ${result.npc_paths.length} NPC file(s) created`
        : 'Saved to vault';
    } else {
      showToast(`Save failed: ${result.error}`);
      btn.disabled = false;
    }
  } catch (err) {
    showToast(`Save failed: ${err.message}`);
    btn.disabled = false;
  }
});

let _locationsCache = null;

async function loadLocations(selectId, btnId) {
  const select = document.getElementById(selectId);
  const btn    = document.getElementById(btnId);
  if (_locationsCache) {
    populateSelect(select, btn, _locationsCache);
    return;
  }
  select.innerHTML = '<option value="">Loading locations…</option>';
  btn.disabled = true;
  try {
    const res  = await fetch(`${API}/locations`);
    const data = await res.json();
    _locationsCache = data.locations;
    populateSelect(select, btn, _locationsCache);
  } catch {
    select.innerHTML = '<option value="">Failed to load locations</option>';
  }
}

function populateSelect(select, btn, locations) {
  select.innerHTML = '<option value="">— no location seed —</option>'
    + locations.map(l =>
        `<option value="${l.path.replace(/"/g, '&quot;')}" data-name="${l.name.replace(/"/g, '&quot;')}">${escapeHtml(l.name)}</option>`
      ).join('');
  btn.disabled = false;
}

// ── NPC generation ──────────────────────────────────────────────────────
function renderNpcCards(text, locationName = '') {
  const blocks = text.trim().split(/\n{2,}/);
  return blocks.map(block => {
    const npc = parseNpcBlock(block);
    if (!npc) return '';
    return renderNpcCardHtml(npc, locationName, true);
  }).filter(Boolean).join('');
}

document.getElementById('npc-generate-btn').addEventListener('click', async () => {
  const select = document.getElementById('npc-location-select');
  const selectedOpt = select.options[select.selectedIndex];

  const locationPath = select.value || '';
  const locationName = select.value ? (selectedOpt.dataset.name || selectedOpt.text) : '';
  const count = parseInt(document.getElementById('npc-count').value, 10) || 10;

  const generateBtn = document.getElementById('npc-generate-btn');
  const results     = document.getElementById('npc-results');
  const streamPre   = document.getElementById('npc-stream-pre');
  const cards       = document.getElementById('npc-cards');

  generateBtn.disabled = true;
  results.style.display = 'block';
  streamPre.style.display = 'block';
  streamPre.textContent = '';
  cards.style.display = 'none';
  cards.innerHTML = '';

  let fullText = '';
  try {
    const res = await fetch(`${API}/generate/npcs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ location_name: locationName, location_path: locationPath, count }),
    });
    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const data = JSON.parse(line.slice(6));
          if (data.token) {
            fullText += data.token;
            streamPre.textContent = fullText;
            streamPre.scrollTop = streamPre.scrollHeight;
          } else if (data.done) {
            streamPre.style.display = 'none';
            cards.innerHTML = renderNpcCards(fullText, locationName);
            cards.style.display = 'block';
          } else if (data.error) {
            streamPre.textContent = `Error: ${data.error}`;
          }
        } catch { /* ignore */ }
      }
    }
  } catch (e) {
    streamPre.textContent = `Connection error: ${e.message}`;
  } finally {
    generateBtn.disabled = false;
  }
});

// ── Shop generation ─────────────────────────────────────────────────────
function parseNpcBlock(block) {
  const lines = block.trim().split('\n');
  const titleMatch = lines[0]?.match(/^\*\*(.+?)\*\*\s*\((.+?)\)\s*$/);
  if (!titleMatch) return null;
  const name          = titleMatch[1];
  const pronunciation = titleMatch[2];
  const metaLine      = lines.find(l => l.startsWith('- Race:'))?.replace('- Race:', '').trim() ?? '';
  const appearance    = lines.find(l => l.startsWith('- Appearance:'))?.replace('- Appearance:', '').trim() ?? '';
  const traits        = lines.find(l => l.startsWith('- Characteristics:'))?.replace('- Characteristics:', '').trim() ?? '';
  const parts  = metaLine.split('|');
  const race   = parts[0]?.trim() ?? '';
  const gender = parts[1]?.replace('Gender:', '').trim() ?? '';
  return { name, pronunciation, race, gender, appearance, characteristics: traits };
}

function renderNpcCardHtml(npc, locationName, standalone = false) {
  const metaLine = [npc.race, npc.gender ? `Gender: ${npc.gender}` : ''].filter(Boolean).join(' | ');
  const saveData = encodeURIComponent(JSON.stringify({
    kind: 'npc', name: npc.name, pronunciation: npc.pronunciation,
    race: npc.race, gender: npc.gender, appearance: npc.appearance,
    characteristics: npc.characteristics, location_name: locationName,
  }));
  return `
    <div class="npc-card${standalone ? '' : ' npc-card-inline'}">
      <div class="npc-card-header">
        <div class="npc-name">${escapeHtml(npc.name)}<span class="npc-pronunciation">${escapeHtml(npc.pronunciation)}</span></div>
        <button class="card-save-btn" data-save="${saveData}" title="Save to vault">${bookmarkSvg}</button>
      </div>
      ${metaLine     ? `<div class="npc-meta">${escapeHtml(metaLine)}</div>` : ''}
      ${npc.appearance    ? `<div class="npc-appearance"><span class="npc-field-label">Appearance</span> ${escapeHtml(npc.appearance)}</div>` : ''}
      ${npc.characteristics ? `<div class="npc-traits"><span class="npc-field-label">Characteristics</span> ${escapeHtml(npc.characteristics)}</div>` : ''}
    </div>`;
}

function renderShopCards(text, locationName = '') {
  // Split on --- separator (with surrounding whitespace/newlines)
  const blocks = text.trim().split(/\n\s*---\s*\n/);
  return blocks.map(block => {
    block = block.trim();
    if (!block) return '';

    // Split off Proprietors section
    const propSplit = block.split(/\nProprietors:\n/i);
    const shopPart  = propSplit[0];
    const npcPart   = propSplit[1] ?? '';

    const lines = shopPart.trim().split('\n');
    const titleMatch = lines[0]?.match(/^\*\*(.+?)\*\*(?:\s*\((.+?)\))?\s*$/);
    if (!titleMatch) return '';

    const name        = titleMatch[1];
    const shopType    = titleMatch[2] ?? '';
    const description = lines.find(l => l.startsWith('- Description:'))?.replace('- Description:', '').trim() ?? '';
    const inventory   = lines.find(l => l.startsWith('- Inventory:'))?.replace('- Inventory:', '').trim() ?? '';

    // Parse NPC blocks from the Proprietors section
    const npcs = npcPart
      ? npcPart.trim().split(/\n{2,}/).map(parseNpcBlock).filter(Boolean)
      : [];

    const saveData = encodeURIComponent(JSON.stringify({
      kind: 'shop', name, shop_type: shopType, description, inventory,
      location_name: locationName, npcs,
    }));

    const npcCardsHtml = npcs.map(npc => renderNpcCardHtml(npc, locationName)).join('');

    return `
      <div class="npc-card">
        <div class="npc-card-header">
          <div class="npc-name">${escapeHtml(name)}${shopType ? `<span class="npc-pronunciation">${escapeHtml(shopType)}</span>` : ''}</div>
          <button class="card-save-btn" data-save="${saveData}" title="Save to vault">${bookmarkSvg}</button>
        </div>
        ${description ? `<div class="shop-row"><span class="npc-field-label">Description</span> ${escapeHtml(description)}</div>` : ''}
        ${inventory   ? `<div class="shop-row"><span class="npc-field-label">Inventory</span> ${escapeHtml(inventory)}</div>` : ''}
        ${npcCardsHtml ? `<div class="shop-proprietors-label">Proprietors</div>${npcCardsHtml}` : ''}
      </div>`;
  }).filter(Boolean).join('');
}

document.getElementById('shop-generate-btn').addEventListener('click', async () => {
  const select = document.getElementById('shop-location-select');
  const selectedOpt = select.options[select.selectedIndex];
  if (!select.value) return;

  const locationPath = select.value;
  const locationName = selectedOpt.dataset.name || selectedOpt.text;

  const generateBtn = document.getElementById('shop-generate-btn');
  const results     = document.getElementById('shop-results');
  const streamPre   = document.getElementById('shop-stream-pre');
  const cards       = document.getElementById('shop-cards');

  generateBtn.disabled = true;
  results.style.display = 'block';
  streamPre.style.display = 'block';
  streamPre.textContent = '';
  cards.style.display = 'none';
  cards.innerHTML = '';

  let fullText = '';
  try {
    const res = await fetch(`${API}/generate/shops`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ location_name: locationName, location_path: locationPath }),
    });
    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const data = JSON.parse(line.slice(6));
          if (data.token) {
            fullText += data.token;
            streamPre.textContent = fullText;
            streamPre.scrollTop = streamPre.scrollHeight;
          } else if (data.done) {
            streamPre.style.display = 'none';
            cards.innerHTML = renderShopCards(fullText, locationName);
            cards.style.display = 'block';
          } else if (data.error) {
            streamPre.textContent = `Error: ${data.error}`;
          }
        } catch { /* ignore */ }
      }
    }
  } catch (e) {
    streamPre.textContent = `Connection error: ${e.message}`;
  } finally {
    generateBtn.disabled = false;
  }
});

// ── Welcome screen helpers ─────────────────────────────────────────────
const _welcomeHtml = document.getElementById('welcome').outerHTML;

function updateChips(chips) {
  const container = document.getElementById('welcome-chips');
  if (!container) return;
  if (!chips || chips.length === 0) {
    container.innerHTML = '<div class="chips-loading">Generating suggestions…</div>';
    return;
  }
  container.innerHTML = chips
    .map(q => `<div class="example-chip" data-q="${q.replace(/"/g, '&quot;')}">${escapeHtml(q)}</div>`)
    .join('');
  attachChipListeners();
}

function attachChipListeners() {
  document.querySelectorAll('.example-chip').forEach((chip) => {
    chip.addEventListener('click', () => sendQuery(chip.dataset.q));
  });
}

function resetToWelcome() {
  messagesEl.innerHTML = _welcomeHtml;
  updateChips(suggestions);
  sourcesBar.style.display = 'none';
  sourcesList.innerHTML = '';
}

document.getElementById('header-title').addEventListener('click', resetToWelcome);

async function fetchSuggestions() {
  try {
    const res = await fetch(`${API}/suggest`);
    if (!res.ok) return;
    const { questions } = await res.json();
    if (Array.isArray(questions) && questions.length > 0) {
      suggestions = questions;
      updateChips(suggestions);
    }
  } catch {
    // fail silently — chips stay in loading state
  }
}

// ── Token tracking ─────────────────────────────────────────────────────
function updateTokenDisplay(used) {
  const pct = Math.min(used / DAILY_LIMIT, 1);
  const bar = document.getElementById('token-bar');
  const label = document.getElementById('token-label');
  bar.style.width = `${(pct * 100).toFixed(1)}%`;
  bar.className = 'token-bar-fill' + (pct >= 1 ? ' over-limit' : pct >= 0.8 ? ' near-limit' : '');
  label.textContent = `${used.toLocaleString()} / ${DAILY_LIMIT.toLocaleString()}`;
  label.className = 'token-bar-label' + (pct >= 1 ? ' over-limit' : pct >= 0.8 ? ' near-limit' : '');
}

async function refreshTokens() {
  try {
    const res = await fetch(`${API}/tokens`);
    const { used } = await res.json();
    updateTokenDisplay(used);
    return used;
  } catch {
    return 0;
  }
}

function showErrorModal(errorText) {
  document.getElementById('error-detail-pre').textContent = errorText;
  document.getElementById('error-modal').style.display = 'flex';
}

document.getElementById('error-modal-close').addEventListener('click', () => {
  document.getElementById('error-modal').style.display = 'none';
});

document.getElementById('settings-btn').addEventListener('click', () => {
  document.getElementById('settings-modal').style.display = 'flex';
});
document.getElementById('settings-close').addEventListener('click', () => {
  document.getElementById('settings-modal').style.display = 'none';
});

/** Shows the limit modal. Resolves true if user clicks Proceed, false if Cancel. */
function confirmLimitModal(used) {
  return new Promise((resolve) => {
    const modal = document.getElementById('limit-modal');
    const body  = document.getElementById('modal-body');
    const bar   = document.getElementById('modal-bar');
    const pct   = Math.min(used / DAILY_LIMIT, 1);

    body.textContent = `You've used ${used.toLocaleString()} of ${DAILY_LIMIT.toLocaleString()} tokens today. Queries may still work if the tracker is behind, but you are at or over the daily limit.`;
    bar.style.width = `${(pct * 100).toFixed(1)}%`;

    modal.style.display = 'flex';

    const onConfirm = () => { cleanup(); resolve(true); };
    const onCancel  = () => { cleanup(); resolve(false); };

    function cleanup() {
      modal.style.display = 'none';
      document.getElementById('modal-confirm').removeEventListener('click', onConfirm);
      document.getElementById('modal-cancel').removeEventListener('click', onCancel);
    }

    document.getElementById('modal-confirm').addEventListener('click', onConfirm);
    document.getElementById('modal-cancel').addEventListener('click', onCancel);
  });
}

// ── Toast notifications ────────────────────────────────────────────────
function showToast(message, type = 'error') {
  const existing = document.getElementById('toast');
  if (existing) existing.remove();
  const el = document.createElement('div');
  el.id = 'toast';
  el.className = `toast toast-${type}`;
  el.textContent = message;
  document.getElementById('app').appendChild(el);
  requestAnimationFrame(() => el.classList.add('toast-visible'));
  setTimeout(() => { el.classList.remove('toast-visible'); setTimeout(() => el.remove(), 300); }, 5000);
}

// ── Status polling ─────────────────────────────────────────────────────
let _lastErrorText = null;

async function checkStatus() {
  let delay = 3000;
  try {
    const res  = await fetch(`${API}/status`);
    const data = await res.json();
    updateStatus(data);
    delay = data.loaded ? 10000 : 2000;
  } catch {
    updateStatus({ loaded: false, loading: false, error: 'offline' });
  }
  setTimeout(checkStatus, delay);
}

function updateStatus(data) {
  const dot             = document.getElementById('status-dot');
  const text            = document.getElementById('status-text');
  const indexDot        = document.getElementById('index-dot');
  const indexLabel      = document.getElementById('index-label');
  const indexCount      = document.getElementById('index-doc-count');
  const indexLastIngest = document.getElementById('index-last-ingest');
  const indexError      = document.getElementById('index-error');
  const overlay         = document.getElementById('content-overlay');
  const overlayText     = document.getElementById('overlay-text');

  if (data.error === 'offline') {
    dot.className          = 'status-dot offline';
    text.textContent       = 'Server offline';
    indexDot.className     = 'status-dot offline';
    indexLabel.textContent = 'Disconnected';
    indexCount.textContent = '';
    indexError.style.display = 'none';
    overlay.style.display = 'flex';
    overlayText.textContent = 'Server offline';
    return;
  }

  if (data.loaded) {
    overlay.style.display = 'none';
    if (!_wasLoaded) { _wasLoaded = true; fetchSuggestions(); }
    dot.className          = 'status-dot loaded';
    text.textContent       = 'Ready';
    indexDot.className     = 'status-dot loaded';
    indexLabel.textContent = 'Index loaded';
    indexCount.textContent = `${data.doc_count.toLocaleString()} chunks`;
    indexLastIngest.textContent = data.last_ingest
      ? `Indexed ${new Date(data.last_ingest).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`
      : 'Never indexed';
    indexError.style.display = 'none';
    _lastErrorText = null;
    if (!isQuerying && !isIngesting) {
      sendBtn.disabled    = false;
      queryInput.disabled = false;
    }
    reindexBtn.disabled = false;
  } else if (data.loading) {
    overlay.style.display = 'flex';
    dot.className          = 'status-dot loading';
    text.textContent       = 'Loading...';
    indexDot.className     = 'status-dot loading';
    indexLabel.textContent = 'Loading index...';
    const elapsed = data.loading_elapsed != null
      ? ` (${data.loading_elapsed < 60 ? data.loading_elapsed + 's' : Math.floor(data.loading_elapsed / 60) + 'm ' + (data.loading_elapsed % 60) + 's'})`
      : '';
    indexCount.textContent = (data.loading_step ?? '') + elapsed;
    overlayText.textContent = (data.loading_step ?? 'Loading index...') + elapsed;
    indexError.style.display = 'none';
  } else if (data.error) {
    overlay.style.display = 'none';
    dot.className          = 'status-dot error';
    text.textContent       = 'Error';
    indexDot.className     = 'status-dot error';
    indexLabel.textContent = 'Index error';
    indexError.style.display = 'block';
    document.getElementById('index-error-text').textContent =
      data.error.length > 80 ? data.error.slice(0, 80) + '…' : data.error;
    const detailsBtn = document.getElementById('index-error-details-btn');
    detailsBtn.style.display = 'inline';
    detailsBtn.onclick = () => showErrorModal(data.error);
    // Re-enable controls so the user can retry re-indexing
    reindexBtn.disabled = false;
    if (!isQuerying) {
      sendBtn.disabled    = false;
      queryInput.disabled = false;
    }
    // Surface new errors as a toast (once per unique error)
    if (data.error !== _lastErrorText) {
      _lastErrorText = data.error;
      showToast(`Index error: ${data.error.length > 60 ? data.error.slice(0, 60) + '… (click Details)' : data.error}`);
      // Also append to the ingest log if it's open
      if (ingestLog.style.display !== 'none') {
        const el = document.createElement('div');
        el.className = 'ingest-log-entry error';
        el.textContent = `Reload failed: ${data.error}`;
        ingestEntries.appendChild(el);
        ingestLog.scrollTop = ingestLog.scrollHeight;
      }
    }
  }
}

// ── Message rendering ──────────────────────────────────────────────────
function addMessage(role, text, id = null, typing = false) {
  const welcome = document.getElementById('welcome');
  if (welcome) welcome.remove();

  const div = document.createElement('div');
  div.className = `message ${role}`;
  if (id) div.id = id;

  const label = role === 'user' ? 'You' : '⚔ The Oracle';

  div.innerHTML = `
    <div class="message-inner">
      <div class="message-label">${label}</div>
      ${typing
        ? `<div class="typing-indicator"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>`
        : `<div class="message-text">${escapeHtml(text)}</div>`
      }
    </div>
  `;

  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return div;
}

function updateMessage(id, text, isError = false) {
  const el = document.getElementById(id);
  if (!el) return;
  const inner = el.querySelector('.message-inner');
  const typing = inner.querySelector('.typing-indicator');
  if (typing) typing.remove();
  let textEl = inner.querySelector('.message-text');
  if (!textEl) {
    textEl = document.createElement('div');
    textEl.className = 'message-text';
    inner.appendChild(textEl);
  }
  textEl.style.color = isError ? '#c04040' : '';
  textEl.textContent = text;
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;');
}

// ── Query ──────────────────────────────────────────────────────────────
async function sendQuery(question) {
  if (isQuerying || !question.trim()) return;

  // ── Pre-flight token check ──────────────────────────────────────────
  const used = await refreshTokens();
  if (used >= DAILY_LIMIT) {
    const proceed = await confirmLimitModal(used);
    if (!proceed) return;
  }

  isQuerying = true;

  sendBtn.disabled    = true;
  queryInput.disabled = true;
  sourcesBar.style.display = 'none';
  sourcesList.innerHTML    = '';

  addMessage('user', question.trim());

  const msgId = `oracle-${Date.now()}`;
  addMessage('oracle', '', msgId, true);

  let fullText = '';

  try {
    const response = await fetch(`${API}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: question.trim() }),
    });

    if (!response.ok) throw new Error(`Server error ${response.status}`);

    const reader  = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer    = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const data = JSON.parse(line.slice(6));
          if (data.token) {
            fullText += data.token;
            updateMessage(msgId, fullText);
          } else if (data.sources) {
            showSources(data.sources);
          } else if (data.tokens_used !== undefined) {
            updateTokenDisplay(data.tokens_total ?? used + data.tokens_used);
          } else if (data.limit_exceeded) {
            // Server-side double-check tripped (race condition)
            const proceed = await confirmLimitModal(data.used);
            if (!proceed) {
              updateMessage(msgId, 'Query cancelled — daily token limit reached.', true);
              break;
            }
          } else if (data.error) {
            updateMessage(msgId, `Error: ${data.error}`, true);
          }
        } catch {
          // malformed SSE line — ignore
        }
      }
    }
  } catch (e) {
    updateMessage(msgId, `Connection failed: ${e.message}`, true);
  } finally {
    isQuerying       = false;
    sendBtn.disabled    = false;
    queryInput.disabled = false;
    queryInput.focus();
  }
}

// ── Sources ────────────────────────────────────────────────────────────
function showSources(sources) {
  if (!sources || sources.length === 0) return;

  sourcesCount.textContent = sources.length;
  sourcesList.innerHTML = '';

  for (const s of sources) {
    const card = document.createElement('div');
    card.className = 'source-card' + (s.file_path ? ' source-card-link' : '');
    card.title = s.file_path || s.file;
    card.innerHTML = `
      <div class="source-card-file">${escapeHtml(s.file.replace('.md', ''))}</div>
      ${s.category ? `<div class="source-card-category">${escapeHtml(s.category)}</div>` : ''}
      <div class="source-card-text">${escapeHtml(s.text)}</div>
      <div class="source-score">Relevance: ${(s.score * 100).toFixed(0)}%</div>
    `;
    const openTarget = s.obsidian_url || s.file_path;
    if (openTarget) {
      card.addEventListener('click', () => invoke('open_file', { path: openTarget }));
    }
    sourcesList.appendChild(card);
  }

  sourcesBar.style.display       = 'flex';
  sourcesBar.style.flexDirection = 'column';
  sourcesCollapsed               = true;
  sourcesBar.classList.add('collapsed');
}

sourcesToggleBtn.addEventListener('click', () => {
  sourcesCollapsed = !sourcesCollapsed;
  sourcesBar.classList.toggle('collapsed', sourcesCollapsed);
});

// ── Ingest ─────────────────────────────────────────────────────────────
async function pollUntilLoaded() {
  try {
    const res = await fetch(`${API}/status`);
    const data = await res.json();
    updateStatus(data);
    if (data.loaded) {
      addLogEntry(`Index ready — ${data.doc_count.toLocaleString()} chunks loaded.`, 'done');
    } else if (data.error) {
      addLogEntry(`Reload failed: ${data.error}`, 'error');
    } else {
      setTimeout(pollUntilLoaded, 2000);
    }
  } catch {
    setTimeout(pollUntilLoaded, 3000);
  }
}

async function startIngest() {
  if (isIngesting) return;
  isIngesting = true;

  reindexBtn.disabled  = true;
  sendBtn.disabled     = true;
  queryInput.disabled  = true;

  ingestLog.style.display = 'block';
  ingestEntries.innerHTML = '';

  const addLogEntry = (text, type = '') => {
    const el = document.createElement('div');
    el.className = `ingest-log-entry ${type}`.trim();
    const now = new Date();
    const ts = now.toLocaleDateString([], { year: 'numeric', month: '2-digit', day: '2-digit' })
      + ' ' + now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase();
    el.innerHTML = `<span class="log-ts">${ts}</span> ${escapeHtml(text)}`;
    ingestEntries.appendChild(el);
    ingestLog.scrollTop = ingestLog.scrollHeight;
  };

  try {
    const rebuild = document.getElementById('rebuild-checkbox').checked;
    const response = await fetch(`${API}/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rebuild }),
    });
    const reader   = response.body.getReader();
    const decoder  = new TextDecoder();
    let buffer     = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const data = JSON.parse(line.slice(6));
          if (data.progress) addLogEntry(data.progress, data.done ? '' : '');
          if (data.error)    addLogEntry(`Error: ${data.error}`, 'error');
          if (data.done)     pollUntilLoaded();
        } catch {
          // ignore malformed SSE line
        }
      }
    }
  } catch (e) {
    addLogEntry(`Connection error: ${e.message}`, 'error');
  } finally {
    isIngesting          = false;
    reindexBtn.disabled  = false;
    sendBtn.disabled     = false;
    queryInput.disabled  = false;
  }
}

// ── Input handling ─────────────────────────────────────────────────────
queryInput.addEventListener('input', () => {
  queryInput.style.height = 'auto';
  queryInput.style.height = Math.min(queryInput.scrollHeight, 120) + 'px';
});

queryInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    const val = queryInput.value;
    queryInput.value        = '';
    queryInput.style.height = 'auto';
    sendQuery(val);
  }
});

sendBtn.addEventListener('click', () => {
  const val = queryInput.value;
  queryInput.value        = '';
  queryInput.style.height = 'auto';
  sendQuery(val);
});

reindexBtn.addEventListener('click', startIngest);

attachChipListeners();

// ── Init ───────────────────────────────────────────────────────────────
checkStatus();

// Fetch token usage as soon as the server is reachable, retrying until it responds
async function initTokens() {
  try {
    const res = await fetch(`${API}/tokens`);
    const { used } = await res.json();
    updateTokenDisplay(used);
  } catch {
    setTimeout(initTokens, 2000);
  }
}
initTokens();
