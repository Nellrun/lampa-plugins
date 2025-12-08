// letterboxd-watchlist.js (v6, Optimization & Lag fix)
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

  // --- CSS ---
  function ensureStyles() {
    if ($('#lb-watchlist-styles')) return;
    const style = document.createElement('style');
    style.id = 'lb-watchlist-styles';
    style.textContent = `
      /* Принудительная высота, чтобы фокус не перепрыгивал */
      #${BLOCK_ID} .scroll__body { min-height: 14rem; display: flex; align-items: flex-start; }
      
      #${BLOCK_ID} .items-line__title { display:flex; align-items:center; gap:.75rem; }
      #${BLOCK_ID} .lb-action .card__view { display: flex; align-items: center; justify-content: center; background: #2a2d2f; border-radius: 10px; }
      #${BLOCK_ID} .lb-action .card__img { width: 40px; height: 40px; object-fit: contain; opacity: 0.7; padding: 0; margin: auto; display: block; }
      #${BLOCK_ID} .card.lb-error .card__title { color:#ff6b6b; }
      
      /* Модальное окно */
      .lb-modal { position:fixed; inset:0; background:rgba(0,0,0,.65); display:flex; align-items:center; justify-content:center; z-index:9999; backdrop-filter: blur(5px); }
      .lb-modal__win { background:#1f2224; color:#fff; width:min(90vw,480px); border-radius:16px; padding:24px; box-shadow:0 10px 40px rgba(0,0,0,.6); border: 1px solid rgba(255,255,255,0.05); }
      .lb-modal__title { font-size:20px; margin-bottom:20px; font-weight: 600; }
      .lb-row { display:flex; flex-direction: column; gap:8px; margin-bottom: 16px; }
      .lb-row label { opacity:.7; font-size: 14px; margin-left: 4px; }
      .lb-input, .lb-select { width: 100%; background:#2a2d2f; border:2px solid transparent; border-radius:12px; color:#fff; padding:12px 14px; outline:none; font-size: 16px; transition: border-color .2s; box-sizing: border-box; }
      .lb-input:focus, .lb-select:focus { border-color: #2f81f7; background: #181a1b; }
      .lb-actionsbar { display:flex; justify-content:flex-end; gap:12px; margin-top:24px; }
      .lb-btn2 { background:#2f81f7; border:none; border-radius:10px; padding:12px 20px; color:#fff; cursor:pointer; font-weight: 600; }
      .lb-btn2:hover { filter: brightness(1.1); }
      .lb-btn2--ghost { background:transparent; border: 2px solid #3a3d40; }
      .lb-hint { font-size:13px; opacity:.5; text-align: center; margin-top: 10px; }
    `;
    document.head.appendChild(style);
  }

  // --- Core ---

  function isHome() {
    // Проверка через Lampa API надежнее
    if (window.Lampa && Lampa.Activity) {
        return Lampa.Activity.active()?.component === 'main';
    }
    // Фолбек для старых версий
    const head = $('.head__title')?.textContent?.trim()?.toLowerCase() || '';
    return head.startsWith('home') || head.startsWith('главная');
  }

  function findHomeScrollBody() {
    // Ищем контейнер именно в активной вкладке
    const active = $('.activity--active');
    if (active) return $('.scroll__body', active);
    return $('.scroll__body'); // fallback
  }

  function buildBlock() {
    ensureStyles();
    const host = findHomeScrollBody();
    if (!host) return null;

    // Если блок уже есть, не трогаем его
    if ($('#' + BLOCK_ID)) return $('#' + BLOCK_ID);

    const block = document.createElement('div');
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

    // Вставка: ищем место после первой нативной линии
    const firstLine = [...host.children].find(el => el.classList.contains('items-line'));
    if (firstLine) firstLine.insertAdjacentElement('afterend', block);
    else host.appendChild(block);

    // СРАЗУ рисуем заглушку, чтобы блок имел высоту и селектор
    const cfg = getCfg();
    if (!cfg.user) renderActionCard(block, 'settings', 'Требуется настройка', 'Нажмите для ввода ника');
    else reload(block);

    return block;
  }

  // --- Logic ---

  async function fetchJson(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(r.status);
    return r.json();
  }

  let loading = false;

  async function reload(block) {
    if (!block) block = $('#' + BLOCK_ID);
    if (!block) return;

    const cfg = getCfg();
    if (!cfg.user) return; // Оставляем карточку настроек

    if (loading) return;
    loading = true;

    // Рисуем "Загрузку" сразу. Это важно, чтобы селектор не пропадал.
    renderActionCard(block, 'broadcast', 'Загрузка...', 'Получение списка');

    try {
        let items = [];
        const workerUrl = cfg.worker || DEF_CFG.worker;
        
        if (cfg.pages > 1) {
            const promises = [];
            for (let p = 1; p <= cfg.pages; p++) {
                promises.push(fetchJson(`${workerUrl}/?user=${encodeURIComponent(cfg.user)}&page=${p}`).catch(()=>({items:[]})));
            }
            const results = await Promise.all(promises);
            results.forEach(r => {
                 const arr = Array.isArray(r?.items) ? r.items : (Array.isArray(r) ? r : []);
                 items.push(...arr);
            });
        } else {
            const j = await fetchJson(`${workerUrl}/?user=${encodeURIComponent(cfg.user)}&pages=1`);
            items = Array.isArray(j?.items) ? j.items : (Array.isArray(j) ? j : []);
        }

        const norm = normalizeItems(items);
        if (!norm.length) renderActionCard(block, 'empty', 'Список пуст', 'Проверьте ник на Letterboxd');
        else renderCards(block, norm);

    } catch (e) {
        console.error(e);
        renderActionCard(block, 'warning', 'Ошибка', 'Не удалось загрузить');
    } finally {
        loading = false;
    }
  }

  function normalizeItems(items) {
    const out = []; const seen = new Set();
    for (const it of items) {
      const tmdb = it.tmdb_id ?? it.tmdbId ?? it.tmdb ?? null;
      const title = it.title ?? it.name ?? '';
      const year = it.year ?? it.release_year ?? it.releaseYear ?? '';
      let poster = it.poster ?? it.poster_path ?? it.posterPath ?? '';
      if (poster && poster.startsWith('/')) poster = 'https://image.tmdb.org/t/p/w300' + poster;
      
      const key = tmdb ? String(tmdb) : title + '|' + year;
      if (seen.has(key)) continue; seen.add(key);
      out.push({ tmdb, title, year, poster });
    }
    return out;
  }

  // --- Rendering ---

  // Создаем карточки фильмов
  function renderCards(block, items) {
    const body = block.querySelector('.scroll__body');
    if (!body) return;
    body.innerHTML = ''; // Очищаем заглушку

    const frag = document.createDocumentFragment();

    items.forEach(it => {
      const card = document.createElement('div');
      // Классы Lampa: selector - обязателен для фокуса
      card.className = 'card selector layer--visible layer--render card--loaded';
      card.style.width = '12rem'; // Чуть фиксируем ширину для красоты
      
      card.innerHTML = `
        <div class="card__view">
          <img src="${it.poster || './img/img_load.svg'}" class="card__img" 
               onload="this.style.opacity=1" onerror="this.src='./img/img_broken.svg'">
           ${it.tmdb ? '<div class="card__vote">TMDB</div>' : ''}
        </div>
        <div class="card__title">${escapeHtml(it.title)}</div>
        <div class="card__age">${escapeHtml(String(it.year))}</div>
      `;

      card.addEventListener('click', () => {
          if (it.tmdb && window.Lampa) {
              Lampa.Activity.push({ url: 'movie/' + it.tmdb, title: it.title, component: 'full', id: it.tmdb, method: 'movie', card: it });
          }
      });
      // Долгое нажатие - настройки
      card.addEventListener('contextmenu', (e) => { e.preventDefault(); openSettings(block); });

      frag.appendChild(card);
    });
    body.appendChild(frag);
  }

  // Создаем служебную карточку (Load/Error/Settings)
  function renderActionCard(block, iconName, title, subtitle) {
    const body = block.querySelector('.scroll__body');
    if (!body) return;
    body.innerHTML = '';

    const card = document.createElement('div');
    card.className = 'card selector layer--visible layer--render card--loaded lb-action';
    card.style.width = '12rem';
    
    // Используем встроенные иконки Lampa (если путь ./img/icons/... доступен)
    // Либо SVG инлайном, чтобы наверняка
    const iconPath = `./img/icons/menu/${iconName}.svg`; 
    
    card.innerHTML = `
        <div class="card__view">
            <img src="${iconPath}" class="card__img" onerror="this.style.display='none'">
        </div>
        <div class="card__title">${title}</div>
        <div class="card__age">${subtitle}</div>
    `;

    card.addEventListener('click', () => {
        if (iconName === 'settings') openSettings(block);
        else reload(block);
    });

    body.appendChild(card);
  }

  // --- Settings Modal ---

  function openSettings(block) {
    const cfg = getCfg();
    const modal = document.createElement('div');
    modal.className = 'lb-modal';
    
    // Используем input type="text" без лишних обработчиков, чтобы не лагало
    modal.innerHTML = `
      <div class="lb-modal__win">
        <div class="lb-modal__title">Настройки Letterboxd</div>
        
        <div class="lb-row">
          <label>Имя пользователя (Letterboxd)</label>
          <input id="lb-user" class="lb-input" type="text" value="${escapeAttr(cfg.user)}" placeholder="Никнейм">
        </div>
        
        <div class="lb-row">
          <label>Количество страниц загрузки</label>
          <select id="lb-pages" class="lb-select">
            ${[1,2,3,4,5].map(n => `<option value="${n}" ${n===Number(cfg.pages)?'selected':''}>${n}</option>`).join('')}
          </select>
        </div>

        <div class="lb-actionsbar">
          <button class="lb-btn2 lb-btn2--ghost" data-act="cancel">Отмена</button>
          <button class="lb-btn2" data-act="save">Сохранить</button>
        </div>
        <div class="lb-hint">Удерживайте ОК на фильме, чтобы открыть это меню</div>
      </div>
    `;

    document.body.appendChild(modal);
    
    // Фокус на поле ввода
    setTimeout(() => { const inp = modal.querySelector('input'); if(inp) inp.focus(); }, 100);

    const close = () => modal.remove();
    
    modal.onclick = (e) => { if (e.target === modal) close(); };
    modal.querySelector('[data-act="cancel"]').onclick = close;
    modal.querySelector('[data-act="save"]').onclick = () => {
      const user = $('#lb-user', modal).value.trim();
      const pages = Number($('#lb-pages', modal).value) || 1;
      setCfg({ user, pages });
      close();
      reload(block);
    };
  }

  function escapeHtml(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function escapeAttr(s) { return String(s || '').replace(/"/g,'&quot;'); }

  // --- Initialization (Lag Free) ---

  function startPlugin() {
      // 1. Первая попытка рендера
      if (isHome()) buildBlock();

      // 2. Слушаем события Lampa (Правильный способ без обсерверов)
      if (window.Lampa && Lampa.Listener) {
          Lampa.Listener.follow('activity', (e) => {
              if (e.type === 'active' && e.component === 'main') {
                  // Небольшая задержка, чтобы DOM успел построиться
                  setTimeout(buildBlock, 50);
              }
          });
      }

      // 3. Редкий фоллбек на случай, если события не сработали (раз в 2 сек)
      // Это не грузит процессор в отличие от MutationObserver
      setInterval(() => {
          if (isHome() && !$('#' + BLOCK_ID)) buildBlock();
      }, 2000);
  }

  if (window.Lampa) {
      if (Lampa.Listener) startPlugin();
      else document.addEventListener('DOMContentLoaded', startPlugin);
  } else {
      setTimeout(startPlugin, 1000);
  }

})();
