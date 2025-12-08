/* letterboxd-overlay.js — работает поверх всего (Lampa 3.0.7 дружит)
   Что делает:
   - Вставляет плавающую кнопку "Letterboxd" на Home
   - По нажатию открывает фуллскрин-оверлей с гридом фильмов из воркера
   - По Enter/клику открывает карточку фильма через Lampa.Activity.push (если доступно)
   Зависимости: только XHR и jQuery-подобный $, всё на ES5
*/
(function () {
  'use strict';

  var WORKER_URL = 'https://lbox-proxy.nellrun.workers.dev';
  var LETTERBOXD_USER = 'Nellrun';
  var PAGES  = 1;
  var LANG   = 'ru-RU';
  var REGION = 'RU';

  // ---------- утилиты ----------
  function httpGet(url, ok, fail) {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      xhr.onreadystatechange = function () {
        if (xhr.readyState === 4) {
          if (xhr.status >= 200 && xhr.status < 300) ok(xhr.responseText);
          else fail && fail(new Error('HTTP ' + xhr.status));
        }
      };
      xhr.send(null);
    } catch (e) { fail && fail(e); }
  }
  function noty(s){ try{ Lampa.Noty.show(s); }catch(_){} }

  // ---------- оверлей ----------
  function ensureStyles() {
    if (document.getElementById('lb-ov-styles')) return;
    var css =
      '#lb-ov{position:fixed;inset:0;z-index:99999;background:rgba(12,12,12,.96);'+
      'display:flex;flex-direction:column;font-family:inherit;color:#fff}' +
      '#lb-ov .bar{display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid rgba(255,255,255,.08)}' +
      '#lb-ov .title{font-weight:600;font-size:18px;flex:1;opacity:.95}' +
      '#lb-ov .btn{cursor:pointer;padding:6px 10px;background:#2b2b2b;border-radius:8px;opacity:.9}' +
      '#lb-ov .wrap{flex:1;overflow:auto;padding:16px}' +
      '#lb-ov .grid{display:flex;flex-wrap:wrap;gap:8px}' +
      '#lb-ov .card{width:140px}' +
      '#lb-ov .poster{width:100%;padding-top:150%;border-radius:10px;background:#222;background-size:cover;background-position:center}' +
      '#lb-ov .caption{margin-top:6px;font-size:13px;line-height:1.3;opacity:.95}' +
      '#lb-ov .muted{opacity:.7}' +
      '#lb-ov .status{padding:16px;opacity:.85}';
    var style = document.createElement('style');
    style.id = 'lb-ov-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function openOverlay() {
    ensureStyles();
    if (document.getElementById('lb-ov')) return; // уже открыт

    var ov = document.createElement('div');
    ov.id = 'lb-ov';
    ov.innerHTML =
      '<div class="bar">' +
        '<div class="title">Letterboxd Watchlist</div>' +
        '<div class="btn" id="lb-ov-refresh">Обновить</div>' +
        '<div class="btn" id="lb-ov-close">Закрыть</div>' +
      '</div>' +
      '<div class="wrap"><div class="status">Загрузка…</div><div class="grid" style="display:none"></div></div>';

    document.body.appendChild(ov);

    function close() {
      try { document.body.removeChild(ov); } catch(_) {}
      window.removeEventListener('keydown', onKey);
    }
    document.getElementById('lb-ov-close').onclick = close;
    document.getElementById('lb-ov-refresh').onclick = load;

    function onKey(e){
      var code = e.keyCode || e.which;
      if (code === 27 || code === 8 || code === 461 || code === 10009) close(); // Esc / Backspace / TV Back
    }
    window.addEventListener('keydown', onKey);

    load();

    function load() {
      var status = ov.querySelector('.status');
      var grid   = ov.querySelector('.grid');
      status.style.display = '';
      grid.style.display = 'none';
      status.textContent = 'Загрузка…';

      var url = WORKER_URL + '/?user=' + encodeURIComponent(LETTERBOXD_USER)
          + '&pages=' + encodeURIComponent(PAGES);

      httpGet(url, function (text) {
        var data;
        try { data = JSON.parse(text); }
        catch (e) { status.textContent = 'Неверный JSON'; return; }

        var items = (data && data.items) ? data.items : [];
        if (!items.length) { status.textContent = 'Пусто'; return; }

        grid.innerHTML = '';
        for (var i = 0; i < items.length; i++) {
          var it = items[i];
          var card = document.createElement('div');
          card.className = 'card selector focusable';
          card.setAttribute('tabindex', '0');

          var poster = document.createElement('div');
          poster.className = 'poster';
          if (it.poster) poster.style.backgroundImage = 'url(' + it.poster + ')';

          var cap = document.createElement('div');
          cap.className = 'caption';
          cap.textContent = (it.title || 'Без названия') + (it.year ? ' (' + it.year + ')' : '');

          card.appendChild(poster);
          card.appendChild(cap);

          // клики, Enter и "hover:enter" из Лампы
          var openFull = (function(item){
            return function(){
              try {
                Lampa.Activity.push({ title: item.title, url:'', component:'full', id:item.tmdb_id, method:'movie' });
              } catch (e) {
                // фолбэк: откроем TMDB в внешнем браузере
                try { window.open('https://www.themoviedb.org/movie/' + item.tmdb_id, '_blank'); }
                catch(_) { noty('Не удалось открыть карточку'); }
              }
            };
          })(it);

          card.addEventListener('click', openFull);
          card.addEventListener('keydown', function(ev){ if ((ev.key||'').toLowerCase() === 'enter' || ev.keyCode === 13) openFull(); });
          if (window.$) $(card).on('hover:enter', openFull);

          grid.appendChild(card);
        }

        status.style.display = 'none';
        grid.style.display = '';
      }, function (err) {
        var msg = (err && err.message) ? err.message : 'Ошибка';
        status.innerHTML = 'Сеть/доступ: ' + msg + '<div class="muted">Проверь URL воркера и CORS</div>';
      });
    }
  }

  // ---------- плавающая кнопка ----------
  function injectButton() {
    if (document.getElementById('lb-ov-btn')) return;

    var btn = document.createElement('div');
    btn.id = 'lb-ov-btn';
    btn.textContent = 'Letterboxd';
    btn.style.cssText =
      'position:fixed;top:12px;right:12px;z-index:9999;padding:8px 12px;'+
      'background:#2b2b2b;color:#fff;border-radius:8px;font-size:14px;opacity:.9;cursor:pointer';
    btn.onclick = openOverlay;
    document.body.appendChild(btn);
  }

  // старт через короткую задержку (чтобы Home успел построиться)
  setTimeout(injectButton, 500);
})();
