/* letterboxd-watchlist-noloading.js — плагин без Lampa.Plugin.loading (ES5)
   Работает с воркером: { user, count, items:[ { tmdb_id, title, year, poster, backdrop, vote_average } ] }
*/
(function () {
  'use strict';

  var WORKER_URL = 'https://nellrun.workers.dev'; // <-- ПОМЕНЯЙ
  var LETTERBOXD_USER = 'Nellrun';
  var PAGES  = 3;
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

  function safeFollow(obj, evt, handler) {
    try {
      if (!obj) return false;
      if (obj.listener && typeof obj.listener.follow === 'function') { obj.listener.follow(evt, handler); return true; }
      if (typeof obj.follow === 'function') { obj.follow(evt, handler); return true; }
      if (typeof obj.on === 'function')     { obj.on(evt, handler);     return true; }
      if (typeof obj.listen === 'function') { obj.listen(evt, handler); return true; }
    } catch (_) {}
    return false;
  }

  function noty(msg) {
    try { Lampa.Noty.show(msg); } catch (_) {}
  }

  // ---------- карточки ----------
  function buildCard(item) {
    var card = $('<div class="card selector focusable"></div>');
    var view = $('<div class="card__view"></div>');
    var img  = $('<img class="card__img">');
    if (item.poster) img.attr('src', item.poster);
    view.append(img);
    card.append(view);

    var title = item.title || 'Без названия';
    var year  = item.year ? ' (' + item.year + ')' : '';
    var caption = $('<div class="card__title"></div>').text(title + year);
    card.append(caption);

    card.on('hover:enter', function () {
      try {
        Lampa.Activity.push({
          title: title,
          url: '',
          component: 'full',
          id: item.tmdb_id,
          method: 'movie'
        });
      } catch (e) { noty('Не удалось открыть карточку: ' + e.message); }
    });

    return card;
  }

  function buildLine(title, results) {
    var wrap = $('<div class="items-line"></div>');
    var head = $('<div class="items-line__title"></div>').text(title);
    var body = $('<div class="items-line__body"></div>');
    wrap.append(head).append(body);
    for (var i = 0; i < results.length; i++) body.append(buildCard(results[i]));
    return wrap;
  }

  // ---------- экран ----------
  function runScreen() {
    var html = $(
      '<div class="letterboxd-screen">' +
        '<div class="layer--top">' +
          '<div class="head"><div class="head__title">Letterboxd Watchlist</div></div>' +
        '</div>' +
        '<div class="content"></div>' +
      '</div>'
    );

    var body = html.find('.content');
    // без Lampa.Plugin.loading — делаем свой статус
    var status = $('<div class="letterboxd__status" style="padding:16px;opacity:.8;">Загрузка…</div>');
    body.append(status);

    // Контроллер
    try {
      Lampa.Controller.add('lb_watchlist_ctrl', {
        toggle: function () {
          Lampa.Controller.collectionSet(body, html);
          Lampa.Controller.collectionFocus(false, html);
        },
        back: function () { try { Lampa.Activity.backward(); } catch (_) {} },
        up:   function () { Lampa.Controller.move('up'); },
        down: function () { Lampa.Controller.move('down'); },
        left: function () { Lampa.Controller.move('left'); },
        right:function () { Lampa.Controller.move('right'); },
        enter:function () { Lampa.Controller.click(); }
      });

      safeFollow(Lampa.Activity, 'back', function (e) {
        if (e && e.target === html[0]) Lampa.Controller.toggle('content');
      });
    } catch (_) {}

    var url =
      WORKER_URL + '/?user=' + encodeURIComponent(LETTERBOXD_USER) +
      '&pages=' + encodeURIComponent(PAGES) +
      '&lang=' + encodeURIComponent(LANG) +
      '&region=' + encodeURIComponent(REGION);

    httpGet(url, function (text) {
      var data;
      try { data = JSON.parse(text); }
      catch (e) { status.text('Letterboxd: неверный JSON'); return; }

      var items = (data && data.items) ? data.items : [];
      if (!items.length) status.text('Letterboxd: пусто');

      var results = [];
      for (var i = 0; i < items.length; i++) {
        results.push({
          tmdb_id: items[i].tmdb_id,
          title: items[i].title,
          year:  items[i].year,
          poster: items[i].poster,
          backdrop: items[i].backdrop,
          vote_average: items[i].vote_average
        });
      }

      var line = buildLine('Рекомендации из Letterboxd', results);
      status.remove();
      body.append(line);

      try { Lampa.Controller.toggle('lb_watchlist_ctrl'); } catch (_) {}
    }, function (err) {
      status.text('Letterboxd: сеть/доступ. ' + (err && err.message ? err.message : 'Ошибка'));
    });

    // Активити и вставка в DOM
    try {
      Lampa.Activity.push({ title: 'Letterboxd Watchlist', component: 'empty', url: '', id: 'lb_watchlist_activity' });
      Lampa.Activity.active().render().append(html);
      Lampa.Controller.toggle('lb_watchlist_ctrl');
    } catch (e) {
      // если Activity отсутствует — просто попытаемся вставить в body страницы
      try { $('body').append(html); } catch (_) {}
    }
  }

  function installMenuOrOpen() {
    var hadBuild = safeFollow(Lampa.Menu, 'build', function (e) {
      try {
        var item = $(
          '<li class="menu__item selector focusable" data-action="lb_watchlist">' +
            '<div class="menu__ico icon"><svg><use xlink:href="#icon-star"></use></svg></div>' +
            '<div class="menu__text">Letterboxd Watchlist</div>' +
          '</li>'
        );
        if (e && e.menu && e.menu.recently) e.menu.recently.append(item);
        else if (e && e.menu && e.menu.main) e.menu.main.append(item);
      } catch (_) {}
    });

    var hadSelect = safeFollow(Lampa.Menu, 'select', function (e) {
      if (e && e.action === 'lb_watchlist') runScreen();
    });

    if (!hadBuild || !hadSelect) {
      noty('Letterboxd: меню недоступно, открываю экран напрямую');
      runScreen();
    }
  }

  try {
    if (Lampa.Plugin && typeof Lampa.Plugin.create === 'function') {
      Lampa.Plugin.create({
        title: 'Letterboxd Watchlist',
        id: 'letterboxd_watchlist_noloading',
        description: 'Рекомендует фильмы из Letterboxd Watchlist',
        version: '1.0.3',
        run: function () { installMenuOrOpen(); },
        destroy: function () {}
      });
    } else {
      installMenuOrOpen();
    }
  } catch (e) {
    noty('Letterboxd плагин: ' + e.message);
    try { runScreen(); } catch (_) {}
  }
})();
