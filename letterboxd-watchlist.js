/* letterboxd-watchlist-legacy.js — ES5-совместимый плагин для Lampa
   Работает с воркером, который отдаёт:
   { user, count, items:[ { tmdb_id, title, year, poster, backdrop, vote_average, slug } ] }
*/
(function () {
  'use strict';

  var WORKER_URL = 'https://nellrun.workers.dev'; // <-- ПОМЕНЯЙ
  var LETTERBOXD_USER = 'Nellrun';
  var PAGES  = 3;
  var LANG   = 'ru-RU';
  var REGION = 'RU';

  // Примитивный XHR (без fetch, чтобы старые WebView не падали)
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
    } catch (e) {
      fail && fail(e);
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c];
    });
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

    // Навигация Лампы: событие выбора
    card.on('hover:enter', function () {
      Lampa.Activity.push({
        title: title,
        url: '',
        component: 'full',
        id: item.tmdb_id,     // TMDB movie id
        method: 'movie'
      });
    });

    return card;
  }

  function buildLine(title, results) {
    var wrap = $('<div class="items-line"></div>');
    var head = $('<div class="items-line__title"></div>').text(title);
    var body = $('<div class="items-line__body"></div>');

    wrap.append(head);
    wrap.append(body);

    for (var i = 0; i < results.length; i++) {
      body.append(buildCard(results[i]));
    }

    return wrap;
  }

  function screen() {
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

    // Контроллер управления
    Lampa.Controller.add('lb_watchlist_ctrl', {
      toggle: function () {
        Lampa.Controller.collectionSet(scroll.render(), html);
        Lampa.Controller.collectionFocus(false, html);
      },
      back: function () { Lampa.Activity.backward(); },
      up:   function () { Lampa.Controller.move('up'); },
      down: function () { Lampa.Controller.move('down'); },
      left: function () { Lampa.Controller.move('left'); },
      right:function () { Lampa.Controller.move('right'); },
      enter:function () { Lampa.Controller.click(); }
    });

    Lampa.Activity.listener.follow('back', function (e) {
      if (e.target === html[0]) Lampa.Controller.toggle('content');
    });

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
      catch (e) {
        Lampa.Noty.show('Letterboxd: неверный JSON');
        return;
      }

      var items = (data && data.items) ? data.items : [];
      if (!items.length) {
        Lampa.Noty.show('Letterboxd: пусто');
      }

      // Маппим под ожидания карточек
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
      Lampa.Noty.show('Letterboxd: сеть/доступ. ' + (err && err.message ? err.message : 'Ошибка'));
    });

    // Открываем экран
    Lampa.Activity.push({
      title: 'Letterboxd Watchlist',
      component: 'empty',
      url: '',
      id: 'lb_watchlist_activity'
    });

    Lampa.Activity.active().render().append(html);
    Lampa.Controller.toggle('lb_watchlist_ctrl');
  }

  // Добавляем пункт меню и регистрируем плагин
  function installMenu() {
    var item = $(
      '<li class="menu__item selector focusable" data-action="lb_watchlist">' +
        '<div class="menu__ico icon"><svg><use xlink:href="#icon-star"></use></svg></div>' +
        '<div class="menu__text">Letterboxd Watchlist</div>' +
      '</li>'
    );

    Lampa.Menu.listener.follow('build', function (e) {
      // куда угодно, лишь бы видно было
      if (e.menu && e.menu.recently) e.menu.recently.append(item);
      else if (e.menu && e.menu.main) e.menu.main.append(item);
    });

    Lampa.Menu.listener.follow('select', function (e) {
      if (e.action === 'lb_watchlist') screen();
    });
  }

  try {
    Lampa.Plugin.create({
      title: 'Letterboxd Watchlist',
      id: 'letterboxd_watchlist_legacy',
      description: 'Рекомендует фильмы из Letterboxd Watchlist',
      version: '1.0.1',
      run: function () { installMenu(); },
      destroy: function () {}
    });
  } catch (e) {
    // если у твоей сборки нет create – просто ставим меню
    try { installMenu(); } catch (ee) {
      if (Lampa && Lampa.Noty) Lampa.Noty.show('Letterboxd плагин: ' + ee.message);
    }
  }
})();
