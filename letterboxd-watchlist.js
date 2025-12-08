/* letterboxd-watchlist-compat.js — максимально совместимый плагин для Lampa (ES5)
   Работает с твоим воркером: { user, count, items:[ { tmdb_id, title, year, poster, backdrop, vote_average } ] }
*/
(function () {
  'use strict';

  var WORKER_URL = 'https://nellrun.workers.dev';
  var LETTERBOXD_USER = 'Nellrun';
  var PAGES  = 3;
  var LANG   = 'ru-RU';
  var REGION = 'RU';

  // ----------------- Утилиты -----------------
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

  function safeFollow(obj, method, evt, handler) {
    try {
      if (!obj) return false;
      if (obj.listener && typeof obj.listener.follow === 'function') {
        obj.listener.follow(evt, handler);
        return true;
      }
      if (typeof obj.follow === 'function') { obj.follow(evt, handler); return true; }
      if (typeof obj.on === 'function')     { obj.on(evt, handler);     return true; }
      // некоторые сборки держат listen()
      if (typeof obj.listen === 'function') { obj.listen(evt, handler);  return true; }
    } catch (e) {}
    return false;
  }

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
      } catch (e) {
        try { Lampa.Noty.show('Не удалось открыть карточку: ' + e.message); } catch (_) {}
      }
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
    var scroll = new Lampa.Scroll({ mask: true });
    scroll.render().addClass('scroll--padding').appendTo(body);

    // Контроллер — без подписок на .listener, чтобы ничего не падало
    Lampa.Controller.add('lb_watchlist_ctrl', {
      toggle: function () {
        Lampa.Controller.collectionSet(scroll.render(), html);
        Lampa.Controller.collectionFocus(false, html);
      },
      back: function () { try { Lampa.Activity.backward(); } catch (_) {} },
      up:   function () { Lampa.Controller.move('up'); },
      down: function () { Lampa.Controller.move('down'); },
      left: function () { Lampa.Controller.move('left'); },
      right:function () { Lampa.Controller.move('right'); },
      enter:function () { Lampa.Controller.click(); }
    });

    try {
      // если событие "back" есть — подключимся, если нет — просто игнор
      safeFollow(Lampa.Activity, 'listener', 'back', function (e) {
        if (e && e.target === html[0]) Lampa.Controller.toggle('content');
      });
    } catch (_) {}

    Lampa.Plugin.loading(true);

    var url =
      WORKER_URL + '/?user=' + encodeURIComponent(LETTERBOXD_USER) +
      '&pages=' + encodeURIComponent(PAGES) +
      '&lang=' + encodeURIComponent(LANG) +
      '&region=' + encodeURIComponent(REGION);

    httpGet(url, function (text) {
      Lampa.Plugin.loading(false);
      var data;
      try { data = JSON.parse(text); }
      catch (e) { try { Lampa.Noty.show('Letterboxd: неверный JSON'); } catch (_) {} return; }

      var items = (data && data.items) ? data.items : [];
      if (!items.length) { try { Lampa.Noty.show('Letterboxd: пусто'); } catch (_) {} }

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
      scroll.append(line);
      scroll.update();

      Lampa.Controller.toggle('lb_watchlist_ctrl');
    }, function (err) {
      Lampa.Plugin.loading(false);
      try { Lampa.Noty.show('Letterboxd: сеть/доступ. ' + (err && err.message ? err.message : 'Ошибка')); } catch (_) {}
    });

    // Регистрируем активити и втыкаем экран
    try {
      Lampa.Activity.push({ title: 'Letterboxd Watchlist', component: 'empty', url: '', id: 'lb_watchlist_activity' });
      Lampa.Activity.active().render().append(html);
      Lampa.Controller.toggle('lb_watchlist_ctrl');
    } catch (e) {
      try { Lampa.Noty.show('Letterboxd: не удалось открыть экран: ' + e.message); } catch (_) {}
    }
  }

  function installMenuOrOpen() {
    var okBuild = safeFollow(Lampa.Menu, 'listener', 'build', function (e) {
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

    var okSelect = safeFollow(Lampa.Menu, 'listener', 'select', function (e) {
      if (e && e.action === 'lb_watchlist') runScreen();
    });

    if (!okBuild || !okSelect) {
      // Меню-событий нет — просто откроем экран прямо сейчас
      try { Lampa.Noty.show('Letterboxd: меню недоступно, открываю экран напрямую'); } catch (_) {}
      runScreen();
    }
  }

  try {
    // Если есть Plugin.create — используем
    if (Lampa.Plugin && typeof Lampa.Plugin.create === 'function') {
      Lampa.Plugin.create({
        title: 'Letterboxd Watchlist',
        id: 'letterboxd_watchlist_compat',
        description: 'Рекомендует фильмы из Letterboxd Watchlist',
        version: '1.0.2',
        run: function () { installMenuOrOpen(); },
        destroy: function () {}
      });
    } else {
      // Иначе сразу пытаемся воткнуться в меню или открыть экран
      installMenuOrOpen();
    }
  } catch (e) {
    try { Lampa.Noty.show('Letterboxd плагин: ' + e.message); } catch (_) {}
    // Последний шанс — просто открыть
    try { runScreen(); } catch (_) {}
  }
})();
