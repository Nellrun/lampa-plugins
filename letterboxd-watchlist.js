(function () {
  // настройки
  const USER = 'Nellrun';
  const MAX_PAGES = 3;
  const WORKER = 'https://lbox-proxy.nellrun.workers.dev/';

  const rootSel = '.activity__body .scroll__body';

  function ensureRow() {
    const root = document.querySelector(rootSel);
    if (!root) return null;

    let line = document.getElementById('lb-items-line');
    if (!line) {
      line = document.createElement('div');
      line.id = 'lb-items-line';
      line.className = 'items-line';
      line.innerHTML = `
        <div class="items-line__head">
          <div class="items-line__title">Letterboxd Watchlist
            <span class="lb-refresh" style="margin-left:.75rem;opacity:.7;cursor:pointer">Обновить</span>
          </div>
        </div>
        <div class="items-line__body">
          <div class="scroll scroll--horizontal">
            <div class="scroll__content"><div class="scroll__body mapping--line"></div></div>
          </div>
        </div>`;
    }
    const first = root.querySelector('.items-line');
    if (line !== first) root.insertBefore(line, first || root.firstChild);
    return line.querySelector('.mapping--line');
  }

  function tmdbImg(path) {
    return path ? 'https://image.tmdb.org/t/p/w300' + path : './img/img_broken.svg';
  }

  function normalize(raw) {
    const r = raw.tmdb || raw;
    return {
      id: r.id,
      type: r.type || (r.media_type === 'tv' ? 'tv' : 'movie'),
      title: r.title || r.name,
      year: r.year || (r.release_date || r.first_air_date || '').slice(0,4),
      poster: r.poster || r.poster_path,
      vote: r.vote || r.vote_average
    };
  }

  function cardHTML(item) {
    const vote = item.vote ? `<div class="card__vote">${(+item.vote).toFixed(1).replace(/\.0$/,'')}</div>` : '';
    const tv   = item.type === 'tv' ? `<div class="card__type">TV</div>` : '';
    return `
      <div class="card selector layer--visible layer--render ${item.type==='tv'?'card--tv':''}" data-id="${item.id}" data-type="${item.type}">
        <div class="card__view">
          <img class="card__img" src="${tmdbImg(item.poster)}">
          <div class="card__icons"><div class="card__icons-inner"></div></div>
          ${tv}${vote}
        </div>
        <div class="card__title">${item.title || ''}</div>
        <div class="card__age">${item.year || ''}</div>
      </div>`;
  }

  async function loadPages() {
    // воркер с параметром pages глючит на 2–3 страницах — идём поштучно
    const all = [];
    for (let p = 1; p <= MAX_PAGES; p++) {
      const url = `${WORKER}?user=${encodeURIComponent(USER)}&page=${p}`;
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) continue;
      const data = await res.json();
      const items = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
      all.push(...items);
    }
    return all.map(normalize);
  }

  async function render() {
    const mount = ensureRow();
    if (!mount) return;

    mount.innerHTML = '<div style="padding:8px;opacity:.7">Загрузка…</div>';
    try {
      const items = await loadPages();
      mount.innerHTML = items.map(cardHTML).join('');
      // дать лампе шанс «приклеить» фокус/прокрутку
      try { Lampa.Images && Lampa.Images.lazy && Lampa.Images.lazy(); } catch(_) {}
    } catch (e) {
      mount.innerHTML = '<div style="padding:8px;color:#f66">Ошибка загрузки</div>';
      console.error('LB plug-in error', e);
    }
  }

  // клики по карточкам: открываем фулл из TMDB
  document.addEventListener('click', (e) => {
    const r = e.target.closest('#lb-items-line .card.selector');
    if (!r) {
      if (e.target.closest('#lb-items-line .lb-refresh')) render();
      return;
    }
    const id   = r.getAttribute('data-id');
    const type = r.getAttribute('data-type') === 'tv' ? 'tv' : 'movie';
    try {
      Lampa.Activity.push({ component: 'full', id, method: type, source: 'tmdb' });
    } catch (_) {}
  });

  // ждём, пока отрисуется Home, и монтируемся на самый верх
  let tries = 0;
  const iv = setInterval(() => {
    const onHome = document.querySelector('.head__title')?.textContent?.includes('Home');
    const root   = document.querySelector(rootSel);
    if (onHome && root) { clearInterval(iv); render(); }
    if (++tries > 40) clearInterval(iv);
  }, 250);

  // если Lampa перерисовала экран — пересадим ряд обратно наверх
  try {
    new MutationObserver(() => {
      const root = document.querySelector(rootSel);
      const line = document.getElementById('lb-items-line');
      if (root && line && line.parentNode !== root) {
        const first = root.querySelector('.items-line');
        root.insertBefore(line, first || root.firstChild);
      }
    }).observe(document.body, { childList: true, subtree: true });
  } catch (_) {}
})();
