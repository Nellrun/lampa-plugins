/* letterboxd-home-row.js — строка "Letterboxd Watchlist" на самом верху Home (Lampa 3.0.7 совместимо)
   ES5, XHR, без зависимостей на Lampa.Plugin.* и странные хуки. Работает в старых WebView.

   Что делает:
   - Находит основной контейнер контента на Home и вставляет нашу строку ПЕРВОЙ.
   - Дёргает воркер по адресу ?user&pages и рендерит горизонтальный ряд карточек.
   - Поддержка мыши/пульта: click, Enter, hover:enter.
*/

(function () {
  'use strict';

  // ---------- НАСТРОЙКИ ----------
  var WORKER_URL = 'https://lbox-proxy.nellrun.workers.dev';
  var LETTERBOXD_USER = 'Nellrun';
  var PAGES = 1; 

  // ---------- УТИЛИТЫ ----------
  function httpGet(url, ok, fail) {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      xhr.onreadystatechange = function () {
        if (xhr.readyState === 4) {
          if (xhr.status >= 200 && xhr.status < 300) ok(xhr.responseText);
          else fail && fail({ status: xhr.status, body: xhr.responseText || '' });
        }
      };
      xhr.send(null);
    } catch (e) { fail && fail({ status: 0, body: String(e && e.message || e) }); }
  }

  function noty(s){ try{ Lampa.Noty.show(s); }catch(_){} }

  function ensureStyles() {
    if (document.getElementById('lb-row-styles')) return;
    var css =
      '.lb-row{padding:8px 12px 4px 12px}' +
      '.lb-row__head{display:flex;align-items:center;gap:12px;margin:4px 4px 8px 4px}' +
      '.lb-row__title{font-weight:600;font-size:18px;opacity:.95}' +
      '.lb-row__btn{cursor:pointer;padding:6px 10px;border-radius:8px;background:#2b2b2b;color:#fff;opacity:.9;font-size:13px}' +
      '.lb-row__body{display:flex;overflow-x:auto;gap:8px;padding:4px 4px 8px 4px}' +
      '.lb-card{flex:0 0 140px}' +
      '.lb-card__poster{width:140px;height:210px;border-radius:10px;background:#222;background-size:cover;background-position:center}' +
      '.lb-card__caption{margin-top:6px;font-size:13px;line-height:1.3;opacity:.95;width:140px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.lb-row__status{padding:8px 4px;opacity:.8}';
    var st = document.createElement('style');
    st.id = 'lb-row-styles';
    st.textContent = css;
    document.head.appendChild(st);
  }

  // Пытаемся найти контейнер контента на Home.
  function findHomeContentContainer() {
    // 1) частый вариант: .content внутри активного экрана
    var cands = document.querySelectorAll('.content');
    if (cands && cands.length) return cands[0];

    // 2) иногда контент живёт внутри .scroll--padding
    var sp = document.querySelector('.scroll--padding');
    if (sp && sp.parentElement) return sp.parentElement;

    // 3) последний шанс — body (плохо, но лучше чем ничего)
    return document.body || null;
  }

  // ---------- КАРТОЧКИ ----------
  function buildCard(item) {
    var card = document.createElement('div');
    card.className = 'lb-card selector focusable';
    card.setAttribute('tabindex', '0');

    var poster = document.createElement('div');
    poster.className = 'lb-card__poster';
    if (item.poster) poster.style.backgroundImage = 'url(' + item.poster + ')';

    var cap = document.createElement('div');
    cap.className = 'lb-card__caption';
    cap.textContent = (item.title || 'Без названия') + (item.year ? ' (' + item.year + ')' : '');

    card.appendChild(poster);
    card.appendChild(cap);

    // Открытие карточки
    (function (it) {
      function openFull() {
        try {
          Lampa.Activity.push({ title: it.title, url: '', component: 'full', id: it.tmdb_id, method: 'movie' });
        } catch (e) {
          try { window.open('https://www.themoviedb.org/movie/' + it.tmdb_id, '_blank'); }
          catch (_) { noty('Не удалось открыть карточку'); }
        }
      }
      card.addEventListener('click', openFull);
      card.addEventListener('keydown', function (ev) {
        var k = (ev.key || '').toLowerCase();
        if (k === 'enter' || ev.keyCode === 13) openFull();
      });
      if (window.$) $(card).on('hover:enter', openFull);
    })(item);

    return card;
  }

  // ---------- РЯД ----------
  function createRow() {
    ensureStyles();

    var row = document.createElement('div');
    row.className = 'lb-row';
    row.id = 'lb-home-row';

    var head = document.createElement('div');
    head.className = 'lb-row__head';

    var title = document.createElement('div');
    title.className = 'lb-row__title';
    title.textContent = 'Letterboxd Watchlist';

    var actWrap = document.createElement('div');
    var btnRefresh = document.createElement('div');
    btnRefresh.className = 'lb-row__btn';
    btnRefresh.textContent = 'Обновить';
    btnRefresh.onclick = function () { loadRow(row, true); };

    actWrap.appendChild(btnRefresh);
    head.appendChild(title);
    head.appendChild(actWrap);

    var body = document.createElement('div');
    body.className = 'lb-row__body';

    var status = document.createElement('div');
    status.className = 'lb-row__status';
    status.textContent = 'Загрузка…';

    row.appendChild(head);
    row.appendChild(status);
    row.appendChild(body);

    return row;
  }

  function loadRow(row, force) {
    if (!row) return;

    var status = row.querySelector('.lb-row__status');
    var body = row.querySelector('.lb-row__body');
    if (!status || !body) return;

    status.style.display = '';
    body.style.display = 'none';
    status.textContent = 'Загрузка…';

    var url = WORKER_URL + '/?user=' + encodeURIComponent(LETTERBOXD_USER) +
              '&pages=' + encodeURIComponent(PAGES); // только user&pages, как тестишь в браузере

    httpGet(url, function (text) {
      var data;
      try { data = JSON.parse(text); }
      catch (e) { status.textContent = 'Неверный JSON'; return; }

      var items = data && data.items ? data.items : [];
      if (!items.length) { status.textContent = 'Пусто'; return; }

      body.innerHTML = '';
      for (var i = 0; i < items.length; i++) {
        body.appendChild(buildCard(items[i]));
      }
      status.style.display = 'none';
      body.style.display = 'flex';
    }, function (err) {
      var msg = 'HTTP ' + (err && err.status || '');
      var hint = '';
      try { hint = JSON.parse(err.body).error; } catch (_) { hint = err && err.body || ''; }
      status.innerHTML = 'Сеть/доступ: ' + msg + (hint ? '<br>' + String(hint) : '');
    });
  }

  // ---------- ВСТАВКА В HOME ----------
  function injectRowOnce() {
    if (document.getElementById('lb-home-row')) return true;
    var container = findHomeContentContainer();
    if (!container) return false;

    var row = createRow();
    try { container.insertBefore(row, container.firstChild || null); }
    catch (_) { (container.appendChild || function(){ })(row); }

    loadRow(row, false);
    return true;
  }

  // Пытаемся вставить при старте и на любые крупные изменения DOM
  function boot() {
    var ok = injectRowOnce();
    if (!ok) {
      // попробуем ещё пару раз — Home мог не успеть отрисоваться
      var tries = 0;
      var iv = setInterval(function () {
        if (injectRowOnce() || ++tries > 25) clearInterval(iv);
      }, 200);
    }

    // следим за перестройкой Home и пере-вставляем строку, если её выкинули
    try {
      var mo = new MutationObserver(function () {
        if (!document.getElementById('lb-home-row')) injectRowOnce();
      });
      mo.observe(document.body, { childList: true, subtree: true });
    } catch (_) {}
  }

  // Стартуем после короткой задержки, чтобы ядро очухалось
  setTimeout(boot, 500);
})();
