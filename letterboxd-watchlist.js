/* letterboxd-watchlist-v307.js — совместимо с Lampa 3.0.7, без меню и без loading
   Ест JSON с воркера: { user, count, items:[ { tmdb_id,title,year,poster,backdrop,vote_average } ] }
*/
(function () {
  'use strict';

  var WORKER_URL = 'https://nellrun.workers.dev'; // <-- ПОМЕНЯЙ
  var LETTERBOXD_USER = 'Nellrun';
  var PAGES  = 3;
  var LANG   = 'ru-RU';
  var REGION = 'RU';

  // --------- утилиты ----------
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
  function noty(msg){ try{ Lampa.Noty.show(msg); }catch(_){} }

  // --------- карточки ----------
  function cardFromTemplate(item){
    try{
      // если в этой версии есть шаблонизатор карточек — используем его
      if (Lampa.Template && typeof Lampa.Template.get === 'function'){
        var data = {
          title: item.title,
          release_year: item.year || '',
          poster: item.poster,
          backdrop_path: item.backdrop || '',
          vote_average: item.vote_average || 0
        };
        var el = $(Lampa.Template.get('card', data));
        el.addClass('selector focusable');

        el.on('hover:enter', function(){
          try {
            Lampa.Activity.push({ title: item.title, url: '', component: 'full', id: item.tmdb_id, method: 'movie' });
          } catch(e){ noty('Не открыть карточку: ' + e.message); }
        });
        return el;
      }
    }catch(_){}
    return null;
  }
  function cardFallback(item){
    var el = $('<div class="card selector focusable" style="width:140px;margin:8px;"></div>');
    var v  = $('<div class="card__view" style="position:relative;width:100%;padding-top:150%;background:#222;border-radius:8px;overflow:hidden;"></div>');
    if (item.poster){
      v.css('background-image','url(' + item.poster + ')')
       .css('background-size','cover')
       .css('background-position','center');
    }
    var t = $('<div class="card__title" style="margin-top:6px;font-size:13px;line-height:1.3;"></div>')
      .text((item.title||'Без названия') + (item.year ? ' ('+item.year+')' : ''));
    el.append(v).append(t);
    el.on('hover:enter', function(){
      try{
        Lampa.Activity.push({ title: item.title, url: '', component: 'full', id: item.tmdb_id, method: 'movie' });
      }catch(e){ noty('Не открыть карточку: ' + e.message); }
    });
    return el;
  }
  function buildGrid(items){
    var wrap = $('<div class="lb-grid" style="display:flex;flex-wrap:wrap;gap:4px;"></div>');
    for (var i=0;i<items.length;i++){
      var it = items[i];
      var el = cardFromTemplate(it) || cardFallback(it);
      wrap.append(el);
    }
    return wrap;
  }

  // --------- экран ----------
  function runScreen(){
    // Только контент. Никаких .layer--top и самодельных хэдов, чтобы верстку не уводить.
    var box   = $('<div class="letterboxd-box"></div>');
    var scrollWrap = new Lampa.Scroll({ mask: true });
    var status = $('<div style="padding:16px;opacity:.85;">Загрузка…</div>');

    scrollWrap.render().addClass('scroll--padding');
    scrollWrap.append(status);
    box.append(scrollWrap.render());

    // Попробуем корректно встроиться в активити
    var pushed = false;
    try{
      Lampa.Activity.push({ title: 'Letterboxd Watchlist', component: 'empty', url: '', id: 'lb_watchlist_v307' });
      Lampa.Activity.active().render().append(box);
      pushed = true;
    }catch(_){
      // запасной вариант: воткнем в body, чтобы хоть что-то увидеть
      try{ $('body').append(box); }catch(__){}
    }

    // Контроллер
    try{
      Lampa.Controller.add('lb_watchlist_ctrl', {
        toggle: function(){
          Lampa.Controller.collectionSet(scrollWrap.render(), box);
          Lampa.Controller.collectionFocus(false, box);
        },
        back: function(){ try{ Lampa.Activity.backward(); }catch(_){ /* ок */ } },
        up:   function(){ Lampa.Controller.move('up'); },
        down: function(){ Lampa.Controller.move('down'); },
        left: function(){ Lampa.Controller.move('left'); },
        right:function(){ Lampa.Controller.move('right'); },
        enter:function(){ Lampa.Controller.click(); }
      });
      Lampa.Controller.toggle('lb_watchlist_ctrl');
    }catch(_){}

    // Дёргаем воркер
    var url = WORKER_URL + '/?user=' + encodeURIComponent(LETTERBOXD_USER)
            + '&pages=' + encodeURIComponent(PAGES)
            + '&lang='  + encodeURIComponent(LANG)
            + '&region='+ encodeURIComponent(REGION);

    httpGet(url, function(text){
      var data;
      try{ data = JSON.parse(text); }catch(e){ status.text('Letterboxd: неверный JSON'); return; }

      var items = (data && data.items) ? data.items : [];
      if (!items.length) { status.text('Letterboxd: пусто'); return; }

      var grid = buildGrid(items);
      status.remove();
      scrollWrap.append(grid);
      scrollWrap.update();

    }, function(err){
      status.text('Letterboxd: сеть/доступ. ' + (err && err.message ? err.message : 'Ошибка'));
    });
  }

  // Запускаем сразу при загрузке скрипта
  try {
    if (Lampa && Lampa.Ready && typeof Lampa.Ready.listen === 'function'){
      // некоторые сборки имеют «готово» событие
      Lampa.Ready.listen('app', function(){ runScreen(); });
    } else {
      // просто попробуем через короткую задержку, чтобы ядро успело подняться
      setTimeout(runScreen, 300);
    }
  } catch (e) {
    // совсем плохо? ну хоть скажем
    noty('Letterboxd плагин: ' + e.message);
    setTimeout(runScreen, 300);
  }
})();
