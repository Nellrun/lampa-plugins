// letterboxd-watchlist.js
(function () {
  'use strict';

  const BLOCK_ID = 'lb-items-line';
  const CFG_KEY = 'lb_watchlist_cfg_v2';
  const DEF_CFG = {
    user: '',
    pages: 1,
    worker: 'https://lbox-proxy.nellrun.workers.dev'
  };

  // --------------- Utils / Storage ---------------

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function getCfg() {
    try {
      const raw = localStorage.getItem(CFG_KEY);
      if (!raw) return { ...DEF_CFG };
      const parsed = JSON.parse(raw);
      return { ...DEF_CFG, ...parsed };
    } catch {
      return { ...DEF_CFG };
    }
  }

  function setCfg(patch) {
    const cur = getCfg();
    const next = { ...cur, ...patch };
    localStorage.setItem(CFG_KEY, JSON.stringify(next));
    return next;
  }

  function debounce(fn, wait) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  function isHome() {
    const t = $('.head__title')?.textContent?.trim().toLowerCase() || '';
    return t.startsWith('home');
  }

  function findHomeScrollBody() {
    // Ищем scroll__body, где уже есть нативные items-line
    const cands = $$('.activity--active .scroll__body');
    for (const el of cands) {
      if (el.querySelector('.items-line')) return el;
    }
    // fallback: первый большой scroll__body в активной активности
    return cands[0] || null;
  }

  // --------------- Styles ---------------

  function ensureStyles() {
    if ($('#lb-watchlist-styles')) return;
    const style = document.createElement('style');
    style.id = 'lb-watchlist-styles';
    style.textContent = `
      #${BLOCK_ID} { visibility: visible; }
      #${BLOCK_ID} .items-line__title { display:flex; align-items:center; gap:.75rem; }
      #${BLOCK_ID} .lb-actions { font-size:.9em; opacity:.85; display:inline-flex; gap:.5rem; }
      #${BLOCK_ID} .lb-btn { cursor:pointer; text-decoration:underline; }
      #${BLOCK_ID} .lb-status { margin:.5rem 0; opacity:.7; }
      #${BLOCK_ID} .card__view { position: relative; }
      #${BLOCK_ID} .card[data-loading="1"] .card__img { filter: grayscale(.35); opacity:.7; }
      #${BLOCK_ID} .card.lb-error .card__title { color:#ff6b6b; }
      /* Простое модальное окно настроек */
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

  // --------------- Build / Insert / Reposition ---------------

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
        <div class="items-line__title">
          Letterboxd Watchlist
          <span class="lb-actions">
            <span class="lb-btn lb-refresh">Обновить</span>
            <span class="lb-btn lb-settings">Настройки</span>
          </span>
        </div>
        <div class="items-line__more selector" style="display:none">More</div>
      </div>
      <div class="lb-status" style="display:none">Загрузка…</div>
      <div class="items-line__body">
        <div class="scroll scroll--horizontal">
          <div class="scroll__content"><div class="scroll__body mapping--line"></div></div>
        </div>
      </div>
    `;

    // временно вставим куда угодно, потом переставим корректно
    host.appendChild(block);
    reposition(block);

    block.addEventListener('click', onCardClick, true);
    block.querySelector('.lb-refresh')?.addEventListener('click', ev => {
      ev.stopPropagation();
      reload(block, true);
    });
    block.querySelector('.lb-settings')?.addEventListener('click', ev => {
      ev.stopPropagation();
      openSettings(block);
    });

    block.setAttribute('data-lb-keep', '1');
    return block;
  }

  function reposition(block) {
    const host = findHomeScrollBody();
    if (!host || !block) return;

    // Найдем первый нативный items-line, у которого другой id
    const firstNative = [...host.children].find(el =>
      el.classList?.contains('items-line') && el.id !== BLOCK_ID
    );

    if (firstNative) {
      if (block.previousElementSibling !== firstNative) {
        firstNative.insertAdjacentElement('afterend', block);
      }
    } else {
      if (block.parentElement !== host) host.appendChild(block);
    }
  }

  function ensureOnHome() {
    if (!isHome()) return;
    const host = findHomeScrollBody();
    if (!host) return;

    let block = document.getElementById(BLOCK_ID);
    if (!block || !host.contains(block)) {
      block = buildBlock();
      if (block) reload(block, true);
      return;
    }

    reposition(block);

    const body = block.querySelector('.scroll__body');
    if (body && !body.children.length) reload(block, true);
  }

  // --------------- Fetch / Render ---------------

  async function fetchJson(url) {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  function normalizeItems(resp) {
    // Пытаемся унифицировать структуру воркера
    // Поддержим поля: tmdb_id | tmdbId | tmdb, title | name, year | release_year, poster | poster_path
    const items = Array.isArray(resp?.items) ? resp.items : Array.isArray(resp) ? resp : [];
    const out = [];
    const seen = new Set();

    for (const it of items) {
      const tmdb =
        it.tmdb_id ?? it.tmdbId ?? it.tmdb ?? null;

      const title = it.title ?? it.name ?? '';
      const year =
        it.year ?? it.release_year ?? it.releaseYear ?? '';
      let poster =
        it.poster ?? it.poster_path ?? it.posterPath ?? '';

      // Превратим относительный путь TMDB в полный
      if (poster && /^\/[a-zA-Z0-9]/.test(poster)) {
        poster = 'https://image.tmdb.org/t/p/w300' + poster;
      }

      const key = tmdb ? String(tmdb) : title + '|' + year;
      if (seen.has(key)) continue;
      seen.add(key);

      out.push({ tmdb, title, year, poster });
    }

    return out;
  }

  async function loadFromWorker(cfg) {
    // Сначала пробуем пакетным pages=
    try {
      const url = `${cfg.worker}/?user=${encodeURIComponent(cfg.user)}&pages=${encodeURIComponent(cfg.pages)}`;
      const j = await fetchJson(url);
      const norm = normalizeItems(j);
      if (norm.length || cfg.pages === 1) return norm;

      // Если пусто при pages>1 — fallback на по-страничные запросы
    } catch (_) {
      // упадем на последовательный план
    }

    // Фоллбек: pages по одному (если поддерживается ?page=)
    try {
      const merged = [];
      for (let p = 1; p <= cfg.pages; p++) {
        const u = `${cfg.worker}/?user=${encodeURIComponent(cfg.user)}&page=${p}`;
        const j = await fetchJson(u);
        merged.push(...normalizeItems(j));
      }
      return merged;
    } catch (e) {
      // Совсем беда: попробуем хотя бы первую страницу
      try {
        const u = `${cfg.worker}/?user=${encodeURIComponent(cfg.user)}&pages=1`;
        const j = await fetchJson(u);
        return normalizeItems(j);
      } catch (e2) {
        throw e2;
      }
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

    if (!cfg.user) {
      renderEmptyWithHint(block, 'Укажите имя пользователя в настройках.');
      return;
    }

    loading = true;
    status.style.display = '';
    status.textContent = 'Загрузка…';

    if (force) {
      body.innerHTML = '';
    }

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
      <div class="card selector layer--visible layer--render">
        <div class="card__view">
          <img src="./img/img_load.svg" class="card__img">
          <div class="card__icons"><div class="card__icons-inner"></div></div>
        </div>
        <div class="card__title">Letterboxd Watchlist</div>
        <div class="card__age">—</div>
      </div>
    `;
    const status = block.querySelector('.lb-status');
    if (status) {
      status.style.display = '';
      status.textContent = hint;
    }
  }

  function renderCards(block, items) {
    const body = block.querySelector('.scroll__body');
    if (!body) return;

    body.innerHTML = '';

    if (!items.length) {
      renderEmptyWithHint(block, 'Пусто. Возможно, список закрыт или пуст.');
      return;
    }

    const frag = document.createDocumentFragment();

    for (const it of items) {
      const card = document.createElement('div');
      card.className = 'card selector layer--visible layer--render card--loaded';
      card.dataset.tmdb = it.tmdb || '';
      card.setAttribute('data-loading', '0');

      card.innerHTML = `
        <div class="card__view">
          <img src="${it.poster || './img/img_load.svg'}" class="card__img">
          <div class="card__icons"><div class="card__icons-inner"></div></div>
          ${it.tmdb ? `<div class="card__vote">TMDB</div>` : ``}
        </div>
        <div class="card__title">${escapeHtml(it.title || '')}</div>
        <div class="card__age">${escapeHtml(String(it.year || ''))}</div>
      `;

      frag.appendChild(card);
    }

    body.appendChild(frag);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // --------------- Click handling ---------------

  function onCardClick(e) {
    const card = e.target?.closest?.('.card');
    if (!card || !card.closest('#' + BLOCK_ID)) return;

    const tmdb = card.dataset.tmdb;
    if (!tmdb) {
      card.classList.add('lb-error');
      return;
    }

    // Открытие "full" страницы фильма внутри Lampa
    try {
      if (window.Lampa && Lampa.Activity && Lampa.Activity.push) {
        const title = card.querySelector('.card__title')?.textContent?.trim() || 'Movie';
        Lampa.Activity.push({
          url: 'movie/' + tmdb,
          title: title,
          component: 'full',
          id: tmdb,
          method: 'movie'
        });
        return;
      }
    } catch (_) { /* noop */ }

    // Фоллбек — внешняя страница TMDB
    window.open('https://www.themoviedb.org/movie/' + tmdb, '_blank');
  }

  // --------------- Settings modal ---------------

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
        <div class="lb-hint">Сколько страниц тянуть из воркера (по 20 элементов на страницу, если так настроено в воркере).</div>

        <div class="lb-row">
          <label for="lb-worker">URL воркера</label>
          <input id="lb-worker" class="lb-input" type="text" value="${escapeAttr(cfg.worker)}">
        </div>
        <div class="lb-hint">Cloudflare Worker-прокси, который отдает JSON по Letterboxd Watchlist.</div>

        <div class="lb-actionsbar">
          <button class="lb-btn2 lb-btn2--ghost" data-act="cancel">Отмена</button>
          <button class="lb-btn2" data-act="save">Сохранить</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.addEventListener('click', ev => {
      if (ev.target === modal) close();
    });

    modal.querySelector('[data-act="cancel"]').addEventListener('click', close);
    modal.querySelector('[data-act="save"]').addEventListener('click', () => {
      const user = $('#lb-user', modal).value.trim();
      const pages = Number($('#lb-pages', modal).value) || 1;
      const worker = $('#lb-worker', modal).value.trim() || DEF_CFG.worker;

      setCfg({ user, pages, worker });
      close();
      reload(block, true);
    });

    function close() {
      modal.remove();
    }
  }

  function escapeAttr(s) {
    return String(s).replace(/"/g, '&quot;');
  }

  // --------------- Mutation Observer ---------------

  const mo = new MutationObserver(
    debounce(() => {
      try {
        ensureOnHome();
        const block = $('#' + BLOCK_ID);
        if (block) reposition(block);
      } catch { /* meh */ }
    }, 120)
  );
  mo.observe(document.body, { subtree: true, childList: true });

  // На всякий случай дернем и по таймеру, Home у Лампы любит жить своей жизнью
  setInterval(() => {
    try {
      ensureOnHome();
    } catch {}
  }, 1500);

  // Первый старт
  document.addEventListener('DOMContentLoaded', () => {
    try {
      ensureOnHome();
    } catch {}
  });

  // Если скрипт грузится поздно
  setTimeout(() => {
    try {
      ensureOnHome();
    } catch {}
  }, 400);

})();
