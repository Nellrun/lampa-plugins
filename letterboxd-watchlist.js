/* letterboxd-watchlist-homerun.js — максимально тупо и надёжно для Lampa 3.0.7
   — добавляет пункт в левое меню через прямую вставку в DOM
   — если меню недоступно, рисует плавающую кнопку в углу
   — открывает свой экран с гридом фильмов
   Ест JSON воркера: { user, count, items:[ { tmdb_id,title,year,poster,backdrop,vote_average } ] }
*/
(function(){
  'use strict';

  var WORKER_URL = 'https://nellrun.workers.dev'; // <-- ПОМЕНЯЙ
  var LETTERBOXD_USER = 'Nellrun';
  var PAGES  = 3;
  var LANG   = 'ru-RU';
  var REGION = 'RU';

  // ---------- утилиты ----------
  function httpGet(url, ok, fail){
    try{
      var xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      xhr.onreadystatechange = function(){
        if (xhr.readyState === 4){
          if (xhr.status >= 200 && xhr.status < 300) ok(xhr.responseText);
          else fail && fail(new Error('HTTP ' + xhr.status));
        }
      };
      xhr.send(null);
    }catch(e){ fail && fail(e); }
  }
  function noty(s){ try{ Lampa.Noty.show(s); }catch(_){} }

  function waitFor(sel, cb, timeout){
    var t0 = Date.now();
    var iv = setInterval(function(){
      try{
        var el = document.querySelector(sel);
        if (el){
          clearInterval(iv);
          cb(el);
        } else if (timeout && Date.now() - t0 > timeout){
          clearInterval(iv);
          cb(null);
        }
      }catch(e){}
    }, 120);
  }

  // ---------- карточки ----------
  function cardFromTemplate(item){
    try{
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
          try{
            Lampa.Activity.push({ title: item.title, url:'', component:'full', id:item.tmdb_id, method:'movie' });
          }catch(e){ noty('Не открыть карточку: ' + e.message); }
        });
        return el;
      }
    }catch(_){}
    return null;
  }
  function cardFallback(item){
    var el = $('<div class="card selector focusable" style="width:140px;margin:8px;"></div>');
    var v  = $('<div style="position:relative;width:100%;padding-top:150%;background:#222;border-radius:8px;overflow:hidden;"></div>');
    if (item.poster){
      v.css('background-image','url(' + item.poster + ')')
       .css('background-size','cover')
       .css('background-position','center');
    }
    var t = $('<div style="margin-top:6px;font-size:13px;line-height:1.3;"></div>')
      .text((item.title||'Без названия') + (item.year ? ' ('+item.year+')' : ''));
    el.append(v).append(t);
    el.on('hover:enter', function(){
      try{
        Lampa.Activity.push({ title:item.title, url:'', component:'full', id:item.tmdb_id, method:'movie' });
      }catch(e){ noty('Не открыть карточку: ' + e.message); }
    });
    return el;
  }
  function buildGrid(items){
    var wrap = $('<div style="display:flex;flex-wrap:wrap;gap:4px;"></div>');
    for (var i=0;i<items.length;i++){
      var it = items[i];
      var el = cardFromTemplate(it) || cardFallback(it);
      wrap.append(el);
    }
    return wrap;
  }

  // ---------- экран ----------
  function openScreen(){
    // только контентная область, чтобы не ломать шапки/меню
    var box = $('<div class="lb-box"></div>');
    var scroll = new Lampa.Scroll({ mask:true });
    var status = $('<div style="padding:16px;opacity:.85;">Загрузка…</div>');
    scroll.render().addClass('scroll--padding');
    scroll.append(status);
    box.append(scroll.render());

    // пробуем сделать отдельную активити, если ядро разрешит
    var attached = false;
    try{
      Lampa.Activity.push({ title:'Letterboxd Watchlist', component:'empty', url:'', id:'lb_watchlist_home' });
      Lampa.Activity.active().render().append(box);
      attached = true;
    }catch(_){}
    if (!attached){
      try{ document.body && document.body.appendChild(box[0]); }catch(_){}
    }

    try{
      Lampa.Controller.add('lb_watchlist_ctrl', {
        toggle:function(){
          Lampa.Controller.collectionSet(scroll.render(), box);
          Lampa.Controller.collectionFocus(false, box);
        },
        back:function(){ try{ Lampa.Activity.backward(); }catch(_){} },
        up:function(){ Lampa.Controller.move('up'); },
        down:function(){ Lampa.Controller.move('down'); },
        left:function(){ Lampa.Controller.move('left'); },
        right:function(){ Lampa.Controller.move('right'); },
        enter:function(){ Lampa.Controller.click(); }
      });
      Lampa.Controller.toggle('lb_watchlist_ctrl');
    }catch(_){}

    var url = WORKER_URL + '/?user='+encodeURIComponent(LETTERBOXD_USER)
            + '&pages='+encodeURIComponent(PAGES)
            + '&lang='+encodeURIComponent(LANG)
            + '&region='+encodeURIComponent(REGION);

    httpGet(url, function(text){
      var data;
      try{ data = JSON.parse(text); }catch(e){ status.text('Letterboxd: неверный JSON'); return; }
      var items = (data && data.items) ? data.items : [];
      if (!items.length){ status.text('Letterboxd: пусто'); return; }
      var grid = buildGrid(items);
      status.remove();
      scroll.append(grid);
      scroll.update();
    }, function(err){
      status.text('Letterboxd: сеть/доступ. ' + (err && err.message ? err.message : 'Ошибка'));
    });
  }

  // ---------- запуск из Home ----------
  function injectMenuButton(){
    // 1) Пробуем в левое меню
    waitFor('.menu__list, .menu', function(ul){
      if (!ul) return injectFloatingButton(); // меню не нашли
      if (document.getElementById('lb-watchlist-menu')) return; // уже вставлено

      var li = document.createElement('li');
      li.id = 'lb-watchlist-menu';
      li.className = 'menu__item selector focusable';
      li.setAttribute('data-action','lb_watchlist_home');
      li.innerHTML =
        '<div class="menu__ico icon"><svg><use xlink:href="#icon-star"></use></svg></div>' +
        '<div class="menu__text">Letterboxd</div>';

      ul.appendChild(li);

      // поддержим и клик мышью, и remote-событие
      $(li).on('click', openScreen);
      $(li).on('hover:enter', openScreen);
    }, 3000);
  }
  function injectFloatingButton(){
    // 2) Если меню не далось — кнопка в углу
    if (document.getElementById('lb-float-btn')) return;
    var btn = document.createElement('div');
    btn.id = 'lb-float-btn';
    btn.textContent = 'Letterboxd';
    btn.style.cssText =
      'position:fixed;top:12px;right:12px;z-index:9999;padding:8px 12px;' +
      'background:#2b2b2b;color:#fff;border-radius:8px;font-size:14px;opacity:.85;';
    btn.onclick = openScreen;
    document.body.appendChild(btn);
    noty('Letterboxd: меню недоступно — кнопка в правом верхнем углу');
  }

  // стартуем после загрузки главной
  try{
    // если есть «готово» — дождемся
    if (Lampa && Lampa.Ready && typeof Lampa.Ready.listen === 'function'){
      Lampa.Ready.listen('app', injectMenuButton);
    } else {
      setTimeout(injectMenuButton, 400);
    }
  }catch(_){
    setTimeout(injectMenuButton, 600);
  }
})();
