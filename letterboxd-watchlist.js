// letterboxd-watchlist.js (self-heal версия)
(function () {
  const WORKER = 'https://lbox-proxy.nellrun.workers.dev/';
  const DEFAULT_USER = 'Nellrun';
  const MAX_PAGES = 3;
  const BLOCK_ID = 'lb-items-line';

  const LB_USER = (window.localStorage && localStorage.getItem('lb_user')) || DEFAULT_USER;
  if (window.__lb_watchlist_installed) return;
  window.__lb_watchlist_installed = true;

  // ---------- utils ----------
  const esc = s => (s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const tmdbImg = p => p ? (/^https?:\/\//.test(p) ? p : `https://image.tmdb.org/t/p/w300${p}`) : './img/img_load.svg';

  function normalize(raw) {
    const r = raw && (raw.tmdb || raw) || {};
    const type = r.type || (r.media_type === 'tv' ? 'tv' : (r.media_type === 'movie' ? 'movie' : 'movie'));
    const title = r.title || r.name || r.original_title || r.original_name || '';
    const date  = r.year || r.release_date || r.first_air_date || '';
    const year  = String(date).slice(0, 4);
    const id = Number(r.id ?? r.tmdb_id ?? r.tmdbId ?? r.movie_id ?? r.tv_id) || null;
    return { id, type, title, year, poster: r.poster || r.poster_path || '', vote: r.vote || r.vote_average };
  }

  const dedupe = arr => {
    const seen = new Set(), out = [];
    for (const it of arr) {
      const n = normalize(it);
      const key = `${n.type}:${n.id || n.title}:${n.year}`;
      if (!seen.has(key)) { seen.add(key); out.push(it); }
    }
    return out;
  };

  async function fetchPage(user, page) {
    let url = `${WORKER}?user=${encodeURIComponent(user)}&page=${page}`;
    try {
      const r = await fetch(url, { credentials: 'omit' });
      if (r.ok) {
        const j = await r.json();
        if (j && Array.isArray(j.items)) return j.items;
      }
    } catch {}
    if (page === 1) {
      url = `${WORKER}?user=${encodeURIComponent(user)}&pages=${MAX_PAGES}`;
      try {
        const r = await fetch(url, { credentials: 'omit' });
        if (r.ok) {
          const j = await r.json();
          if (j && Array.isArray(j.items)) return j.items;
        }
      } catch {}
    }
    return [];
  }

  async function fetchAll(user) {
    const all = [];
    for (let p = 1; p <= MAX_PAGES; p++) {
      const items = await fetchPage(user, p);
      if (!items.length && p > 1) break;
      all.push(...items);
    }
    return dedupe(all);
  }

  function makeCardHTML(n) {
    const vote = n.vote ? `<div class="card__vote">${(+n.vote).toFixed(1).replace(/\.0$/,'')}</div>` : '';
    const typeBadge = n.type === 'tv' ? '<div class="card__type">TV</div>' : '';
    const typeClass = n.type === 'tv' ? 'card--tv' : '';
    return `
      <div class="card selector layer--visible layer--render ${typeClass}"
           data-id="${n.id || ''}" data-type="${n.type}"
           data-title="${esc(n.title)}" data-year="${n.year || ''}">
        <div class="card__view">
          <img class="card__img" src="${tmdbImg(n.poster)}">
          <div class="card__icons"><div class="card__icons-inner"></div></div>
          ${typeBadge}${vote}
        </div>
        <div class="card__title">${esc(n.title)}</div>
        <div class="card__age">${n.year || ''}</div>
      </div>`;
  }

  const isHome = () => /Home/i.test((document.querySelector('.head__title')?.textContent || '').trim());
  const findHomeScrollBody = () => document.querySelector('.activity.activity--active .scroll__body');

  function ensureStyles() {
    if (document.getElementById('lb-watchlist-style')) return;
    const st = document.createElement('style');
    st.id = 'lb-watchlist-style';
    st.textContent = `
      #${BLOCK_ID} .lb-refresh{margin-left:8px;font-size:.9em;opacity:.7;cursor:pointer}
      #${BLOCK_ID} .lb-refresh:hover{opacity:1;text-decoration:underline}
      #${BLOCK_ID} .lb-status{margin:6px 0 8px 0;font-size:.9em;opacity:.75}
    `;
    document.head.appendChild(st);
  }

  function buildBlock() {
    ensureStyles();
    const host = findHomeScrollBody();
    if (!host) return null;

    const old = document.getElementById(BLOCK_ID);
    if (old) old.remove();

    const block = document.createElement('div');
    block.className = 'items-line layer--visible layer--render items-line--type-default';
    block.id = BLOCK_ID;
    block.innerHTML = `
      <div class="items-line__head">
        <div class="items-line__title">Letterboxd Watchlist
          <span class="lb-refresh">Обновить</span>
        </div>
        <div class="items-line__more selector" style="display:none">More</div>
      </div>
      <div class="lb-status" style="display:none">Загрузка…</div>
      <div class="items-line__body">
        <div class="scroll scroll--horizontal">
          <div class="scroll__content"><
            div class="scroll__body mapping--line"></div>
          </div>
        </div>
      </div>`.replace('<\n            div','<div'); // мелкий фикс на случай минификатора

    // Самый верх Home
    const first = host.querySelector('.items-line');
    if (first) host.insertBefore(block, first);
    else host.prepend(block);

    block.addEventListener('click', onCardClick);
    block.querySelector('.lb-refresh')?.addEventListener('click', ev => { ev.stopPropagation(); reload(block, true); });
    block.setAttribute('data-lb-keep', '1'); // подсказка на будущее

    return block;
  }

  async function reload(block, force) {
    const status = block.querySelector('.lb-status');
    const body = block.querySelector('.scroll__body');
    if (status) status.style.display = '';
    if (force && body) body.innerHTML = '';

    let items = [];
    try { items = await fetchAll(LB_USER); } catch(e){ console.error('[LB] fetch error', e); }

    const html = items.map(it => makeCardHTML(normalize(it))).join('');
    if (body && (force || !body.children.length)) body.innerHTML = html || '';
    if (status) status.style.display = 'none';
  }

  function onCardClick(e) {
    const card = e.target.closest(`#${BLOCK_ID} .card.selector`);
    if (!card) return;
    const id = Number(card.dataset.id || '');
    const method = card.dataset.type === 'tv' ? 'tv' : 'movie';
    const title = card.dataset.title || card.querySelector('.card__title')?.textContent?.trim() || '';
    const year  = card.dataset.year  || card.querySelector('.card__age')?.textContent?.trim()  || '';

    if (id) {
      try {
        Lampa.Activity.push({
          component: 'full',
          id, method, source: 'tmdb',
          param: { id, method, source: 'tmdb' },
          card: { id, title, name: title, original_title: title, release_date: year ? `${year}-01-01` : '' }
        });
        return;
      } catch (err) { console.warn('[LB] Activity.push failed, fallback to search', err); }
    }
    Lampa.Activity.push({ component: 'search', query: `${title} ${year}`.trim(), source: 'tmdb' });
  }

  // ---------- bootstrap + self-heal ----------
  function ensureOnHome() {
    if (!isHome()) return;
    const host = findHomeScrollBody();
    if (!host) return;

    // если блока нет или он не в текущем host — создаем заново
    let block = document.getElementById(BLOCK_ID);
    if (!block || !host.contains(block)) {
      block = buildBlock();
      if (block) reload(block, true);
      return;
    }

    // если внезапно кто-то подчистил контент — восстановим
    const body = block.querySelector('.scroll__body');
    if (body && !body.children.length) reload(block, true);
  }

  // наблюдаем все мутации, без «booted»-затычек, чтобы можно было пересоздавать бесконечно
  const mo = new MutationObserver(() => { try { ensureOnHome(); } catch {} });
  mo.observe(document.body, { subtree: true, childList: true });

  // подстраховка от «назад/вперед» и ленивых перерисовок
  window.addEventListener('popstate', ensureOnHome, { passive: true });
  window.addEventListener('visibilitychange', ensureOnHome, { passive: true });

  // тихий хелсчек раз в секунду (дешево, зато надежно)
  setInterval(ensureOnHome, 1000);

  // первая попытка
  ensureOnHome();
})();
