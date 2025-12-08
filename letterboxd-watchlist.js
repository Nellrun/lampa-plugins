// letterboxd-watchlist.js (v5, Native Navigation Fix)
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
    try { return { ...DEF_CFG, ...(JSON.parse(localStorage.getItem(CFG_KEY)) || {}) }; }
    catch { return { ...DEF_CFG }; }
  }
  function setCfg(patch) {
    const next = { ...getCfg(), ...patch };
    localStorage.setItem(CFG_KEY, JSON.stringify(next));
    return next;
  }

  function debounce(fn, wait) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), wait); }; }

  // Проверка на главную страницу
  function isHome() {
    try {
      if (window.Lampa && Lampa.Activity) return Lampa.Activity.active()?.component === 'main';
      const head = $('.head__title')?.textContent?.trim()?.toLowerCase() || '';
      return head.startsWith('home');
    } catch { return false; }
  }

  function findHomeScrollBody() {
    const cands = $$('.activity--active .scroll__body');
    // Приоритет контейнеру внутри активной активити
    for (const el of cands) if (el.closest('.activity--active')) return el;
    return cands[0] || null;
  }

  function ensureStyles() {
    if ($('#lb-watchlist-styles')) return;
    const style = document.createElement('style');
    style.id = 'lb-watchlist-styles';
    style.textContent = `
      #${BLOCK_ID} .items-line__title { display:flex; align-items:center; gap:.75rem; }
      #${BLOCK_ID} .lb-actions { font-size:.9em; opacity:.85; display:inline-flex; gap:.5rem; margin-left: auto; }
      #${BLOCK_ID} .lb-btn { cursor:pointer; opacity: 0.7; transition: opacity 0.3s; }
      #${BLOCK_ID} .lb-btn:hover { opacity: 1; }
      #${BLOCK_ID} .card__view { position: relative; }
      #${BLOCK_ID} .card.lb-error .card__title { color:#ff6b6b; }
      #${BLOCK_ID} .card.lb-action .card__img { padding: 20px; box-sizing: border-box; object-fit: contain; opacity: 0.5; }
      
      /* Настройки модалка */
      .lb-modal { position:fixed; inset:0; background:rgba(0,0,0,.55); display:flex; align-items:center; justify-content:center; z-index:9999; }
      .lb-modal__win { background:#1d1f20; color:#fff; width:min(92vw,520px); border-radius:14px; padding:16px; box-shadow:0 10px 30px rgba(0,0,0,.4); }
      .lb-modal__title { font-size:18px; margin-bottom:12px; font-weight: bold; }
      .lb-row { display:flex; gap:10px; align-items:center; margin:10px 0; }
      .lb-row label { width:140px; opacity:.85; }
      .lb-input, .lb-select { flex:1; background:#2a2d2f; border:1px solid #3a3d40; border-radius:10px; color:#fff; padding:10px 12px; outline:none; }
      .lb-input:focus { border-color: #2f81f7; }
      .lb-actionsbar { display:flex; justify-content:flex-end; gap:10px; margin-top:12px; }
      .lb-btn2 { background:#2f81f7; border:none; border-radius:10px; padding:10px 14px; color:#fff; cursor:pointer; }
      .lb-btn2--ghost { background:#2a2d2f; }
      .lb-hint { font-size:12px; opacity:.6; margin-top:2px; margin-left: 150px; }
    `;
    document.head.appendChild(style);
  }

  function buildBlock() {
    ensureStyles();
    const host = findHomeScrollBody();
    if (!host) return null;

    const prev = $('#' + BLOCK_ID);
    if (prev) prev.remove();

    const block = document.createElement('div');
    // Стандартные классы Lampa для строки
    block.className = 'items-line layer--visible layer--render items-line--type-default';
    block.id = BLOCK_ID;
    
    block.innerHTML = `
      <div class="items-line__head">
        <div class="items-line__title">Letterboxd Watchlist</div>
      </div>
      <div class="items-line__body">
        <div class="scroll scroll--horizontal">
          <div class="scroll__content">
            <div class="scroll__body mapping--line"></div>
          </div>
        </div>
      </div>
    `;

    reposition(block, host);
    
    // Сразу рисуем состояние, чтобы навигатор "видел" селектор
    const cfg = getCfg();
    if (!cfg.user) renderActionCard(block, 'configure', 'Требуется настройка', 'Нажмите, чтобы ввести логин');
    else reload(block);

    return block;
  }

  function reposition(block, host = findHomeScrollBody()) {
    if (!host || !block) return;
    // Ставим блок вторым или третьим, чтобы было видно сразу
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
      buildBlock();
    } else {
      reposition(block, host);
    }
  }

  // --- Logic ---

  async function fetchJson(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(r.status);
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
      // Если постер относительный путь TMDB
      if (poster && /^\/[A-Za-z0-9]/.test(poster)) poster = 'https://image.tmdb.org/t/p/w300' + poster;
      
      const key = tmdb ? String(tmdb) : title + '|' + year;
      if (seen.has(key)) continue; seen.add(key);
      out.push({ tmdb, title, year, poster });
    }
    return out;
  }

  let loading = false;

  async function reload(block) {
    if (!block) block = $('#' + BLOCK_ID);
    if (!block || loading) return;

    const cfg = getCfg();
    if (!cfg.user) {
      renderActionCard(block, 'configure', 'Настроить', 'Укажите пользователя');
      return;
    }

    loading = true;
    renderActionCard(block, 'loading', 'Загрузка...', 'Подождите');

    try {
      let items = [];
      const workerUrl = cfg.worker || DEF_CFG.worker;
      
      // Простая логика загрузки
      if (cfg.pages > 1) {
          const promises = [];
          for (let p = 1; p <= cfg.pages; p++) {
              promises.push(fetchJson(`${workerUrl}/?user=${encodeURIComponent(cfg.user)}&page=${p}`).catch(()=>({items:[]})));
          }
          const results = await Promise.all(promises);
          results.forEach(r => items.push(...normalizeItems(r)));
      } else {
          const j = await fetchJson(`${workerUrl}/?user=${encodeURIComponent(cfg.user)}&pages=1`);
          items = normalizeItems(j);
      }

      if (!items.length) {
        renderActionCard(block, 'empty', 'Список пуст', 'Или ошибка доступа');
      } else {
        renderCards(block, items);
      }
    } catch (e) {
      renderActionCard(block, 'error', 'Ошибка', 'Нажмите для повтора');
      console.error('LB Error:', e);
    } finally {
      loading = false;
    }
  }

  // Рендер карточек фильмов
  function renderCards(block, items) {
    const body = block.querySelector('.scroll__body');
    if (!body) return;
    body.innerHTML = '';

    const frag = document.createDocumentFragment();

    // Добавляем карточку "Настройки" в начало, чтобы всегда можно было изменить ник
    // Раскомментируй строку ниже, если хочешь кнопку настроек в начале списка всегда:
    // frag.appendChild(createActionCardElement('configure', 'Настройки', 'LB Watchlist'));

    items.forEach((it, idx) => {
      const card = document.createElement('div');
      card.className = 'card selector layer--visible layer--render card--loaded';
      card.dataset.tmdb = it.tmdb || '';
      card.dataset.title = it.title;
      // tabindex="0" не обязателен для Lampa, она ставит фокус сама, но полезен для отладки
      
      card.innerHTML = `
        <div class="card__view">
          <img src="${it.poster || './img/img_load.svg'}" class="card__img" onload="this.style.opacity=1" onerror="this.src='./img/img_broken.svg'">
          ${it.tmdb ? `<div class="card__vote">TMDB</div>` : ``}
        </div>
        <div class="card__title">${escapeHtml(it.title)}</div>
        <div class="card__age">${escapeHtml(String(it.year))}</div>
      `;

      // Обработка клика (Enter на пульте)
      card.addEventListener('click', () => openCard(it));
      
      // Долгое нажатие (аналог контекстного меню)
      card.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        openSettings(block);
      });

      frag.appendChild(card);
    });

    body.appendChild(frag);
  }

  // Рендер служебной карточки (Загрузка / Ошибка / Настройка)
  function renderActionCard(block, type, title, subtitle) {
    const body = block.querySelector('.scroll__body');
    if (!body) return;
    body.innerHTML = '';
    
    const el = createActionCardElement(type, title, subtitle);
    
    el.addEventListener('click', () => {
        if (type === 'configure') openSettings(block);
        if (type === 'error' || type === 'empty') reload(block);
    });
    
    body.appendChild(el);
  }

  function createActionCardElement(type, title, subtitle) {
    const card = document.createElement('div');
    card.className = `card selector layer--visible layer--render card--loaded lb-action lb-${type}`;
    // Иконка в зависимости от типа
    let icon = './img/icons/menu/settings.svg';
    if (type === 'loading') icon = './img/icons/menu/broadcast.svg'; // или любая анимация
    if (type === 'error') icon = './img/icons/menu/warning.svg';

    card.innerHTML = `
        <div class="card__view">
            <img src="${icon}" class="card__img">
        </div>
        <div class="card__title">${title}</div>
        <div class="card__age">${subtitle}</div>
    `;
    return card;
  }

  function openCard(it) {
    if (!it.tmdb) return; // Без ID не открыть
    if (window.Lampa && Lampa.Activity && Lampa.Activity.push) {
      Lampa.Activity.push({
        url: 'movie/' + it.tmdb,
        title: it.title,
        component: 'full',
        id: it.tmdb,
        method: 'movie',
        card: it // Передаем объект для корректной анимации
      });
    }
  }

  function openSettings(block) {
    const cfg = getCfg();
    const modal = document.createElement('div');
    modal.className = 'lb-modal';
    modal.innerHTML = `
      <div class="lb-modal__win">
        <div class="lb-modal__title">LB Watchlist</div>
        
        <div class="lb-row">
          <label>Никнейм</label>
          <input id="lb-user" class="lb-input" type="text" value="${escapeAttr(cfg.user)}" placeholder="Username">
        </div>
        
        <div class="lb-row">
          <label>Страниц</label>
          <select id="lb-pages" class="lb-select">
            ${[1,2,3,4,5].map(n => `<option value="${n}" ${n===Number(cfg.pages)?'selected':''}>${n}</option>`).join('')}
          </select>
        </div>

        <div class="lb-actionsbar">
          <button class="lb-btn2 lb-btn2--ghost" data-act="cancel">Отмена</button>
          <button class="lb-btn2" data-act="save">Сохранить</button>
        </div>
        <div class="lb-hint" style="margin:10px 0 0 0; text-align:center">Долгое нажатие на фильме вызывает это меню</div>
      </div>
    `;

    document.body.appendChild(modal);
    
    // Фокус на инпут для удобства (если есть клавиатура)
    setTimeout(() => modal.querySelector('input')?.focus(), 100);

    const close = () => modal.remove();
    
    modal.addEventListener('click', e => { if (e.target === modal) close(); });
    modal.querySelector('[data-act="cancel"]').addEventListener('click', close);
    modal.querySelector('[data-act="save"]').addEventListener('click', () => {
      const user = $('#lb-user', modal).value.trim();
      const pages = Number($('#lb-pages', modal).value) || 1;
      setCfg({ user, pages });
      close();
      reload(block);
    });
  }

  function escapeHtml(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function escapeAttr(s) { return String(s || '').replace(/"/g,'&quot;'); }

  // Наблюдение за изменениями DOM, чтобы блок не исчезал при навигации
  const mo = new MutationObserver(debounce(() => ensureOnHome(), 200));
  mo.observe(document.body, { subtree: true, childList: true });

  // Init
  document.addEventListener('DOMContentLoaded', ensureOnHome);
  if (window.Lampa) {
      // Подписываемся на события Lampa для более надежной вставки
      const listener = () => setTimeout(ensureOnHome, 100);
      Lampa.Listener.follow('app', (e) => { if(e.type === 'ready') ensureOnHome(); });
      Lampa.Listener.follow('activity', (e) => { if(e.type === 'active' && e.component === 'main') listener(); });
  } else {
      setTimeout(ensureOnHome, 500);
  }

})();
