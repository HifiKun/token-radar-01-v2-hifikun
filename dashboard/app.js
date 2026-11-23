/* Token Radar v3 — renders window.RADAR (written by main.ts as data.js) with no network.
   Deep links for screenshots: #detail=<slug> opens a protocol, #watchlist=1 filters to
   the house watchlist, #cat=<category> filters by category, #q=<text> searches. */
(function () {
  'use strict';
  var R = window.RADAR;
  if (!R) {
    document.getElementById('meta').textContent = 'No data: data.js did not load.';
    return;
  }

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var fmtUsd = function (n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  };
  var fmtPct = function (n) {
    if (n === null || n === undefined) return '—';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  };
  var fmtAge = function (d) {
    if (d === null || d === undefined) return '—';
    if (d < 30) return d + 'd';
    if (d < 365) return Math.round(d / 30) + 'mo';
    return (d / 365).toFixed(1) + 'y';
  };
  var pctClass = function (n) { return n === null ? '' : n < 0 ? 'neg' : n > 0 ? 'pos' : ''; };

  /* ---- header stats ---- */
  var totalImplied = R.rows.reduce(function (s, r) { return s + r.implied_value_usd; }, 0);
  $('meta').textContent =
    'Snapshot ' + R.as_of + ' · ' + R.board_size + ' pre-token protocols ranked · ' +
    R.watchlist_size + ' on the house watchlist · floor $' + (R.floor_usd / 1e6).toFixed(0) + 'M TVL';
  $('stats').innerHTML =
    '<div class="stat"><b>' + R.board_size + '</b><span>Protocols ranked</span></div>' +
    '<div class="stat"><b>' + fmtUsd(totalImplied) + '</b><span>Total implied value</span></div>' +
    '<div class="stat"><b>' + fmtUsd(R.rows[0].implied_value_usd) + '</b><span>Top implied · ' + esc(R.rows[0].name) + '</span></div>' +
    '<div class="stat"><b>' + R.model_version + '</b><span>Model · market multiples</span></div>';
  $('count-board').textContent = '(' + R.board_size + ')';
  $('count-live').textContent = '(' + R.live_size + ')';

  /* ---- market multiples table ---- */
  var multRows = Object.keys(R.multiples).map(function (cat) {
    return { cat: cat, m: R.multiples[cat] };
  });
  multRows.sort(function (a, b) { return b.m.multiple - a.m.multiple; });
  var multHtml = multRows.map(function (r) {
    return '<tr><td>' + esc(r.cat) + '</td><td class="num">' + r.m.multiple.toFixed(2) +
      '</td><td class="num">' + r.m.comps + '</td></tr>';
  }).join('');
  multHtml += '<tr><td>All other categories <span class="fb">(fallback)</span></td><td class="num">' +
    R.global_multiple.toFixed(2) + '</td><td class="num">—</td></tr>';
  $('multiple-rows').innerHTML = multHtml;

  /* ---- filter options ---- */
  var cats = {};
  var chains = {};
  R.rows.forEach(function (r) {
    if (r.category) cats[r.category] = true;
    r.chains.forEach(function (c) { chains[c] = true; });
  });
  Object.keys(cats).sort().forEach(function (c) {
    $('cat').insertAdjacentHTML('beforeend', '<option>' + esc(c) + '</option>');
  });
  Object.keys(chains).sort().forEach(function (c) {
    $('chain').insertAdjacentHTML('beforeend', '<option>' + esc(c) + '</option>');
  });

  var view = 'board';
  var detailSlug = null;

  function currentRows() {
    var q = $('q').value.trim().toLowerCase();
    var cat = $('cat').value;
    var chain = $('chain').value;
    var sort = $('sort').value;
    var readyMin = parseInt($('ready').value, 10);
    var wlOnly = $('watchlist-only').checked;
    var list = (view === 'board' ? R.rows : R.live).filter(function (r) {
      if (q && (r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0)) return false;
      if (cat && r.category !== cat) return false;
      if (chain && r.chains.indexOf(chain) < 0) return false;
      if (view === 'board' && readyMin > 0 && r.readiness < readyMin) return false;
      if (view === 'board' && wlOnly && !r.on_watchlist) return false;
      return true;
    });
    var by = {
      value: function (a, b) { return (b.implied_value_usd || 0) - (a.implied_value_usd || 0); },
      readiness: function (a, b) { return (b.readiness || 0) - (a.readiness || 0) || (b.implied_value_usd || 0) - (a.implied_value_usd || 0); },
      tvl: function (a, b) { return b.tvl_usd - a.tvl_usd; },
      growth: function (a, b) { return (b.change_7d || 0) - (a.change_7d || 0); },
      age: function (a, b) { return (b.age_days || 0) - (a.age_days || 0); },
      name: function (a, b) { return a.name.localeCompare(b.name); },
    };
    if (view === 'board') list.sort(by[sort] || by.value);
    else list.sort(function (a, b) { return (b.mcap_usd || 0) - (a.mcap_usd || 0); });
    return list;
  }

  function rowHtml(r) {
    if (view === 'board') {
      return '<tr data-slug="' + esc(r.slug) + '"' + (r.slug === detailSlug ? ' class="selected"' : '') + '>' +
        '<td class="num">' + r.rank + '</td>' +
        '<td><strong>' + esc(r.name) + '</strong><br><span class="slug">' + esc(r.slug) + '</span>' +
        (r.on_watchlist ? ' <span class="wl" title="On the house watchlist">★</span>' : '') + '</td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td>' + esc(r.chains.slice(0, 2).join(', ') || '—') + '</td>' +
        '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
        '<td class="num ' + pctClass(r.change_7d) + '">' + fmtPct(r.change_7d) + '</td>' +
        '<td class="num">' + fmtAge(r.age_days) + '</td>' +
        '<td class="num ready">' + r.readiness + '</td>' +
        '<td class="num"><strong>' + fmtUsd(r.implied_value_usd) + '</strong></td></tr>';
    }
    return '<tr><td class="num">—</td>' +
      '<td><strong>' + esc(r.name) + '</strong><br><span class="slug">' + esc(r.slug) + '</span></td>' +
      '<td>' + esc(r.category || '—') + '</td>' +
      '<td>' + esc(r.chains.slice(0, 2).join(', ') || '—') + '</td>' +
      '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
      '<td class="num ' + pctClass(r.change_7d) + '">' + fmtPct(r.change_7d) + '</td>' +
      '<td class="num">—</td><td class="num">—</td>' +
      '<td class="num"><strong>' + fmtUsd(r.mcap_usd || 0) + '</strong></td></tr>';
  }

  function render() {
    var list = currentRows();
    $('rows').innerHTML = list.slice(0, 200).map(rowHtml).join('');
    $('empty').hidden = list.length > 0;
    $('result-count').textContent = list.length + (view === 'board' ? ' pre-token protocols' : ' live-token protocols') +
      (list.length > 200 ? ' · showing top 200' : '');
    var head = document.querySelector('#board thead tr');
    head.children[7].textContent = view === 'board' ? 'Ready' : '—';
    head.children[8].textContent = view === 'board' ? 'Implied value' : 'Market cap';
  }

  function showDetail(slug, viaHash) {
    var r = null;
    for (var i = 0; i < R.rows.length; i++) if (R.rows[i].slug === slug) { r = R.rows[i]; break; }
    var box = $('detail');
    if (!r) { box.hidden = true; detailSlug = null; render(); return; }
    detailSlug = slug;
    if (viaHash) document.body.classList.add('detail-mode');
    var multSrc = r.multiple_comps > 0
      ? 'median mcap/TVL of ' + r.multiple_comps + ' live ' + esc(r.category || '') + ' protocols'
      : 'fallback: median across all live-token protocols';
    box.innerHTML =
      (viaHash ? '<p><a href="#" id="back-board">&larr; Back to the full board</a></p>' : '') +
      '<h2>#' + r.rank + ' · ' + esc(r.name) + '</h2>' +
      '<p class="sub">' + esc(r.slug) + ' · ' + esc(r.category || 'uncategorised') + ' · ' +
      esc(r.chains.join(', ') || 'no chain listed') + ' · TVL ' + fmtUsd(r.tvl_usd) +
      ' · 7d ' + fmtPct(r.change_7d) + ' · age ' + fmtAge(r.age_days) +
      (r.on_watchlist ? ' · ★ on the house watchlist' : ' · below the house floor — early') + '</p>' +
      '<h3>Why this rank</h3><div class="math">' +
      '<div><b>' + fmtUsd(r.implied_value_usd) + '</b><span>Implied value</span></div>' +
      '<div><b>' + r.market_multiple.toFixed(2) + '×</b><span>Market multiple · ' + multSrc + '</span></div>' +
      '<div><b>' + r.growth_multiplier.toFixed(2) + '×</b><span>Growth · 7d ' + fmtPct(r.change_7d) + '</span></div>' +
      '<div><b>' + r.maturity_multiplier.toFixed(2) + '×</b><span>Maturity · ' + fmtAge(r.age_days) + '</span></div>' +
      '<div><b>' + r.readiness + ' / 100</b><span>Readiness</span></div></div>' +
      '<h3>Farm plan — seven steps</h3><ol class="steps">' +
      r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>' +
      '<p class="fine">Implied value = TVL × ' + r.market_multiple.toFixed(2) + ' × ' +
      r.growth_multiplier.toFixed(2) + ' × ' + r.maturity_multiplier.toFixed(2) +
      ' = ' + fmtUsd(r.implied_value_usd) + '. This entry\'s own claim, never a prediction that a token will be issued.</p>';
    box.hidden = false;
    render();
    if (!viaHash) box.scrollIntoView({ block: 'nearest' });
  }

  /* Back from a hash-opened detail view: restore the board. */
  $('detail').addEventListener('click', function (ev) {
    if (ev.target && ev.target.id === 'back-board') {
      ev.preventDefault();
      document.body.classList.remove('detail-mode');
      detailSlug = null;
      $('detail').hidden = true;
      if (history.replaceState) history.replaceState(null, '', location.pathname);
      render();
    }
  });

  $('rows').addEventListener('click', function (ev) {
    var tr = ev.target.closest('tr[data-slug]');
    if (!tr) return;
    if (history.replaceState) history.replaceState(null, '', '#detail=' + tr.getAttribute('data-slug'));
    showDetail(tr.getAttribute('data-slug'));
  });
  ['q', 'cat', 'chain', 'sort', 'ready', 'watchlist-only'].forEach(function (id) {
    $(id).addEventListener('input', function () { render(); });
    $(id).addEventListener('change', function () { render(); });
  });
  $('tab-board').addEventListener('click', function () {
    view = 'board';
    $('tab-board').classList.add('active');
    $('tab-live').classList.remove('active');
    render();
  });
  $('tab-live').addEventListener('click', function () {
    view = 'live';
    $('tab-live').classList.add('active');
    $('tab-board').classList.remove('active');
    render();
  });

  /* ---- deep links: #detail=<slug>, #watchlist=1, #cat=<category>, #q=<text> ---- */
  var hash = (location.hash || '').slice(1);
  var params = {};
  hash.split('&').forEach(function (pair) {
    var kv = pair.split('=');
    if (kv[0]) params[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || '');
  });
  if (params.watchlist === '1') $('watchlist-only').checked = true;
  if (params.cat) $('cat').value = params.cat;
  if (params.q) $('q').value = params.q;
  if (params.sort) $('sort').value = params.sort;
  render();
  if (params.detail) showDetail(params.detail, true);
})();
