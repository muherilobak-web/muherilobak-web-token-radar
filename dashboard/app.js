// app.js — renders the token radar from window.RADAR (written by main.ts
// into data.js from the same board as board.json). No network, no framework:
// sort, filter, search, tabs and the detail view all run on the data already
// in the page.

const RADAR = window.RADAR;
const rows = RADAR.rows;
const live = RADAR.live;
const maxImplied = rows.length > 0 ? rows[0].implied_value_usd : 1;

const $ = (id) => document.getElementById(id);
const boardBody = document.querySelector('#board tbody');
const liveBody = document.querySelector('#live tbody');

function esc(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function fmtMoney(n) {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${Math.round(n)}`;
}

function fmtPct(v) {
  if (v === null || v === undefined) return '—';
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(2)}%`;
}

function fmtAge(days) {
  if (days === null || days === undefined) return '—';
  if (days >= 365) return `${(days / 365).toFixed(1)}y`;
  return `${days}d`;
}

function fmtMult(m) {
  return `×${m.toFixed(3)}`;
}

/** Recompute one row's implied value from its own factors, in the page. */
function impliedOf(row) {
  const f = row.factors;
  return Math.max(
    1,
    Math.round(row.tvl_usd * f.multiple * f.growth_mult * f.maturity_mult * f.chain_breadth),
  );
}

const state = {
  q: '',
  category: '',
  chain: '',
  watchlistOnly: false,
  growingOnly: false,
  tab: 'pre',
  sortKey: 'rank',
  sortDir: 1,
  selected: null,
};

function readHash() {
  const hash = new URLSearchParams(window.location.hash.slice(1));
  state.q = hash.get('q') ?? '';
  state.category = hash.get('category') ?? '';
  state.chain = hash.get('chain') ?? '';
  state.watchlistOnly = hash.get('w') === '1';
  state.growingOnly = hash.get('g') === '1';
  state.tab = hash.get('tab') === 'live' ? 'live' : 'pre';
  state.selected = hash.get('p') ?? null;
}

function writeHash() {
  const hash = new URLSearchParams();
  if (state.q) hash.set('q', state.q);
  if (state.category) hash.set('category', state.category);
  if (state.chain) hash.set('chain', state.chain);
  if (state.watchlistOnly) hash.set('w', '1');
  if (state.growingOnly) hash.set('g', '1');
  if (state.tab === 'live') hash.set('tab', 'live');
  if (state.selected) hash.set('p', state.selected);
  const text = hash.toString();
  history.replaceState(null, '', text ? `#${text}` : window.location.pathname);
}

function sortValue(row, key) {
  if (key === 'rank') return row.rank;
  if (key === 'name') return row.name.toLowerCase();
  if (key === 'tvl_usd') return row.tvl_usd;
  if (key === 'change_7d') return row.change_7d === null ? -Infinity : row.change_7d;
  if (key === 'age') return row.factors.age_days === null ? -Infinity : row.factors.age_days;
  if (key === 'implied_value_usd') return row.implied_value_usd;
  return row.rank;
}

function filteredRows() {
  const q = state.q.trim().toLowerCase();
  let out = rows.filter((r) => {
    if (state.watchlistOnly && !r.watchlist) return false;
    if (state.growingOnly && !(r.change_7d !== null && r.change_7d > 0)) return false;
    if (state.category) {
      if (state.category === '__null__') {
        if (r.category !== null) return false;
      } else if (r.category !== state.category) {
        return false;
      }
    }
    if (state.chain && !r.chains.includes(state.chain)) return false;
    if (q) {
      const hay = `${r.name} ${r.category ?? ''} ${r.chains.join(' ')}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const dir = state.sortDir;
  const key = state.sortKey;
  out = [...out].sort((a, b) => {
    const av = sortValue(a, key);
    const bv = sortValue(b, key);
    if (av < bv) return -dir;
    if (av > bv) return dir;
    return a.rank - b.rank;
  });
  return out;
}

function tagHtml(row) {
  return row.watchlist
    ? '<span class="tag tag-watch">WATCHLIST</span>'
    : '<span class="tag tag-early">EARLY</span>';
}

function renderBoard() {
  const list = filteredRows();
  $('count').textContent = `${list.length} rows shown`;
  boardBody.innerHTML = list
    .map((r) => {
      const change = r.change_7d;
      const changeCls = change === null ? '' : change > 0 ? 'up' : change < 0 ? 'down' : '';
      const width = Math.max(2, (r.implied_value_usd / maxImplied) * 100).toFixed(1);
      const chains = r.chains.slice(0, 2).join(', ');
      const sub = `${esc(r.category ?? 'Uncategorised')}${chains ? ` on ${esc(chains)}` : ''}`;
      return `<tr data-slug="${esc(r.slug)}" class="${r.rank <= 3 ? 'top3' : ''} ${state.selected === r.slug ? 'selected' : ''}">
        <td class="rank">${r.rank}</td>
        <td><div class="proto-name">${esc(r.name)}${tagHtml(r)}</div><div class="proto-sub">${sub}</div></td>
        <td class="num">${fmtMoney(r.tvl_usd)}</td>
        <td class="num ${changeCls}">${fmtPct(change)}</td>
        <td class="num">${fmtAge(r.factors.age_days)}</td>
        <td><span class="bar-track"><span class="bar-fill" style="width:${width}%"></span></span><span class="implied">${fmtMoney(r.implied_value_usd)}</span></td>
        <td class="status">no token</td>
      </tr>`;
    })
    .join('');
}

function renderLive() {
  liveBody.innerHTML = live
    .map((r, i) => {
      const change = r.change_7d;
      const changeCls = change === null ? '' : change > 0 ? 'up' : change < 0 ? 'down' : '';
      const chains = r.chains.slice(0, 2).join(', ');
      const sub = `${esc(r.category ?? 'Uncategorised')}${chains ? ` on ${esc(chains)}` : ''}`;
      return `<tr>
        <td class="rank">${i + 1}</td>
        <td><div class="proto-name">${esc(r.name)}</div><div class="proto-sub">${sub}</div></td>
        <td class="num">${fmtMoney(r.tvl_usd)}</td>
        <td class="num">${fmtMoney(r.mcap_usd)}</td>
        <td class="num">${r.mcap_per_tvl.toFixed(2)}</td>
        <td class="num ${changeCls}">${fmtPct(change)}</td>
      </tr>`;
    })
    .join('');
  $('count').textContent = `${live.length} live-token leaders shown`;
}

function renderChart() {
  const top = rows.slice(0, 6);
  const width = 1240;
  const rowH = 30;
  const height = top.length * rowH + 8;
  const labelW = 230;
  const valueW = 110;
  const barMax = width - labelW - valueW - 20;
  const lines = top
    .map((r, i) => {
      const y = 8 + i * rowH + 17;
      const barW = Math.max(3, (r.implied_value_usd / maxImplied) * barMax);
      return `<text class="bar-name" x="0" y="${y}" font-size="14">${esc(r.name)}</text>` +
        `<rect x="${labelW}" y="${8 + i * rowH + 6}" width="${barW.toFixed(1)}" height="18" rx="4" fill="#2dd4a7" />` +
        `<text class="bar-value" x="${labelW + barW + 10}" y="${y}" font-size="14">${fmtMoney(r.implied_value_usd)}</text>`;
    })
    .join('');
  $('chart').innerHTML =
    `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Top 6 protocols by implied value">${lines}</svg>`;
}

function renderDetail() {
  const panel = $('detail');
  const row = rows.find((r) => r.slug === state.selected);
  if (!row) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  const f = row.factors;
  $('detail-rank').textContent = `Rank ${row.rank} of ${rows.length}`;
  $('detail-name').textContent = row.name;
  $('detail-sub').textContent =
    `${row.category ?? 'Uncategorised'} on ${row.chains.join(', ') || 'no chain listed'} · TVL ${fmtMoney(row.tvl_usd)} · 7d ${fmtPct(row.change_7d)} · age ${fmtAge(f.age_days)}`;
  $('detail-tag').innerHTML = row.watchlist
    ? '<span class="tag tag-watch">WATCHLIST</span> On the house watchlist: $50M+ TVL, no token on record.'
    : '<span class="tag tag-early">EARLY</span> Found by the radar beyond the house watchlist, on the same rule.';
  const recomputed = impliedOf(row);
  const matches = recomputed === row.implied_value_usd;
  $('detail-breakdown').innerHTML = `
    <div><dt>TVL</dt><dd>${fmtMoney(row.tvl_usd)}</dd></div>
    <div><dt>Category multiple<span class="factor-note">${esc(row.category ?? 'default')} · ${f.multiple.toFixed(2)} per $1 of TVL</span></dt><dd>${fmtMult(f.multiple)}</dd></div>
    <div><dt>Growth multiplier<span class="factor-note">7-day change ${fmtPct(row.change_7d)}</span></dt><dd>${fmtMult(f.growth_mult)}</dd></div>
    <div><dt>Maturity multiplier<span class="factor-note">age ${fmtAge(f.age_days)} with no token</span></dt><dd>${fmtMult(f.maturity_mult)}</dd></div>
    <div><dt>Chain breadth<span class="factor-note">${row.chains.length} chain${row.chains.length === 1 ? '' : 's'}</span></dt><dd>${fmtMult(f.chain_breadth)}</dd></div>
    <div><dt>Implied value</dt><dd>${fmtMoney(row.implied_value_usd)}</dd></div>`;
  $('detail-recompute').innerHTML = matches
    ? `The page recomputes this row as <strong>${fmtMoney(recomputed)}</strong> — the same number board.json carries. This is an estimate, not a price.`
    : `The page recomputes this row as <strong>${fmtMoney(recomputed)}</strong>, which does not match board.json (${fmtMoney(row.implied_value_usd)}).`;
  $('detail-farm').innerHTML = row.farm_steps.map((s) => `<li>${esc(s)}</li>`).join('');
  $('detail-record').textContent = `DefiLlama record: defillama.com/protocol/${row.slug}`;
}

function renderTabs() {
  const pre = state.tab === 'pre';
  $('tab-pre').setAttribute('aria-selected', String(pre));
  $('tab-live').setAttribute('aria-selected', String(!pre));
  $('board').hidden = !pre;
  $('live').hidden = pre;
  document.querySelector('.board-note').textContent = pre
    ? 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.'
    : 'The largest live-token protocols by market cap, set aside from the board. Market cap per dollar of TVL is what the model’s multiples are checked against.';
  if (pre) renderBoard();
  else renderLive();
}

function renderAll() {
  renderTabs();
  renderDetail();
}

function initControls() {
  const categories = [...new Set(rows.map((r) => r.category ?? 'Uncategorised'))].sort();
  $('category').innerHTML =
    '<option value="">All categories</option>' +
    categories.map((c) => `<option value="${esc(c === 'Uncategorised' ? '__null__' : c)}">${esc(c)}</option>`).join('');
  const chainCounts = new Map();
  for (const r of rows) for (const c of r.chains) chainCounts.set(c, (chainCounts.get(c) ?? 0) + 1);
  const chains = [...chainCounts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  $('chain').innerHTML =
    '<option value="">All chains</option>' +
    chains.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');

  $('q').value = state.q;
  $('category').value = state.category;
  $('chain').value = state.chain;
  $('watchlist-only').checked = state.watchlistOnly;
  $('growing-only').checked = state.growingOnly;

  $('q').addEventListener('input', (e) => { state.q = e.target.value; writeHash(); renderBoard(); });
  $('category').addEventListener('change', (e) => { state.category = e.target.value; writeHash(); renderBoard(); });
  $('chain').addEventListener('change', (e) => { state.chain = e.target.value; writeHash(); renderBoard(); });
  $('watchlist-only').addEventListener('change', (e) => { state.watchlistOnly = e.target.checked; writeHash(); renderBoard(); });
  $('growing-only').addEventListener('change', (e) => { state.growingOnly = e.target.checked; writeHash(); renderBoard(); });
  $('tab-pre').addEventListener('click', () => { state.tab = 'pre'; writeHash(); renderTabs(); });
  $('tab-live').addEventListener('click', () => { state.tab = 'live'; writeHash(); renderTabs(); });

  document.querySelectorAll('#board thead th[data-sort]').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (state.sortKey === key) {
        state.sortDir = -state.sortDir;
      } else {
        state.sortKey = key;
        state.sortDir = key === 'name' ? 1 : -1;
      }
      document.querySelectorAll('#board thead th').forEach((h) => h.removeAttribute('aria-sort'));
      th.setAttribute('aria-sort', state.sortDir === 1 ? 'ascending' : 'descending');
      renderBoard();
    });
  });

  boardBody.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-slug]');
    if (!tr) return;
    state.selected = state.selected === tr.dataset.slug ? null : tr.dataset.slug;
    writeHash();
    renderBoard();
    renderDetail();
  });
  $('detail-close').addEventListener('click', () => {
    state.selected = null;
    writeHash();
    renderBoard();
    renderDetail();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.selected) {
      state.selected = null;
      writeHash();
      renderBoard();
      renderDetail();
    }
  });
}

function initStats() {
  const watchlistRows = rows.filter((r) => r.watchlist).length;
  $('meta-snapshot').textContent = RADAR.as_of;
  $('meta-model').textContent = RADAR.model;
  $('hero-count').textContent = String(rows.length);
  $('stat-watchlist').innerHTML = `${watchlistRows} <small>/ ${RADAR.watchlist_count}</small>`;
  $('stat-rows').textContent = String(rows.length);
  $('stat-early').textContent = String(rows.length - watchlistRows);
  $('stat-live').textContent = String(RADAR.live_total);
  const median = RADAR.live_median_mcap_per_tvl;
  $('live-check').textContent =
    `The 24 largest live-token protocols in this snapshot trade at a median $${median.toFixed(2)} of market cap per $1 of TVL. The model applies 0.20–0.35 — a launch discount against live comps, because a new token has no trading history, no liquidity depth and no proven fee capture.`;
}

readHash();
initStats();
initControls();
renderChart();
renderLive();
renderAll();
