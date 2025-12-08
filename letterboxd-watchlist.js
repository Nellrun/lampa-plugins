(function () {
  'use strict';

  const WORKER_URL = 'https://nellrun.workers.dev';
  const LETTERBOXD_USER = 'Nellrun';
  const PAGES = 3;
  const LANG = 'ru-RU';
  const REGION = 'RU';

  function runScreen() {
    const html = $('<div class="letterboxd-screen"><div class="layer--top"><div class="head"><div class="head__title">Letterboxd Watchlist</div></div></div><div class="content"></div></div>');
    const scroll = new Lampa.Scroll({ mask: true });
    const body = html.find('.content');

    scroll.render().addClass('scroll--padding').appendTo(body);
    Lampa.Controller.add('letterboxd-watchlist', {
      toggle: function(){
        Lampa.Controller.collectionSet(scroll.render(), html);
        Lampa.Controller.collectionFocus(false, html);
      },
      back: function(){
        Lampa.Activity.backward();
      },
      up: function(){ Lampa.Controller.move('up'); },
      down: function(){ Lampa.Controller.move('down'); },
      left: function(){ Lampa.Controller.move('left'); },
      right: function(){ Lampa.Controller.move('right'); },
      enter: function(){ Lampa.Controller.click(); }
    });

    Lampa.Activity.listener.follow('back', function (e) {
      if (e.target == html[0]) {
        Lampa.Controller.toggle('content');
      }
    });

    Lampa.Plugin.loading(true);

    fetch(`${WORKER_URL}/?user=${encodeURIComponent(LETTERBOXD_USER)}&pages=${PAGES}&lang=${LANG}&region=${REGION}`)
      .then(r => r.json())
      .then(data => {
        const results = (data.items || []).map(x => ({
          id: x.tmdb_id,
          title: x.title,
          year: x.year,
          vote_average: x.vote_average,
          poster: x.poster,
          backdrop_path: x.backdrop,
          release_date: x.year ? `${x.year}-01-01` : '',
          // Lampa обычно ждет поля в стиле TMDB
        }));

        // Линия карточек
        const line = new Lampa.Related();
        line.create({ title: 'Рекомендации из Letterboxd', results, url: '' });

        // как открыть карточку фильма
        line.onEnter = function (item) {
          // В разных сборках Лампы иногда по-разному, но такой вызов встречается в плагинах:
          Lampa.Activity.push({
            title: item.title,
            url: '',
            component: 'full',
            id: item.id,       // TMDB movie id
            method: 'movie'
          });
        };

        scroll.append(line.render());
        scroll.update();
        Lampa.Plugin.loading(false);
        Lampa.Controller.toggle('letterboxd-watchlist');
      })
      .catch(err => {
        Lampa.Plugin.loading(false);
        Lampa.Noty.show('Не смог получить список: ' + (err && err.message ? err.message : 'ошибка сети'));
      });

    Lampa.Activity.push({
      title: 'Letterboxd Watchlist',
      component: 'empty', // рендерим сами
      url: '',
      id: 'letterboxd-watchlist'
    });

    Lampa.Activity.active().render().append(html);
    Lampa.Controller.toggle('letterboxd-watchlist');
  }

  // Регистрируем пункт меню
  function installMenu() {
    Lampa.Template.add('menu_letterboxd_watchlist', `<li class="menu__item selector focusable" data-action="letterboxd"><div class="menu__ico icon"><svg><use xlink:href="#icon-star"></use></svg></div><div class="menu__text">Letterboxd Watchlist</div></li>`);
    Lampa.Menu.listener.follow('build', function(e){
      e.menu.recently.append(Lampa.Template.get('menu_letterboxd_watchlist', {}));
    });
    Lampa.Menu.listener.follow('select', function(e){
      if (e.action === 'letterboxd') runScreen();
    });
  }

  // Регистрация самого плагина (минимально)
  Lampa.Plugin.create({
    title: 'Letterboxd Watchlist',
    id: 'letterboxd_watchlist',
    description: 'Рекомендует фильмы из вашего Letterboxd Watchlist',
    version: '1.0.0',
    run() {
      installMenu();
    }
  });
})();
