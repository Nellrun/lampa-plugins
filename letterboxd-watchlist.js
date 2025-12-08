// letterboxd-watchlist.js (v4, Lampa.Controller интеграция)
(function () {
  'use strict';

  const BLOCK_ID = 'lb-items-line';
  const CFG_KEY = 'lb_watchlist_cfg_v4';
  const DEF_CFG = {
    user: '',
    pages: 1,
    worker: 'https://lbox-proxy.nellrun.workers.dev'
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function getCfg() {
    try { return { ...DEF_CFG, ...(JSON.parse(localStorage.getItem(CFG_KEY))||{}) }; }
    catch { return { ...DEF_CFG }; }
  }
  function setCfg(patch) {
    const next = { ...getCfg(), ...patch };
    localStorage.setItem(CFG_KEY, JSON.stringify(next));
    return next;
  }

  function debounce(fn, wait) { let t; return (...a)=>{clearTimeout(t); t=setTimeout(()=>fn.apply(this,a),wait);}; }

  function isHome() {
    try {
      // На новых сборках есть глобалка Lampa && Lampa.Activity.Active()
      const head = $('.head__title')?.textContent?.trim()?.toLowerCase() || '';
      return head.startsWith('home') || (window.Lampa && Lampa.Activity && (Lampa.Activity.active()?.component === 'main'));
    } catch { return false; }
  }

  function findHomeScrollBody() {
    // Живой контейнер линий на главной
    const cands = $$('.activity--active .scroll__body');
    for (const el of cands) if (el.closest('.activity--active')) return el;
    return cands[0] || null;
  }

  function ensureStyles() {
    if ($('#lb-watchlist-styles')) return;
    const style = document.createElement('style');
    style.id = 'lb-watchlist-styles';
    style.textContent = `
      #${BLOCK_ID} .items-line__title { display:flex; align-items:center; gap:.75rem; }
      #${BLOCK_ID} .lb-actions { font-size:.9em; opacity:.85; display:inline-flex; gap:.5rem; }
      #${BLOCK_ID} .lb-btn { cursor:pointer; text-decoration:underline; }
      #${BLOCK_ID} .lb-status { margin:.5rem 0; opacity:.7; }
      #${BLOCK_ID} .card__view { position: relative; }
      #${BLOCK_ID} .card.lb-error .card__title { color:#ff6b6b; }

      /* Делает якорь строки фокусируемым для Lampa */
      #${BLOCK_ID} .items-line__more.selector {
        opacity: 0.01; /* практически невидим, но видим для навигации */
        pointer-events: auto;
      }
      #${BLOCK_ID} .card[tabindex="0"]:focus { box-shadow:0 0 0 2px rgba(47,129,247,.7) inset; }
      /* Настройки */
      .lb-modal { position:fixed; inset:0; background:rgba(0,0,0,.55); display:flex; align-items:center; justify-content:center; z-index:9999; }
      .lb-modal__win { background:#1d1f20; color:#fff; width:min(92vw,520px); border-radius:14px; padding:16px; box-shadow:0 10px 30px rgba(0,0,0,.4); }
      .lb-modal__title { font-size:18px; margin-bottom:12px; }
      .lb-row { display:flex; gap:10px; align-items:center; margin:10px 0; }
      .lb-row label { width:140px; opacity:.85; }
      .lb-input, .lb-select { flex:1; background:#2a2d2f; border:1px solid #3a3d40; border-radius:10px; color:#fff; padding:10px 12px; outline:none; }
      .lb-actionsbar { display:flex; justify-content:flex-end; gap:10px; margin-top:12px; }
      .lb-btn2 { background:#2f81f7; border:none; border-radius:10px; padding:10px 14px; color:#fff; cursor:pointer; }
      .lb-btn2--ghost { background:#2a2d2f; }
      .lb-hint { font-size:12px; opacity:.6; margin-top:2px; }
    `;
    document.head.appendChild(style);
  }

  // Храним последний индекс карточки для возврата фокуса
  let lastIndex = 0;

  function buildBlock() {
    ensureStyles();
    const host = findHomeScrollBody();
    if (!host) return null;

    const prev = $('#' + BLOCK_ID);
    if (prev) prev.remove();

    const block = document.createElement('div');
    block.className = 'items-line layer--visible layer--render items-line--type-default';
    block.id = BLOCK_ID;
    block.setAttribute('data-name','Letterboxd Watchlist');
    // Есть сборки Lampa, которые проверяют наличие data-uid у линий
    block.setAttribute('data-uid', 'lb-watchlist-line');

    block.innerHTML = `
      <div class="items-line__head">
        <div class="items-line__title">
          Letterboxd Watchlist
          <span class="lb-actions">
            <span class="lb-btn lb-refresh">Обновить</span>
            <span class="lb-btn lb-settings">Настройки</span>
          </span>
        </div>
        <!-- Важно: этот элемент выступает якорем для вертикальной навигации Lampa -->
        <div class="items-line__more selector" tabindex="0">Open</div>
      </div>
      <div class="lb-status" style="display:none">Загрузка…</div>
      <div class="items-line__body">
        <div class="scroll scroll--horizontal">
          <div class="scroll__content"><div class="scroll__body mapping--line"></div></div>
        </div>
      </div>
    `;

    host.appendChild(block);
    reposition(block);

    // Клики по элементам и кнопки
    block.addEventListener('click', onCardClick, true);
    block.querySelector('.lb-refresh')?.addEventListener('click', ev => { ev.stopPropagation(); reload(block, true); });
    block.querySelector('.lb-settings')?.addEventListener('click', ev => { ev.stopPropagation(); openSettings(block); });

    // Когда фокус попадает на якорь строки, переключаем контроллер на коллекцию карточек
    const anchor = block.querySelector('.items-line__more.selector');
    anchor.addEventListener('focus', () => {
      try { activateController(block); } catch {}
    });

    return block;
  }

  function reposition(block) {
    const host = findHomeScrollBody();
    if (!host || !block) return;

    // Вставляем после первой нативной строки, чтобы Lampa «видела» контекст
    const firstLine = [...host.children].find(el => el.classList?.contains('items-line') && el.id !== BLOCK_ID);
    if (firstLine) firstLine.insertAdjacentElement('afterend', block);
    else host.appendChild(block);
  }

  function ensureOnHome() {
    if (!isHome()) return;

    const host = findHomeScrollBody();
    if (!host) return;

    let block = $('#' + BLOCK_ID);
    if (!block || !host.contains(block)) {
      block = buildBlock();
      if (block) reload(block, true);
      return;
    }

    reposition(block);

    const body = block.querySelector('.scroll__body');
    if (body && !body.children.length) reload(block, true);
  }

  async function fetchJson(url) {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  function normalizeItems(resp) {
    const items = Array.isArray(resp?.items) ? resp.items : Array.isArray(resp) ? resp : [];
    const out = []; const seen = new Set();
    for (const it of items) {
      const tmdb = it.tmdb_id ?? it.tmdbId ?? it.tmdb ?? null;
      const title = it.title ?? it.name ?? '';
      const year = it.year ?? it.release_year ?? it.releaseYear ?? '';
      let poster = it.poster ?? it.poster_path ?? it.posterPath ?? '';
      if (poster && /^\/[A-Za-z0-9]/.test(poster)) poster = 'https://image.tmdb.org/t/p/w300' + poster;
      const key = tmdb ? String(tmdb) : title + '|' + year;
      if (seen.has(key)) continue; seen.add(key);
      out.push({ tmdb, title, year, poster });
    }
    return out;
  }

  async function loadFromWorker(cfg) {
    try {
      const url = `${cfg.worker}/?user=${encodeURIComponent(cfg.user)}&pages=${encodeURIComponent(cfg.pages)}`;
      const j = await fetchJson(url);
      const norm = normalizeItems(j);
      if (norm.length || cfg.pages === 1) return norm;
    } catch {}
    try {
      const merged = [];
      for (let p = 1; p <= cfg.pages; p++) {
        const u = `${cfg.worker}/?user=${encodeURIComponent(cfg.user)}&page=${p}`;
        const j = await fetchJson(u);
        merged.push(...normalizeItems(j));
      }
      return merged;
    } catch (e) {
      const u = `${cfg.worker}/?user=${encodeURIComponent(cfg.user)}&pages=1`;
      const j = await fetchJson(u);
      return normalizeItems(j);
    }
  }

  let loading = false;

  async function reload(block, force = false) {
    if (!block) block = $('#' + BLOCK_ID);
    if (!block || loading) return;

    const status = block.querySelector('.lb-status');
    const body = block.querySelector('.scroll__body');
    if (!body) return;

    const cfg = getCfg();
    if (!cfg.user) { renderEmptyWithHint(block, 'Укажите имя пользователя в настройках.'); return; }

    loading = true;
    status.style.display = '';
    status.textContent = 'Загрузка…';
    if (force) body.innerHTML = '';

    try {
      const items = await loadFromWorker(cfg);
      renderCards(block, items);
      status.style.display = 'none';
    } catch (e) {
      status.textContent = 'Ошибка загрузки: ' + (e?.message || e);
      if (!body.children.length) renderEmptyWithHint(block, 'Не удалось получить список. Проверьте воркер и имя пользователя.');
    } finally {
      loading = false;
    }
  }

  function renderEmptyWithHint(block, hint) {
    const body = block.querySelector('.scroll__body');
    if (!body) return;
    body.innerHTML = `
      <div class="card selector layer--visible layer--render" tabindex="0" data-index="0">
        <div class="card__view">
          <img src="./img/img_load.svg" class="card__img">
          <div class="card__icons"><div class="card__icons-inner"></div></div>
        </div>
        <div class="card__title">Letterboxd Watchlist</div>
        <div class="card__age">—</div>
      </div>
    `;
    const status = block.querySelector('.lb-status');
    if (status) { status.style.display = ''; status.textContent = hint; }
    // при пустой выдаче всё равно активируем контроллер, чтобы якорь ловил Up/Down
    activateController(block);
  }

  function renderCards(block, items) {
    const body = block.querySelector('.scroll__body');
    if (!body) return;
    body.innerHTML = '';

    if (!items.length) { renderEmptyWithHint(block, 'Пусто. Возможно, список закрыт или пуст.'); return; }

    const frag = document.createDocumentFragment();
    let idx = 0;

    for (const it of items) {
      const card = document.createElement('div');
      card.className = 'card selector layer--visible layer--render card--loaded';
      card.dataset.tmdb = it.tmdb || '';
      card.setAttribute('tabindex','0');
      card.setAttribute('data-index', String(idx++));

      card.innerHTML = `
        <div class="card__view">
          <img src="${it.poster || './img/img_load.svg'}" class="card__img">
          <div class="card__icons"><div class="card__icons-inner"></div></div>
          ${it.tmdb ? `<div class="card__vote">TMDB</div>` : ``}
        </div>
        <div class="card__title">${escapeHtml(it.title || '')}</div>
        <div class="card__age">${escapeHtml(String(it.year || ''))}</div>
      `;

      card.addEventListener('focus', ()=> {
        const di = Number(card.getAttribute('data-index')||0);
        if (!Number.isNaN(di)) lastIndex = di;
      });

      frag.appendChild(card);
    }
    body.appendChild(frag);

    activateController(block);
  }

  function activateController(block) {
    if (!(window.Lampa && Lampa.Controller && Lampa.Navigator)) return;

    const body = block.querySelector('.scroll__body');
    const cards = $$('.card.selector', body);
    const anchor = block.querySelector('.items-line__more.selector');

    // Регаем контроллер один раз
    if (!activateController._inited) {
      Lampa.Controller.add('lb_watchlist', {
        toggle() {
          try {
            // Сообщаем контроллеру, где коллекция
            if (Lampa.Controller.collectionSet) {
              Lampa.Controller.collectionSet($(body));
            }
          } catch {}
          focusCardByIndex(lastIndex || 0);
        },
        // Горизонталь оставляем на дефолтный навигатор
        left()  { Lampa.Navigator.move('left');  },
        right() { Lampa.Navigator.move('right'); },

        // Вверх/вниз возвращаем управление общему «контенту» и просим Lampa прыгнуть к соседней линии
        up() {
          Lampa.Controller.toggle('content');
          Lampa.Navigator.move('up');
          // Вернуть фокус на якорь строки при повторном заходе
          anchor && anchor.focus && anchor.focus();
        },
        down() {
          Lampa.Controller.toggle('content');
          Lampa.Navigator.move('down');
        },
        back() {
          Lampa.Controller.toggle('content');
        },
        enter() {
          const cur = document.activeElement?.closest?.('.card');
          if (cur) openCard(cur);
        }
      });
      activateController._inited = true;
    }

    // При фокусе на якоре строки переключаемся на наш контроллер
    anchor?.addEventListener('keydown', ev => {
      if (ev.key === 'ArrowDown') {
        ev.preventDefault();
        Lampa.Controller.toggle('lb_watchlist');
      }
    });

    // Если ни одна карточка не в фокусе, ставим на ту, что была
    if (!cards.some(c => c === document.activeElement)) {
      // не насильно прямо сейчас, Lampa сама дёрнет toggle при навигации
    }
  }

  function focusCardByIndex(i) {
    const list = $$('.card.selector', $('#' + BLOCK_ID + ' .scroll__body'));
    if (!list.length) return;
    const idx = Math.max(0, Math.min(i, list.length-1));
    try {
      list[idx].focus({ preventScroll: false });
      list[idx].scrollIntoView({ block:'nearest', inline:'nearest' });
    } catch {}
  }

  function onCardClick(e) {
    const card = e.target?.closest?.('.card');
    if (!card || !card.closest('#' + BLOCK_ID)) return;
    openCard(card);
  }

  function openCard(card) {
    const tmdb = card.dataset.tmdb;
    if (!tmdb) { card.classList.add('lb-error'); return; }
    try {
      if (window.Lampa && Lampa.Activity && Lampa.Activity.push) {
        const title = card.querySelector('.card__title')?.textContent?.trim() || 'Movie';
        Lampa.Activity.push({ url: 'movie/' + tmdb, title, component: 'full', id: tmdb, method: 'movie' });
        return;
      }
    } catch {}
    window.open('https://www.themoviedb.org/movie/' + tmdb, '_blank');
  }

  function openSettings(block) {
    const cfg = getCfg();
    const modal = document.createElement('div');
    modal.className = 'lb-modal';
    modal.innerHTML = `
      <div class="lb-modal__win">
        <div class="lb-modal__title">Letterboxd Watchlist — Настройки</div>

        <div class="lb-row">
          <label for="lb-user">Пользователь</label>
          <input id="lb-user" class="lb-input" type="text" placeholder="например, Nellrun" value="${escapeAttr(cfg.user)}">
        </div>
        <div class="lb-hint">Имя пользователя Letterboxd (публичный профиль).</div>

        <div class="lb-row">
          <label for="lb-pages">Страниц</label>
          <select id="lb-pages" class="lb-select">
            ${[1,2,3,4,5].map(n => `<option value="${n}" ${n===Number(cfg.pages)?'selected':''}>${n}</option>`).join('')}
          </select>
        </div>
        <div class="lb-hint">Сколько страниц тянуть из воркера.</div>

        <div class="lb-row">
          <label for="lb-worker">URL воркера</label>
          <input id="lb-worker" class="lb-input" type="text" value="${escapeAttr(cfg.worker)}">
        </div>
        <div class="lb-hint">Cloudflare Worker с JSON по Watchlist.</div>

        <div class="lb-actionsbar">
          <button class="lb-btn2 lb-btn2--ghost" data-act="cancel">Отмена</button>
          <button class="lb-btn2" data-act="save">Сохранить</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener('click', ev => { if (ev.target === modal) close(); });
    modal.querySelector('[data-act="cancel"]').addEventListener('click', close);
    modal.querySelector('[data-act="save"]').addEventListener('click', () => {
      const user = $('#lb-user', modal).value.trim();
      const pages = Number($('#lb-pages', modal).value) || 1;
      const worker = $('#lb-worker', modal).value.trim() || DEF_CFG.worker;
      setCfg({ user, pages, worker }); close(); reload(block, true);
    });
    function close(){ modal.remove(); }
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
  function escapeAttr(s) { return String(s).replace(/"/g,'&quot;'); }

  // Наблюдаем за домом и держим блок живым
  const mo = new MutationObserver(
    debounce(() => { try { ensureOnHome(); const block = $('#' + BLOCK_ID); if (block) reposition(block); } catch {}}, 120)
  );
  mo.observe(document.body, { subtree: true, childList: true });

  // Периодическая страховка на случай полной перерисовки Home
  setInterval(() => { try { ensureOnHome(); } catch {} }, 1500);

  document.addEventListener('DOMContentLoaded', () => { try { ensureOnHome(); } catch {} });
  setTimeout(() => { try { ensureOnHome(); } catch {} }, 400);

})();
