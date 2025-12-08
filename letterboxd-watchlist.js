/* letterboxd-home-line.js — аккуратная строка "Letterboxd Watchlist" на Home (ES5)
   — Вставляется ПЕРВОЙ перед остальными rows .items-line
   — Использует те же классы, что и Лампа: items-line, items-line__title, items-line__body, card...
   — Кнопка "Обновить" дергает &refresh=1 (пробой кэша на воркере)
*/
(function () {
  'use strict';

  var WORKER_URL = 'https://lbox-proxy.nellrun.workers.dev';
  var LETTERBOXD_USER = 'Nellrun';
  var PAGES = 3;

  // -------- utils --------
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
  function ensureStyles(){
    if (document.getElementById('lb-line-styles')) return;
    var css =
      '.lb-refresh{margin-left:12px; display:inline-block; padding:3px 8px; border-radius:8px; background:#2b2b2b; color:#fff; font-size:12px; opacity:.9; cursor:pointer}' +
      '.lb-status{padding:8px 4px; opacity:.8}';
    var st = document.createElement('style'); st.id = 'lb-line-styles'; st.textContent = css; document.head.appendChild(st);
  }

  // -------- cards --------
  function buildCard(it) {
    // пробуем шаблон Лампы для карточек
    try {
      if (Lampa.Template && typeof Lampa.Template.get === 'function') {
        var data = {
          title: it.title,
          release_year: it.year || '',
          poster: it.poster,
          backdrop_path: it.backdrop || '',
          vote_average: it.vote_average || 0
        };
        var el = $(Lampa.Template.get('card', data));
        el.addClass('selector focusable');
        el.on('hover:enter', function () {
          try {
            Lampa.Activity.push({ title: it.title, url: '', component: 'full', id: it.tmdb_id, method: 'movie' });
          } catch (e) {
            try { window.open('https://www.themoviedb.org/movie/' + it.tmdb_id, '_blank'); } catch (_) {}
          }
        });
        return el[0];
      }
    } catch (_){}

    // fallback карточка (совместимо со старым WebView)
    var card = document.createElement('div');
    card.className = 'card selector focusable';
    var view = document.createElement('div'); view.className = 'card__view';
    var img = document.createElement('img'); img.className = 'card__img';
    if (it.poster) img.src = it.poster;
    view.appendChild(img);
    var caption = document.createElement('div'); caption.className = 'card__title';
    caption.textContent = (it.title || 'Без названия') + (it.year ? ' (' + it.year + ')' : '');
    card.appendChild(view); card.appendChild(caption);

    (function (item) {
      function openFull() {
        try { Lampa.Activity.push({ title: item.title, url: '', component: 'full', id: item.tmdb_id, method: 'movie' }); }
        catch (e) { try { window.open('https://www.themoviedb.org/movie/' + item.tmdb_id, '_blank'); } catch (_) {} }
      }
      card.addEventListener('click', openFull);
      if (window.$) $(card).on('hover:enter', openFull);
    })(it);

    return card;
  }

  // -------- line --------
  function createLine() {
    ensureStyles();

    var line = document.createElement('div');
    line.className = 'items-line';
    line.id = 'lb-items-line';

    var head = document.createElement('div');
    head.className = 'items-line__title';
    head.textContent = 'Letterboxd Watchlist';

    var refresh = document.createElement('span');
    refresh.className = 'lb-refresh';
    refresh.textContent = 'Обновить';
    refresh.onclick = function(){ loadInto(line, true); };

    head.appendChild(refresh);

    var body = document.createElement('div');
    body.className = 'items-line__body';

    var status = document.createElement('div');
    status.className = 'lb-status';
    status.textContent = 'Загрузка…';

    line.appendChild(head);
    line.appendChild(status);
    line.appendChild(body);

    return line;
  }

  function loadInto(line, force) {
    var status = line.querySelector('.lb-status');
    var body = line.querySelector('.items-line__body');
    status.style.display = '';
    body.style.display = 'none';
    status.textContent = 'Загрузка…';

    var url = WORKER_URL + '/?user=' + encodeURIComponent(LETTERBOXD_USER) +
              '&pages=' + encodeURIComponent(PAGES) +
              (force ? '&refresh=1&_=' + Date.now() : '');

    httpGet(url, function (text) {
      var data; try { data = JSON.parse(text); } catch(e){ status.textContent = 'Неверный JSON'; return; }
      var items = data && data.items ? data.items : [];
      if (!items.length) { status.textContent = 'Пусто'; return; }

      body.innerHTML = '';
      for (var i = 0; i < items.length; i++) body.appendChild(buildCard(items[i]));
      status.style.display = 'none';
      body.style.display = '';
    }, function (err) {
      var msg = 'HTTP ' + (err && err.status || '');
      var hint = '';
      try { hint = JSON.parse(err.body).error; } catch(_) { hint = err && err.body || ''; }
      status.innerHTML = 'Сеть/доступ: ' + msg + (hint ? '<br>' + String(hint) : '');
    });
  }

  // -------- inject before first items-line --------
  function findLinesContainer() {
    // находим первую строку и вставляем перед ней — так не наползает на верхнюю панель
    var firstLine = document.querySelector('.items-line');
    if (firstLine && firstLine.parentElement) return { parent: firstLine.parentElement, before: firstLine };
    // fallback: основной контент
    var content = document.querySelector('.content');
    return content ? { parent: content, before: content.firstChild } : { parent: document.body, before: null };
  }

  function injectOnce() {
    if (document.getElementById('lb-items-line')) return true;
    var spot = findLinesContainer();
    if (!spot || !spot.parent) return false;

    var line = createLine();
    try { spot.parent.insertBefore(line, spot.before || null); }
    catch (_) { spot.parent.appendChild(line); }

    loadInto(line, false);
    return true;
  }

  function boot() {
    var ok = injectOnce();
    if (!ok) {
      var tries = 0;
      var iv = setInterval(function(){
        if (injectOnce() || ++tries > 30) clearInterval(iv);
      }, 200);
    }
    try {
      var mo = new MutationObserver(function(){
        if (!document.getElementById('lb-items-line')) injectOnce();
      });
      mo.observe(document.body, { childList:true, subtree:true });
    } catch(_) {}
  }

  setTimeout(boot, 500);
})();
