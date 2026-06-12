import { invoke } from '@tauri-apps/api/core';
import { marked } from 'marked';
import chevronLeftSvg from 'heroicons/24/outline/chevron-left.svg?raw';
import chevronRightSvg from 'heroicons/24/outline/chevron-right.svg?raw';
import userGroupSvg from 'heroicons/24/outline/user-group.svg?raw';
import storefrontSvg from 'heroicons/24/outline/building-storefront.svg?raw';
import sparklesSvg from 'heroicons/24/outline/sparkles.svg?raw';
import xMarkSvg from 'heroicons/24/outline/x-mark.svg?raw';
import bookmarkSvg from 'heroicons/24/outline/bookmark.svg?raw';
import checkCircleSvg from 'heroicons/24/outline/check-circle.svg?raw';

const API = 'http://astroserver:8765';
const VAULT_PATH = "/Users/jasonsylvester/Documents/Obsidian/Azorian's Bounty";
const VAULT_NAME = VAULT_PATH.split('/').pop();

// ── RPGManager / Turso (direct — no server dependency) ───────────────────
const TURSO_URL   = 'https://rpgmanager-astrojason.aws-us-west-2.turso.io';
const TURSO_TOKEN = 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3NTgwNDI5MDgsImlkIjoiODkwMGQ2ZTItM2VkNC00ZTQyLTkxMDItYmM5NmVhN2IxMDFjIiwicmlkIjoiOGU5MTYxMzktNjliNS00NjBkLThjZTUtZWJhZmM3ZGI4NmM2In0.StugZfNHCPgJA5JpcG4xgZ8ie-g_rzUUx7K9pYfoD9CtLthNIKGc-bOMUb7PqdKW5u945rS2ixHlwF0E-KXlCQ';

async function tursoQuery(sql) {
  const res = await fetch(`${TURSO_URL}/v2/pipeline`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${TURSO_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [{ type: 'execute', stmt: { sql } }, { type: 'close' }] }),
  });
  const data = await res.json();
  const result = data.results[0].response.result;
  const cols = result.cols.map(c => c.name);
  return result.rows.map(row =>
    Object.fromEntries(cols.map((col, i) => [col, row[i].type === 'null' ? null : row[i].value]))
  );
}

function buildObsidianUrl(filePath) {
  if (!filePath) return null;
  // file_path in metadata is the Mac path from ingest time — strip vault prefix
  const prefix = VAULT_PATH + '/';
  if (!filePath.startsWith(prefix)) return null;
  const rel = filePath.slice(prefix.length).replace(/\.md$/, '');
  return `obsidian://open?vault=${encodeURIComponent(VAULT_NAME)}&file=${encodeURIComponent(rel)}`;
}

let isQuerying = false;
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
    </div>
  </header>

  <div class="main-layout">
    <div class="content-area">
      <nav class="tab-bar">
        <button class="tab-btn active" data-tab="oracle">⚔ Oracle</button>
        <button class="tab-btn" data-tab="threads">⚡ Threads</button>
        <button class="tab-btn" data-tab="session">📜 Session</button>
        <button class="tab-btn" data-tab="vault">📖 Vault</button>
        <button class="tab-btn" data-tab="links">🔗 Links</button>
      </nav>
      <main class="chat-area tab-panel" id="panel-oracle">
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

    <div class="tab-panel" id="panel-threads" style="display:none">
      <div class="threads-toolbar">
        <button class="btn btn-primary" id="threads-scan-btn">✦ Scan from Recap</button>
        <button class="btn btn-ghost" id="threads-refresh-btn">↻ Refresh</button>
      </div>
      <div id="threads-empty" class="threads-empty" style="display:none">
        No plot threads yet. Click <strong>Scan from Recap</strong> to extract threads from your latest session recap.
      </div>
      <div id="thread-matrix-wrap" class="thread-matrix-wrap" style="display:none"></div>
    </div>

    <div class="tab-panel" id="panel-session" style="display:none">
      <div class="session-toolbar">
        <button class="btn btn-primary" id="session-scan-btn">✦ Scan Next Steps</button>
        <button class="btn btn-ghost" id="session-threads-btn">⚡ Scan Threads</button>
        <button class="btn btn-ghost" id="session-refresh-btn">↻ Refresh</button>
      </div>
      <div class="session-body">
        <div class="session-recaps" id="session-recaps">
          <details class="session-recap-panel" id="recap-player-panel">
            <summary class="recap-summary">Player Recap <span class="recap-filename" id="recap-player-name">—</span></summary>
            <div class="recap-md" id="recap-player-content">Loading…</div>
          </details>
          <details class="session-recap-panel" id="recap-dm-panel">
            <summary class="recap-summary">DM Element Tables <span class="recap-filename" id="recap-dm-name">—</span></summary>
            <div class="recap-md" id="recap-dm-content">Loading…</div>
          </details>
        </div>
        <div class="session-next-steps">
          <div class="session-next-steps-header">Next Session Prep</div>
          <div class="session-output" id="session-output">
            <div class="session-output-placeholder" id="session-output-placeholder">Click <strong>Scan Next Steps</strong> to generate next-session prep from the latest recap.</div>
          </div>
        </div>
      </div>
    </div>

    <div class="tab-panel" id="panel-vault" style="display:none">
      <div class="vault-toolbar">
        <span class="vault-status-text" id="vault-status-text">—</span>
        <div class="vault-toolbar-actions">
          <button class="btn btn-ghost" id="vault-scan-btn">↻ Rescan</button>
          <button class="btn btn-primary" id="vault-suggest-btn">✦ Suggest</button>
        </div>
      </div>
      <div class="vault-controls">
        <div class="vault-filter-tabs" id="vault-filter-tabs">
          <button class="vault-filter-btn active" data-filter="all">All</button>
          <button class="vault-filter-btn" data-filter="blank">Blank</button>
          <button class="vault-filter-btn" data-filter="stub">Stub</button>
        </div>
        <input class="vault-search-input" id="vault-search-input" type="text" placeholder="Search by name…" autocomplete="off">
      </div>
      <div class="vault-file-list" id="vault-file-list">
        <div class="vault-placeholder">Loading vault…</div>
      </div>
    </div>

    <div class="tab-panel" id="panel-links" style="display:none">
      <div class="links-toolbar">
        <select class="tool-select links-type-select" id="links-type-select">
          <option value="npcs">NPCs</option>
          <option value="locations">Locations</option>
        </select>
        <input class="vault-search-input links-search-input" id="links-search" type="text" placeholder="Search…" autocomplete="off">
        <button class="btn btn-ghost" id="links-refresh-btn">↻ Refresh</button>
      </div>
      <div class="links-status" id="links-status">—</div>
      <div class="links-list" id="links-list">
        <div class="vault-placeholder">Select a tab to load entities.</div>
      </div>
    </div>

    </div>

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

  <div class="modal-overlay" id="threads-approval-modal" style="display:none">
    <div class="modal modal-tool">
      <div class="tool-modal-header">
        <div class="tool-modal-title-row">
          <span class="modal-title" style="margin-bottom:0">Scan for Plot Threads</span>
        </div>
        <button class="modal-x-btn" id="threads-modal-close"></button>
      </div>
      <div class="threads-modal-body" id="threads-modal-body"></div>
      <div class="modal-actions" style="padding:16px 24px;border-top:1px solid var(--border-subtle)">
        <button class="btn btn-ghost" id="threads-modal-cancel">Cancel</button>
        <button class="btn btn-primary" id="threads-modal-confirm" disabled>Add Selected</button>
      </div>
    </div>
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

  <div class="modal-overlay" id="links-pick-modal" style="display:none">
    <div class="modal links-pick-modal-inner">
      <div class="modal-title" id="links-pick-title">Link to Vault File</div>
      <input class="vault-search-input" id="links-pick-search" type="text" placeholder="Search vault files…" autocomplete="off">
      <div class="links-pick-list" id="links-pick-list"></div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="links-pick-cancel">Cancel</button>
      </div>
    </div>
  </div>
`;

// ── DOM refs (resolved after innerHTML set) ────────────────────────────
const queryInput   = document.getElementById('query-input');
const sendBtn      = document.getElementById('send-btn');
const messagesEl   = document.getElementById('messages');
const sourcesBar   = document.getElementById('sources-bar');
const sourcesList  = document.getElementById('sources-list');
const sourcesCount = document.getElementById('sources-count');
const sourcesToggleBtn = document.getElementById('sources-toggle-btn');
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
document.getElementById('threads-modal-close').innerHTML = xMarkSvg;
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

// ── Vault FS helpers ────────────────────────────────────────────────────
function extractSection(content, sectionName) {
  const escaped = sectionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:^|\\n)#{1,4}\\s+${escaped}\\s*\\n([\\s\\S]*?)(?=\\n#{1,4}\\s|$)`, 'i');
  const m = content.match(re);
  return m ? m[1].trim() : '';
}

function extractLocationContent(content) {
  return (
    extractSection(content, 'Description') ||
    extractSection(content, 'Overview') ||
    content.slice(0, 800)
  );
}

async function getActivePcInfo() {
  const pcDir = `${VAULT_PATH}/02 Characters/PCs`;
  try {
    const entries = await invoke('read_dir', { path: pcDir });
    const summaries = [];
    for (const entry of entries) {
      if (entry.is_dir || !entry.name.endsWith('.md')) continue;
      try {
        const content = await invoke('read_text_file', { path: entry.path });
        if (content.includes('#inactive') || content.includes('#deceased')) continue;
        const name = entry.name.replace('.md', '');
        const goal = extractSection(content, 'Primary Goal') || extractSection(content, 'Goals');
        summaries.push(goal ? `${name}: ${goal.slice(0, 200)}` : name);
      } catch { /* skip unreadable file */ }
    }
    return summaries.join('\n');
  } catch {
    return '';
  }
}

// ── World locations cache ───────────────────────────────────────────────
let _worldLocations = null;

async function readWorldLocationsRecursive(dirPath, relParts) {
  const results = [];
  try {
    const entries = await invoke('read_dir', { path: dirPath });
    const sorted = entries.filter(e => e.is_dir && !e.name.startsWith('.')).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of sorted) {
      const crumb = [...relParts, entry.name].join(' > ');
      const notePath = `${entry.path}/${entry.name}.md`;
      let noteExists = false;
      try { await invoke('read_text_file', { path: notePath }); noteExists = true; } catch { /* no note */ }
      results.push({
        name: entry.name,
        display_name: crumb,
        folder_path: entry.path,
        note_path: noteExists ? notePath : null,
      });
      const sub = await readWorldLocationsRecursive(entry.path, [...relParts, entry.name]);
      results.push(...sub);
    }
  } catch { /* unreadable dir */ }
  return results;
}

async function loadWorldLocations() {
  if (_worldLocations) return _worldLocations;
  const locRoot = `${VAULT_PATH}/01 World/Locations`;
  _worldLocations = await readWorldLocationsRecursive(locRoot, []);
  return _worldLocations;
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

    if (data.kind === 'npc' && result.markdown) {
      const npcType = payload.npc_type || 'Minor';
      const safeName = payload.name.replace(/[^\w\s'\-]/g, '').trim();
      const npcPath = `${VAULT_PATH}/02 Characters/NPCs/${npcType}/${safeName}.md`;
      await invoke('write_text_file', { path: npcPath, content: result.markdown });
      btn.innerHTML = checkCircleSvg;
      btn.classList.add('saved');
      btn.dataset.saved = '1';
      btn.title = 'Saved to vault';
    } else if (data.kind === 'shop' && result.shop_markdown) {
      const safeName = payload.name.replace(/[^\w\s'\-]/g, '').trim();
      const shopsDir = payload.location_folder_path
        ? `${payload.location_folder_path}/Shops`
        : `${VAULT_PATH}/01 World/Shops`;
      await invoke('write_text_file', { path: `${shopsDir}/${safeName}.md`, content: result.shop_markdown });
      let npcCount = 0;
      for (const [npcName, npcMd] of Object.entries(result.npc_markdowns || {})) {
        const safeNpcName = npcName.replace(/[^\w\s'\-]/g, '').trim();
        const npcPath = `${VAULT_PATH}/02 Characters/NPCs/Minor/${safeNpcName}.md`;
        await invoke('write_text_file', { path: npcPath, content: npcMd });
        npcCount++;
      }
      btn.innerHTML = checkCircleSvg;
      btn.classList.add('saved');
      btn.dataset.saved = '1';
      btn.title = npcCount ? `Saved to vault + ${npcCount} NPC file(s) created` : 'Saved to vault';
    } else {
      showToast(`Save failed: unexpected server response`);
      btn.disabled = false;
    }
  } catch (err) {
    showToast(`Save failed: ${err.message}`);
    btn.disabled = false;
  }
});

let _locationsCache = null;

async function scanVaultLocations(dirPath) {
  const results = [];
  const EXCLUDE = ['ZZ_Workbench', '00 To Process'];
  try {
    const entries = await invoke('read_dir', { path: dirPath });
    for (const entry of entries) {
      if (!entry.is_dir || entry.name.startsWith('.') || EXCLUDE.includes(entry.name)) continue;
      // Check for a same-name .md file or overview.md
      for (const candidate of [`${entry.name}.md`, 'overview.md', 'Overview.md']) {
        try {
          const notePath = `${entry.path}/${candidate}`;
          await invoke('read_text_file', { path: notePath });
          results.push({ name: entry.name, path: notePath });
          break;
        } catch { /* not found */ }
      }
      // Recurse into subdirectory
      const sub = await scanVaultLocations(entry.path);
      results.push(...sub);
    }
  } catch { /* unreadable dir */ }
  return results;
}

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
    _locationsCache = await scanVaultLocations(VAULT_PATH);
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

  let population = '';
  if (locationPath) {
    try {
      const content = await invoke('read_text_file', { path: locationPath });
      population = extractSection(content, 'Population');
    } catch { /* file unreadable — use empty population */ }
  }

  let fullText = '';
  try {
    const res = await fetch(`${API}/generate/npcs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ location_name: locationName, population, count }),
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

  let location_content = '';
  try {
    const fileContent = await invoke('read_text_file', { path: locationPath });
    location_content = extractLocationContent(fileContent);
  } catch { /* file unreadable */ }
  const pc_info = await getActivePcInfo();

  let fullText = '';
  try {
    const res = await fetch(`${API}/generate/shops`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ location_name: locationName, location_content, pc_info }),
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
    if (!isQuerying) {
      sendBtn.disabled    = false;
      queryInput.disabled = false;
    }
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
    if (!isQuerying) {
      sendBtn.disabled    = false;
      queryInput.disabled = false;
    }
    // Surface new errors as a toast (once per unique error)
    if (data.error !== _lastErrorText) {
      _lastErrorText = data.error;
      showToast(`Index error: ${data.error.length > 60 ? data.error.slice(0, 60) + '… (click Details)' : data.error}`);
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
    const openTarget = s.obsidian_url || buildObsidianUrl(s.file_path);
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

// ── Tab navigation ─────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.tab-panel').forEach(p => { p.style.display = 'none'; });
    document.getElementById(`panel-${tab}`).style.display = '';
    if (tab === 'threads') loadThreadsTab();
    if (tab === 'session') loadSessionTab();
    if (tab === 'vault') loadVaultTab();
    if (tab === 'links') loadLinksTab();
  });
});

// ── Active PC names ────────────────────────────────────────────────────
async function getActivePcNames() {
  const pcDir = `${VAULT_PATH}/02 Characters/PCs`;
  try {
    const entries = await invoke('read_dir', { path: pcDir });
    const names = [];
    for (const entry of entries) {
      if (entry.is_dir || !entry.name.endsWith('.md')) continue;
      try {
        const content = await invoke('read_text_file', { path: entry.path });
        if (content.includes('#inactive') || content.includes('#deceased')) continue;
        names.push(entry.name.replace('.md', ''));
      } catch { /* skip */ }
    }
    return names;
  } catch {
    return [];
  }
}

// ── Latest recap finder ────────────────────────────────────────────────
async function findLatestRecap(subfolder) {
  const base = `${VAULT_PATH}/03 Story/Sessions/${subfolder}`;
  try {
    const yearEntries = await invoke('read_dir', { path: base });
    const yearDirs = yearEntries
      .filter(e => e.is_dir && /^\d{4}$/.test(e.name))
      .sort((a, b) => b.name.localeCompare(a.name));
    for (const yearDir of yearDirs) {
      try {
        const files = await invoke('read_dir', { path: yearDir.path });
        const mdFiles = files
          .filter(e => !e.is_dir && e.name.endsWith('.md'))
          .sort((a, b) => b.name.localeCompare(a.name));
        if (mdFiles.length > 0) {
          const content = await invoke('read_text_file', { path: mdFiles[0].path });
          return { path: mdFiles[0].path, name: mdFiles[0].name, content };
        }
      } catch { /* skip year */ }
    }
  } catch { /* dir not found */ }
  return null;
}

// ── Thread state ────────────────────────────────────────────────────────
let _threads = [];
let _pcNames = [];
let _pcNamesLoaded = false;

// ── Threads tab ─────────────────────────────────────────────────────────
async function loadThreadsTab() {
  try {
    const res = await fetch(`${API}/threads`);
    const data = await res.json();
    _threads = data.threads || [];
    if (!_pcNamesLoaded) {
      _pcNames = await getActivePcNames();
      _pcNamesLoaded = true;
    }
    renderThreadsPanel();
  } catch (e) {
    showToast(`Failed to load threads: ${e.message}`);
  }
}

function renderThreadsPanel() {
  const wrap  = document.getElementById('thread-matrix-wrap');
  const empty = document.getElementById('threads-empty');
  if (_threads.length === 0) {
    wrap.style.display  = 'none';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';
  wrap.style.display  = 'block';
  wrap.innerHTML = buildMatrixHtml(_threads, _pcNames);

  // Row click → toggle detail row
  wrap.querySelectorAll('.thread-row').forEach(row => {
    row.addEventListener('click', () => {
      const idx    = row.dataset.index;
      const detail = document.getElementById(`thread-detail-${idx}`);
      const isOpen = detail.style.display !== 'none';
      wrap.querySelectorAll('.thread-detail-row').forEach(d => { d.style.display = 'none'; });
      wrap.querySelectorAll('.thread-row').forEach(r => r.classList.remove('expanded'));
      if (!isOpen) {
        detail.style.display = '';
        row.classList.add('expanded');
      }
    });
  });

  // Status buttons inside detail rows
  wrap.querySelectorAll('.status-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await setThreadStatus(btn.dataset.id, btn.dataset.status);
    });
  });
}

function buildMatrixHtml(threads, pcNames) {
  const pcHeaders = pcNames.map(n => `<th class="matrix-pc-col">${escapeHtml(n)}</th>`).join('');
  const colSpan = pcNames.length + 2;

  const rows = threads.map((t, i) => {
    const status = t.status || 'active';
    const pcCells = pcNames.map(name => {
      const rel = (t.pcs || []).find(p => p.name === name)?.role;
      if (rel === 'involved') return `<td class="matrix-cell matrix-cell-involved" title="Involved">⚔</td>`;
      if (rel === 'stake')    return `<td class="matrix-cell matrix-cell-stake" title="Personal stake">♦</td>`;
      return `<td class="matrix-cell"></td>`;
    }).join('');

    return `
      <tr class="thread-row" data-index="${i}" data-id="${escapeHtml(t.id || '')}">
        <td class="matrix-thread-name">${escapeHtml(t.title || 'Untitled')}</td>
        ${pcCells}
        <td class="matrix-cell"><span class="badge badge-${escapeHtml(status)}">${escapeHtml(status)}</span></td>
      </tr>
      <tr class="thread-detail-row" id="thread-detail-${i}" style="display:none">
        <td colspan="${colSpan}" class="thread-detail-cell">
          <div class="thread-detail-inner">
            <p class="thread-description">${escapeHtml(t.description || '')}</p>
            <div class="thread-status-bar">
              <span class="thread-status-label">Status</span>
              <button class="status-btn${status === 'active'   ? ' current' : ''}" data-id="${escapeHtml(t.id || '')}" data-status="active">Active</button>
              <button class="status-btn${status === 'dormant'  ? ' current' : ''}" data-id="${escapeHtml(t.id || '')}" data-status="dormant">Dormant</button>
              <button class="status-btn${status === 'resolved' ? ' current' : ''}" data-id="${escapeHtml(t.id || '')}" data-status="resolved">Resolved</button>
            </div>
          </div>
        </td>
      </tr>`;
  }).join('');

  return `
    <table class="thread-matrix">
      <thead>
        <tr>
          <th class="matrix-thread-col">Thread</th>
          ${pcHeaders}
          <th class="matrix-status-col">Status</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

async function setThreadStatus(id, status) {
  try {
    const res = await fetch(`${API}/threads/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
    });
    const data = await res.json();
    if (data.markdown) {
      const threadsPath = `${VAULT_PATH}/03 Story/Plot Threads.md`;
      await invoke('write_text_file', { path: threadsPath, content: data.markdown });
      const t = _threads.find(th => th.id === id);
      if (t) t.status = status;
      renderThreadsPanel();
      showToast('Status updated', 'success');
    } else {
      showToast(`Failed to update status: ${data.detail || 'Unknown error'}`);
    }
  } catch (e) {
    showToast(`Failed to update status: ${e.message}`);
  }
}

// ── Threads toolbar buttons ─────────────────────────────────────────────
document.getElementById('threads-refresh-btn').addEventListener('click', () => loadThreadsTab());
document.getElementById('threads-scan-btn').addEventListener('click', () => openThreadsScanModal());

// ── Approval modal ──────────────────────────────────────────────────────
async function openThreadsScanModal() {
  const modal      = document.getElementById('threads-approval-modal');
  const body       = document.getElementById('threads-modal-body');
  const confirmBtn = document.getElementById('threads-modal-confirm');

  modal.style.display  = 'flex';
  confirmBtn.disabled  = true;
  modal._proposed      = [];
  body.innerHTML = `<div class="threads-modal-loading"><div class="overlay-spinner"></div><div>Loading recaps\u2026</div></div>`;

  try {
    const [playerRecap, dmRecap] = await Promise.all([
      findLatestRecap('Recap - Player'),
      findLatestRecap('Recap - DM - Element Tables'),
    ]);

    if (!playerRecap) {
      body.innerHTML = `<div class="threads-modal-error">No player recap found in <code>03 Story/Sessions/Recap - Player</code>.</div>`;
      return;
    }

    body.innerHTML = `<div class="threads-modal-loading"><div class="overlay-spinner"></div><div>Extracting threads\u2026</div></div>`;

    const res = await fetch(`${API}/threads/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        player_recap: playerRecap.content,
        dm_recap: dmRecap?.content || '',
      }),
    });
    const data = await res.json();
    const proposed = data.proposed || [];

    if (proposed.length === 0) {
      body.innerHTML = `<div class="threads-modal-error">No clear plot threads found in the latest recap.</div>`;
      return;
    }

    body.innerHTML = `
      <div class="threads-modal-source">
        Recap: <strong>${escapeHtml(playerRecap.name)}</strong>
        ${dmRecap ? `&middot; DM notes: <strong>${escapeHtml(dmRecap.name)}</strong>` : ''}
      </div>
      <div class="proposed-threads">
        ${proposed.map((t, i) => `
          <label class="proposed-thread-item">
            <input type="checkbox" class="proposed-check" data-index="${i}" checked>
            <div class="proposed-thread-body">
              <div class="proposed-thread-title">${escapeHtml(t.title || 'Untitled')}</div>
              <div class="proposed-thread-desc">${escapeHtml(t.description || '')}</div>
              ${(t.pcs || []).length ? `<div class="proposed-thread-pcs">${t.pcs.map(p => `<span class="proposed-pc">${escapeHtml(p.name)} (${escapeHtml(p.role)})</span>`).join('')}</div>` : ''}
            </div>
          </label>`).join('')}
      </div>`;

    modal._proposed     = proposed;
    confirmBtn.disabled = false;
  } catch (e) {
    body.innerHTML = `<div class="threads-modal-error">Error: ${escapeHtml(e.message)}</div>`;
  }
}

document.getElementById('threads-modal-close').addEventListener('click', () => {
  document.getElementById('threads-approval-modal').style.display = 'none';
});
document.getElementById('threads-modal-cancel').addEventListener('click', () => {
  document.getElementById('threads-approval-modal').style.display = 'none';
});

document.getElementById('threads-modal-confirm').addEventListener('click', async () => {
  const modal    = document.getElementById('threads-approval-modal');
  const proposed = modal._proposed || [];

  const checked = [...document.querySelectorAll('.proposed-check:checked')]
    .map(cb => proposed[parseInt(cb.dataset.index)])
    .filter(Boolean);

  if (checked.length === 0) { showToast('No threads selected.'); return; }

  // Skip duplicates by title (case-insensitive)
  const existingTitles = new Set(_threads.map(t => t.title?.toLowerCase()));
  const newThreads     = checked.filter(t => !existingTitles.has(t.title?.toLowerCase()));
  const merged         = [..._threads, ...newThreads];

  try {
    const res = await fetch(`${API}/threads/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threads: merged }),
    });
    const data = await res.json();
    if (data.markdown) {
      const threadsPath = `${VAULT_PATH}/03 Story/Plot Threads.md`;
      await invoke('write_text_file', { path: threadsPath, content: data.markdown });
      _threads            = data.threads || merged;
      modal.style.display = 'none';
      renderThreadsPanel();
      showToast(`Added ${newThreads.length} thread(s)`, 'success');
    } else {
      showToast('Failed to save threads.');
    }
  } catch (e) {
    showToast(`Failed to save threads: ${e.message}`);
  }
});

// ── Session tab state ────────────────────────────────────────────────────
let _sessionPlayerRecap = null;
let _sessionDmRecap = null;
let _sessionLoaded = false;

// ── Session tab ──────────────────────────────────────────────────────────
async function loadSessionTab() {
  if (_sessionLoaded) return;
  _sessionLoaded = true;

  const playerNameEl    = document.getElementById('recap-player-name');
  const playerContentEl = document.getElementById('recap-player-content');
  const dmNameEl        = document.getElementById('recap-dm-name');
  const dmContentEl     = document.getElementById('recap-dm-content');

  playerNameEl.textContent    = 'Loading\u2026';
  playerContentEl.textContent = 'Loading\u2026';
  dmNameEl.textContent        = '\u2014';
  dmContentEl.textContent     = '\u2014';

  const [playerRecap, dmRecap] = await Promise.all([
    findLatestRecap('Recap - Player'),
    findLatestRecap('Recap - DM - Element Tables'),
  ]);

  _sessionPlayerRecap = playerRecap;
  _sessionDmRecap     = dmRecap;

  if (playerRecap) {
    playerNameEl.textContent = playerRecap.name;
    playerContentEl.innerHTML = marked.parse(playerRecap.content);
  } else {
    playerNameEl.textContent  = 'Not found';
    playerContentEl.textContent = 'No player recap found in 03 Story/Sessions/Recap - Player.';
  }

  if (dmRecap) {
    dmNameEl.textContent    = dmRecap.name;
    dmContentEl.innerHTML   = marked.parse(dmRecap.content);
  } else {
    dmNameEl.textContent    = 'Not found';
    dmContentEl.textContent = 'No DM recap found in 03 Story/Sessions/Recap - DM - Element Tables.';
  }
}

document.getElementById('session-refresh-btn').addEventListener('click', () => {
  _sessionLoaded = false;
  loadSessionTab();
});

document.getElementById('session-threads-btn').addEventListener('click', () => {
  openThreadsScanModal();
});

document.getElementById('session-scan-btn').addEventListener('click', async () => {
  if (!_sessionPlayerRecap) {
    showToast('No player recap loaded. Click Refresh first.');
    return;
  }

  const output      = document.getElementById('session-output');
  const scanBtn     = document.getElementById('session-scan-btn');
  const placeholder = document.getElementById('session-output-placeholder');

  scanBtn.disabled = true;
  if (placeholder) placeholder.remove();
  output.innerHTML = '<pre class="session-stream-pre" id="session-stream-pre"></pre>';
  const streamPre  = document.getElementById('session-stream-pre');

  // Token pre-flight
  const used = await refreshTokens();
  if (used >= DAILY_LIMIT) {
    const proceed = await confirmLimitModal(used);
    if (!proceed) {
      scanBtn.disabled = false;
      return;
    }
  }

  let fullText = '';
  try {
    const res = await fetch(`${API}/session/next-steps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        player_recap: _sessionPlayerRecap.content,
        dm_recap: _sessionDmRecap?.content || '',
      }),
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
            streamPre.scrollTop   = streamPre.scrollHeight;
          } else if (data.limit_exceeded) {
            const proceed = await confirmLimitModal(data.used);
            if (!proceed) break;
          } else if (data.error) {
            streamPre.textContent = `Error: ${data.error}`;
          }
        } catch { /* ignore */ }
      }
    }
  } catch (e) {
    streamPre.textContent = `Connection error: ${e.message}`;
  } finally {
    scanBtn.disabled = false;
  }
});

// ── Vault Curator tab ───────────────────────────────────────────────────
// Runs entirely client-side via Tauri IPC — vault lives on the local Mac,
// not on the remote server.

const VAULT_IGNORE_DIRS = new Set(['.obsidian', 'Templates', '.trash']);
const VAULT_PREFER_TAGS = ['npc', 'location', 'quest'];
const VAULT_STUB_BYTES = 40;

const _vaultFrontMatterRe = /^---\s*\n[\s\S]*?\n---\s*\n/;
const _vaultHeaderRe = /^\s*#{1,6}\s+.*/gm;
const _vaultLinkLineRe = /^\s*\[\[.+?\]\]\s*$/gm;
const _vaultTagRe = /#([\w][\w/-]*)/g;

function _vaultStripMetadata(text) {
  return text
    .replace(_vaultFrontMatterRe, '')
    .replace(_vaultHeaderRe, '')
    .replace(_vaultLinkLineRe, '')
    .trim();
}

function _vaultIsBlank(content) {
  if (!content) return true;
  return !_vaultStripMetadata(content);
}

function _vaultIsStub(content) {
  if (!content || _vaultIsBlank(content)) return false;
  const stripped = _vaultStripMetadata(content);
  return new TextEncoder().encode(stripped).length < VAULT_STUB_BYTES;
}

function _vaultExtractTags(content) {
  const tags = new Set();
  let m;
  _vaultTagRe.lastIndex = 0;
  while ((m = _vaultTagRe.exec(content)) !== null) tags.add(m[1].toLowerCase());
  return [...tags];
}

async function _vaultScanDir(dirPath) {
  const files = [];
  let entries;
  try { entries = await invoke('read_dir', { path: dirPath }); } catch { return files; }
  for (const entry of entries) {
    if (entry.is_dir) {
      if (!VAULT_IGNORE_DIRS.has(entry.name)) {
        files.push(...await _vaultScanDir(entry.path));
      }
    } else if (entry.name.endsWith('.md')) {
      try {
        const content = await invoke('read_text_file', { path: entry.path });
        const blank = _vaultIsBlank(content);
        const stub = _vaultIsStub(content);
        const tags = _vaultExtractTags(content);
        const relPath = entry.path.slice(VAULT_PATH.length + 1);
        files.push({ name: entry.name.replace(/\.md$/, ''), path: entry.path, rel_path: relPath, blank, stub, tags });
      } catch { /* skip unreadable */ }
    }
  }
  return files;
}

let _vaultAllFiles = null;
let _vaultFilter = 'all';
let _vaultSearchQuery = '';
let _vaultSearchTimeout = null;

async function loadVaultTab() {
  if (_vaultAllFiles !== null) return;
  document.getElementById('vault-file-list').innerHTML = '<div class="vault-placeholder">Scanning vault…</div>';
  document.getElementById('vault-scan-btn').disabled = true;
  try {
    _vaultAllFiles = await _vaultScanDir(VAULT_PATH);
    _vaultAllFiles.sort((a, b) => a.name.localeCompare(b.name));
    _updateVaultStatus();
    _renderVaultFileList(_vaultFilteredFiles());
  } catch (e) {
    document.getElementById('vault-file-list').innerHTML =
      `<div class="vault-placeholder vault-error">Scan failed: ${escapeHtml(e.message)}</div>`;
  } finally {
    document.getElementById('vault-scan-btn').disabled = false;
  }
}

function _updateVaultStatus() {
  if (!_vaultAllFiles) return;
  const blank = _vaultAllFiles.filter(f => f.blank).length;
  const stub  = _vaultAllFiles.filter(f => f.stub).length;
  document.getElementById('vault-status-text').textContent =
    `${blank} blank · ${stub} stub · ${_vaultAllFiles.length} total`;
}

function _vaultFilteredFiles() {
  let files = _vaultAllFiles || [];
  const q = _vaultSearchQuery.trim().toLowerCase();
  if (q) return files.filter(f => f.name.toLowerCase().includes(q)).slice(0, 100);
  if (_vaultFilter === 'blank') return files.filter(f => f.blank);
  if (_vaultFilter === 'stub')  return files.filter(f => f.stub);
  return files;
}

function _renderVaultFileList(files) {
  const list = document.getElementById('vault-file-list');
  if (!files || files.length === 0) {
    list.innerHTML = '<div class="vault-placeholder">No files found.</div>';
    return;
  }
  list.innerHTML = files.map(f => {
    const badge = f.blank
      ? '<span class="vault-badge vault-badge-blank">blank</span>'
      : f.stub ? '<span class="vault-badge vault-badge-stub">stub</span>' : '';
    const folder = f.rel_path.split('/').slice(0, -1).join(' / ');
    return `<div class="vault-file-item" data-path="${escapeHtml(f.path)}">
      <div class="vault-file-name">${escapeHtml(f.name)}${badge}</div>
      ${folder ? `<div class="vault-file-folder">${escapeHtml(folder)}</div>` : ''}
    </div>`;
  }).join('');
}

function _highlightVaultSuggestion(path) {
  document.querySelectorAll('.vault-file-item').forEach(item => {
    item.classList.toggle('vault-file-suggested', item.dataset.path === path);
  });
  const suggested = document.querySelector('.vault-file-suggested');
  if (suggested) suggested.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Event delegation for file list clicks
document.getElementById('vault-file-list').addEventListener('click', e => {
  const item = e.target.closest('.vault-file-item');
  if (!item) return;
  const url = buildObsidianUrl(item.dataset.path);
  if (url) invoke('open_file', { path: url });
});

document.getElementById('vault-scan-btn').addEventListener('click', async () => {
  const btn = document.getElementById('vault-scan-btn');
  btn.disabled = true;
  btn.textContent = '↻ Scanning…';
  _vaultAllFiles = null;
  document.getElementById('vault-file-list').innerHTML = '<div class="vault-placeholder">Scanning vault…</div>';
  try {
    _vaultAllFiles = await _vaultScanDir(VAULT_PATH);
    _vaultAllFiles.sort((a, b) => a.name.localeCompare(b.name));
    _updateVaultStatus();
    _renderVaultFileList(_vaultFilteredFiles());
    showToast('Vault scan complete', 'success');
  } catch (e) {
    showToast(`Scan failed: ${e.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = '↻ Rescan';
  }
});

document.getElementById('vault-suggest-btn').addEventListener('click', () => {
  if (!_vaultAllFiles) { showToast('Vault not yet scanned.'); return; }
  const candidates = _vaultAllFiles.filter(f => f.blank || f.stub);
  if (!candidates.length) { showToast('No blank or stub notes found.', 'success'); return; }
  const preferred = candidates.filter(f => f.tags.some(t => VAULT_PREFER_TAGS.includes(t)));
  const pool = preferred.length ? preferred : candidates;
  const choice = pool[Math.floor(Math.random() * pool.length)];
  const url = buildObsidianUrl(choice.path);
  if (url) invoke('open_file', { path: url });
  _renderVaultFileList(_vaultFilteredFiles());
  requestAnimationFrame(() => _highlightVaultSuggestion(choice.path));
});

document.querySelectorAll('.vault-filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    _vaultFilter = btn.dataset.filter;
    _vaultSearchQuery = '';
    document.getElementById('vault-search-input').value = '';
    document.querySelectorAll('.vault-filter-btn').forEach(b => b.classList.toggle('active', b === btn));
    if (_vaultAllFiles !== null) _renderVaultFileList(_vaultFilteredFiles());
  });
});

document.getElementById('vault-search-input').addEventListener('input', e => {
  _vaultSearchQuery = e.target.value;
  clearTimeout(_vaultSearchTimeout);
  _vaultSearchTimeout = setTimeout(() => {
    if (_vaultAllFiles !== null) _renderVaultFileList(_vaultFilteredFiles());
  }, 200);
});

// ── Links tab ────────────────────────────────────────────────────────────

let _linksEntityType = 'npcs';
let _linksEntities = [];
let _linksVaultMap = {};   // rpgmanager_id (string) -> {name, path, relPath}
let _linksAllFiles = [];   // all vault .md files (for the picker)
let _linksLoaded = false;
let _linksSearchQuery = '';
let _linksSearchTimeout = null;

// ── Frontmatter helpers ──────────────────────────────────────────────────

function _parseFm(content) {
  if (!content.startsWith('---\n')) return null;
  const close = content.indexOf('\n---\n', 4);
  if (close < 0) return null;
  return { front: content.slice(4, close), body: content.slice(close + 5) };
}

function _fmGetField(content, field) {
  const fm = _parseFm(content);
  if (!fm) return null;
  const m = fm.front.match(new RegExp(`^${field}:\\s*(.+)$`, 'm'));
  return m ? m[1].trim() : null;
}

function _fmSetField(content, field, value) {
  const fm = _parseFm(content);
  if (!fm) return `---\n${field}: ${value}\n---\n\n${content}`;
  const re = new RegExp(`^${field}:.*$`, 'm');
  const newFront = re.test(fm.front)
    ? fm.front.replace(re, `${field}: ${value}`)
    : fm.front.trimEnd() + `\n${field}: ${value}`;
  return `---\n${newFront}\n---\n${fm.body}`;
}

function _fmRemoveField(content, field) {
  const fm = _parseFm(content);
  if (!fm) return content;
  const newFront = fm.front.replace(new RegExp(`\\n?^${field}:.*$`, 'm'), '').trim();
  if (!newFront) return fm.body;
  return `---\n${newFront}\n---\n${fm.body}`;
}

// ── Vault scan for existing links ─────────────────────────────────────────

async function _scanVaultForLinks() {
  const all = [];
  const map = {};

  async function scanDir(dirPath) {
    let entries;
    try { entries = await invoke('read_dir', { path: dirPath }); } catch { return; }
    for (const entry of entries) {
      if (entry.is_dir) {
        if (!VAULT_IGNORE_DIRS.has(entry.name)) await scanDir(entry.path);
      } else if (entry.name.endsWith('.md')) {
        const relPath = entry.path.slice(VAULT_PATH.length + 1);
        const name = entry.name.replace(/\.md$/, '');
        const info = { name, path: entry.path, relPath };
        all.push(info);
        try {
          const content = await invoke('read_text_file', { path: entry.path });
          const id = _fmGetField(content, 'rpgmanager_id');
          if (id) map[id] = info;
        } catch { /* skip unreadable */ }
      }
    }
  }

  await scanDir(VAULT_PATH);
  return { all, map };
}

// ── Load / render ─────────────────────────────────────────────────────────

async function loadLinksTab(force = false) {
  if (_linksLoaded && !force) return;
  document.getElementById('links-status').textContent = 'Loading…';
  document.getElementById('links-list').innerHTML = '<div class="vault-placeholder">Scanning…</div>';

  try {
    const SQL = {
      npcs:      'SELECT id, name, pronunciation, race, gender, status FROM npcs ORDER BY name',
      locations: 'SELECT id, name, pronunciation, teaser FROM locations ORDER BY name',
    };
    const [entities, vaultRes] = await Promise.all([
      tursoQuery(SQL[_linksEntityType]),
      _scanVaultForLinks(),
    ]);
    _linksEntities = entities;
    _linksAllFiles = vaultRes.all;
    _linksVaultMap = vaultRes.map;
    _linksLoaded = true;
    _renderLinksList();
  } catch (e) {
    document.getElementById('links-status').textContent = `Error: ${e.message}`;
    document.getElementById('links-list').innerHTML = '';
  }
}

function _renderLinksList() {
  const q = _linksSearchQuery.trim().toLowerCase();
  let entities = _linksEntities;
  if (q) entities = entities.filter(e => (e.name || '').toLowerCase().includes(q));

  const linkedCount   = entities.filter(e => _linksVaultMap[String(e.id)]).length;
  const unlinkedCount = entities.length - linkedCount;
  document.getElementById('links-status').textContent =
    `${linkedCount} linked · ${unlinkedCount} unlinked · ${entities.length} total`;

  if (entities.length === 0) {
    document.getElementById('links-list').innerHTML = '<div class="vault-placeholder">No entries found.</div>';
    return;
  }

  document.getElementById('links-list').innerHTML = entities.map(e => {
    const idStr  = String(e.id);
    const linked = _linksVaultMap[idStr];
    const sub    = e.pronunciation
      ? `<span class="links-sub">${escapeHtml(e.pronunciation)}</span>`
      : e.teaser
        ? `<span class="links-sub">${escapeHtml(e.teaser.slice(0, 70))}${e.teaser.length > 70 ? '…' : ''}</span>`
        : '';

    if (linked) {
      return `<div class="links-row" data-id="${idStr}">
        <div class="links-indicator links-ind-on" title="Linked"></div>
        <div class="links-row-body">
          <div class="links-row-name">${escapeHtml(e.name || '—')} ${sub}</div>
          <div class="links-row-path">${escapeHtml(linked.relPath)}</div>
        </div>
        <div class="links-row-btns">
          <button class="btn btn-ghost btn-xs links-open-btn" data-path="${escapeHtml(linked.path)}">Open</button>
          <button class="btn btn-ghost btn-xs links-unlink-btn" data-id="${idStr}" data-path="${escapeHtml(linked.path)}">Unlink</button>
        </div>
      </div>`;
    } else {
      return `<div class="links-row links-row-dim" data-id="${idStr}">
        <div class="links-indicator links-ind-off" title="Unlinked"></div>
        <div class="links-row-body">
          <div class="links-row-name">${escapeHtml(e.name || '—')} ${sub}</div>
        </div>
        <div class="links-row-btns">
          <button class="btn btn-ghost btn-xs links-link-btn" data-id="${idStr}" data-name="${escapeHtml(e.name || '')}">Link</button>
        </div>
      </div>`;
    }
  }).join('');
}

// ── Link / unlink actions ─────────────────────────────────────────────────

async function _doLink(id, filePath) {
  try {
    const content = await invoke('read_text_file', { path: filePath });
    await invoke('write_text_file', { path: filePath, content: _fmSetField(content, 'rpgmanager_id', id) });
    const name = filePath.split('/').pop().replace(/\.md$/, '');
    _linksVaultMap[String(id)] = { name, path: filePath, relPath: filePath.slice(VAULT_PATH.length + 1) };
    _renderLinksList();
    showToast('Linked!', 'success');
  } catch (e) {
    showToast(`Link failed: ${e.message}`);
  }
}

async function _doUnlink(id, filePath) {
  try {
    const content = await invoke('read_text_file', { path: filePath });
    await invoke('write_text_file', { path: filePath, content: _fmRemoveField(content, 'rpgmanager_id') });
    delete _linksVaultMap[String(id)];
    _renderLinksList();
    showToast('Unlinked', 'success');
  } catch (e) {
    showToast(`Unlink failed: ${e.message}`);
  }
}

// ── File picker modal ─────────────────────────────────────────────────────

function _openLinkPicker(id, entityName) {
  return new Promise(resolve => {
    const modal  = document.getElementById('links-pick-modal');
    const title  = document.getElementById('links-pick-title');
    const search = document.getElementById('links-pick-search');
    const list   = document.getElementById('links-pick-list');
    const cancel = document.getElementById('links-pick-cancel');

    title.textContent = `Link "${entityName}" to Vault File`;
    search.value = entityName;
    modal.style.display = 'flex';

    function renderPicker(query) {
      const q = query.trim().toLowerCase();
      const files = (q
        ? _linksAllFiles.filter(f => f.name.toLowerCase().includes(q) || f.relPath.toLowerCase().includes(q))
        : _linksAllFiles
      ).slice(0, 80);

      list.innerHTML = files.length
        ? files.map(f => {
            const folder = f.relPath.split('/').slice(0, -1).join(' / ');
            return `<div class="links-pick-item" data-path="${escapeHtml(f.path)}">
              <div class="links-pick-name">${escapeHtml(f.name)}</div>
              ${folder ? `<div class="links-pick-folder">${escapeHtml(folder)}</div>` : ''}
            </div>`;
          }).join('')
        : '<div class="vault-placeholder">No files match.</div>';
    }

    renderPicker(entityName);
    requestAnimationFrame(() => { search.focus(); search.select(); });

    let st = null;
    const onInput = () => { clearTimeout(st); st = setTimeout(() => renderPicker(search.value), 150); };
    const onPick  = async e => {
      const item = e.target.closest('.links-pick-item');
      if (!item) return;
      cleanup(); resolve(item.dataset.path);
      await _doLink(id, item.dataset.path);
    };
    const onCancel = () => { cleanup(); resolve(null); };

    function cleanup() {
      modal.style.display = 'none';
      search.removeEventListener('input', onInput);
      list.removeEventListener('click', onPick);
      cancel.removeEventListener('click', onCancel);
    }

    search.addEventListener('input', onInput);
    list.addEventListener('click', onPick);
    cancel.addEventListener('click', onCancel);
  });
}

// ── Event delegation for links list ──────────────────────────────────────

document.getElementById('links-list').addEventListener('click', async e => {
  const openBtn   = e.target.closest('.links-open-btn');
  const unlinkBtn = e.target.closest('.links-unlink-btn');
  const linkBtn   = e.target.closest('.links-link-btn');

  if (openBtn) {
    const url = buildObsidianUrl(openBtn.dataset.path);
    if (url) invoke('open_file', { path: url });
  } else if (unlinkBtn) {
    await _doUnlink(unlinkBtn.dataset.id, unlinkBtn.dataset.path);
  } else if (linkBtn) {
    await _openLinkPicker(linkBtn.dataset.id, linkBtn.dataset.name);
  }
});

document.getElementById('links-type-select').addEventListener('change', e => {
  _linksEntityType = e.target.value;
  _linksLoaded = false;
  loadLinksTab();
});

document.getElementById('links-refresh-btn').addEventListener('click', () => {
  _linksLoaded = false;
  loadLinksTab(true);
});

document.getElementById('links-search').addEventListener('input', e => {
  _linksSearchQuery = e.target.value;
  clearTimeout(_linksSearchTimeout);
  _linksSearchTimeout = setTimeout(_renderLinksList, 200);
});
