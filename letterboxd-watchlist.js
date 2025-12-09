(function () {
    'use strict';

    if (window.letterboxd_ready) return;
    window.letterboxd_ready = true;

    var network = new Lampa.Reguest();

    // ---- storage keys
    const S = {
        MOVIES: 'letterboxd_movies',
        USER:   'letterboxd_user',
        PAGES:  'letterboxd_pages',
        WORKER: 'letterboxd_worker',
        FIRST:  'letterboxd_launched_before'
    };

    // ---- defaults
    const DEF = {
        user:   '',
        pages:  1,
        worker: 'https://lbox-proxy.nellrun.workers.dev'
    };

    // ---- helpers
    function readJSON(key, fallback) {
        try {
            const raw = Lampa.Storage.get(key, null);
            if (raw == null) return fallback;
            if (typeof raw === 'string') return JSON.parse(raw);
            return raw;
        } catch { return fallback; }
    }
    function writeJSON(key, val) {
        try { Lampa.Storage.set(key, JSON.stringify(val)); }
        catch { Lampa.Storage.set(key, val); }
    }
    function getStr(key, d){ const v = Lampa.Storage.get(key, d); return (v==null?d:String(v)); }
    function getInt(key, d){ const n = parseInt(Lampa.Storage.get(key, d),10); return Number.isFinite(n)?n:d; }
    function tmdbBase(){ return Lampa.Utils.protocol() + 'tmdb.'+ Lampa.Manifest.cub_domain +'/3'; }
    function todayISO(){
        const d=new Date(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');
        return `${d.getFullYear()}-${m}-${day}`;
    }

    // ---- worker normalization
    function normalizeWorkerItems(resp){
        const arr = Array.isArray(resp?.items) ? resp.items : (Array.isArray(resp) ? resp : []);
        const out=[], seen=new Set();
        for(const it of arr){
            const tmdb = it.tmdb_id ?? it.tmdb ?? it.id_tmdb ?? null;
            const imdb = it.imdb_id ?? it.imdb ?? null;
            const title = it.title ?? it.name ?? '';
            const year = it.year ?? it.release_year ?? it.first_air_date?.slice(0,4) ?? it.release_date?.slice(0,4) ?? '';
            const media_type = it.media_type ?? it.type ?? null; // movie|tv
            const key = tmdb ? `tmdb:${tmdb}` : `t:${title}|y:${year}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({ tmdb, imdb, title, year, media_type });
        }
        return out;
    }

    function fetchFromWorker(user, pages, worker, cb){
        const url = `${worker}/?user=${encodeURIComponent(user)}&pages=${encodeURIComponent(pages)}`;
        network.silent(url, d => cb(null, normalizeWorkerItems(d)), 
            () => {
                // fallback по одной странице
                let page=1, acc=[];
                const next=()=>{
                    if(page>pages) return cb(null, acc);
                    const u = `${worker}/?user=${encodeURIComponent(user)}&page=${page}`;
                    network.silent(u, d=>{ acc=acc.concat(normalizeWorkerItems(d)); page++; next(); },
                        ()=>{ page++; next(); }, false, {type:'get'});
                };
                next();
            }, false, {type:'get'});
    }

    // ---- TMDB
    function tmdbFetchById(id, mediaType, cb){
        const key='4ef0d7355d9ffb5151e987764708ce96';
        const url = mediaType ? `${tmdbBase()}/${mediaType}/${id}?api_key=${key}&language=ru`
                              : `${tmdbBase()}/movie/${id}?api_key=${key}&language=ru`;
        network.silent(url, d=>cb(null,d), ()=>cb('err'), false, {type:'get'});
    }
    function tmdbSearch(title, year, preferTV, cb){
        const key='4ef0d7355d9ffb5151e987764708ce96';
        const url=`${tmdbBase()}/search/multi?query=${encodeURIComponent(title)}&api_key=${key}&language=ru&include_adult=false${year?`&year=${year}`:''}`;
        network.silent(url, (data)=>{
            const res=(data?.results||[]).filter(r=>r.media_type==='movie'||r.media_type==='tv');
            let pick = preferTV ? res.find(r=>r.media_type==='tv') : null;
            pick = pick || res[0] || null;
            if(!pick) return cb('nf');
            cb(null, pick, pick.media_type==='tv'?'tv':'movie');
        }, ()=>cb('err'), false, {type:'get'});
    }
    function isReleased(item){
        const d=item.release_date || item.first_air_date;
        return !d || d <= todayISO();
    }

    // ---- pipeline
    function refreshList(user, pages, worker, done){
        writeJSON(S.MOVIES, []);
        fetchFromWorker(user, pages, worker, function(_e, items){
            if(!items || !items.length){
                writeJSON(S.MOVIES, []);
                Lampa.Noty.show('Список Letterboxd пуст или недоступен');
                return done([]);
            }
            let processed=0, total=items.length;
            function step(){
                processed++;
                if(processed>=total){
                    const fin = readJSON(S.MOVIES, []);
                    Lampa.Noty.show('Обновление Letterboxd завершено ('+String(fin.length)+')');
                    if(Lampa.Storage.get(S.FIRST, false)===false){
                        Lampa.Storage.set(S.FIRST, true);
                        Lampa.Activity.push({ url:'', title:'Letterboxd', component:'letterboxd', page:1 });
                    }
                    done(fin);
                }
            }
            items.forEach(it=>{
                if(it.tmdb){
                    tmdbFetchById(it.tmdb, it.media_type, function(_e2, data){
                        if(data && data.id && isReleased(data)){
                            const cur = readJSON(S.MOVIES, []);
                            cur.unshift(data); writeJSON(S.MOVIES, cur);
                        }
                        step();
                    });
                } else {
                    tmdbSearch(it.title, it.year, it.media_type==='tv', function(_e3, found){
                        if(found && isReleased(found)){
                            const cur = readJSON(S.MOVIES, []);
                            cur.unshift(found); writeJSON(S.MOVIES, cur);
                        }
                        step();
                    });
                }
            });
        });
    }

    // ---- API для компонента
    function full(params, oncomplete, _onerror){
        const user   = getStr(S.USER, DEF.user).trim();
        const pages  = Math.max(1, Math.min(5, getInt(S.PAGES, DEF.pages)));
        const worker = getStr(S.WORKER, DEF.worker).trim();
        if(!user){
            Lampa.Noty.show('Задайте имя пользователя в настройках: Настройки → Letterboxd');
            return oncomplete({ secuses:true, page:1, results: [] });
        }
        refreshList(user, pages, worker, function(){
            oncomplete({ secuses:true, page:1, results: readJSON(S.MOVIES, []) });
        });
    }
    function clear(){ network.clear(); }
    var Api = { full, clear };

    // ---- компонент
    function component(object){
        var comp = new Lampa.InteractionCategory(object);
        comp.create = function(){ Api.full(object, this.build.bind(this), this.empty.bind(this)); };
        comp.nextPageReuest = function(object, resolve, reject){ Api.full(object, resolve.bind(comp), reject.bind(comp)); };
        return comp;
    }

    // ---- регистрация + меню
    function startPlugin(){
        var manifest = {
            type: 'video',
            version: '0.6.0',
            name: 'Letterboxd',
            description: 'Watchlist из Letterboxd',
            component: 'letterboxd'
        };
        try {
            if (Array.isArray(Lampa.Manifest?.plugins)) Lampa.Manifest.plugins.push(manifest);
            else Lampa.Manifest.plugins = manifest;
        } catch {}

        Lampa.Component.add('letterboxd', component);

        function addMenu(){
            var btn = $(
                `<li class="menu__item selector">
                    <div class="menu__ico">
                        <svg viewBox="0 0 24 24" width="239" height="239" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                          <path d="M4 4h16v2H4zM4 9h16v2H4zM4 14h16v2H4zM4 19h10v2H4z"/>
                        </svg>
                    </div>
                    <div class="menu__text">${manifest.name}</div>
                </li>`
            );
            btn.on('hover:enter', function(){
                Lampa.Activity.push({ url:'', title: manifest.name, component:'letterboxd', page:1 });
            });
            $('.menu .menu__list').eq(0).append(btn);
        }
        if (window.appready) addMenu();
        else Lampa.Listener.follow('app', function(e){ if(e.type=='ready') addMenu(); });

        // ---- SETTINGS via SettingsApi (как в плагине Кинопоиска)
        if(!window.lampa_settings) window.lampa_settings = {};
        if(!window.lampa_settings.letterboxd){
            Lampa.SettingsApi.addComponent({
                component: 'letterboxd',
                icon: '<svg viewBox="0 0 24 24" width="239" height="239" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M4 4h16v2H4zM4 9h16v2H4zM4 14h16v2H4zM4 19h10v2H4z"/></svg>',
                name: 'Letterboxd'
            });
            window.lampa_settings.letterboxd = true;
        }

        // заголовок
        Lampa.SettingsApi.addParam({
            component: 'letterboxd',
            param: { type: 'title' },
            field: { name: 'Аккаунт' }
        });

        // username
        Lampa.SettingsApi.addParam({
            component: 'letterboxd',
            param: { name: S.USER, type: 'input', default: DEF.user },
            field: { name: 'Имя пользователя', description: 'Публичный username в Letterboxd' },
            onChange: ()=>{
                // просто вернуть фокус в настройки
                Lampa.Controller.toggle('settings_component');
            }
        });

        // pages (число в текстовом поле, чтобы не ловить формат у select)
        Lampa.SettingsApi.addParam({
            component: 'letterboxd',
            param: { name: S.PAGES, type: 'input', default: DEF.pages },
            field: { name: 'Страниц (1–5)', description: 'Сколько страниц watchlist грузить' },
            onChange: ()=>{
                Lampa.Controller.toggle('settings_component');
            }
        });

        // worker url
        Lampa.SettingsApi.addParam({
            component: 'letterboxd',
            param: { name: S.WORKER, type: 'input', default: DEF.worker },
            field: { name: 'URL воркера', description: 'Cloudflare Worker, отдающий JSON watchlist' },
            onChange: ()=>{
                Lampa.Controller.toggle('settings_component');
            }
        });

        // раздел действия
        Lampa.SettingsApi.addParam({
            component: 'letterboxd',
            param: { type: 'title' },
            field: { name: 'Действия' }
        });

        // обновить
        Lampa.SettingsApi.addParam({
            component: 'letterboxd',
            param: { type: 'button', name: 'letterboxd_refresh' },
            field: { name: 'Обновить список', description: 'Перечитать watchlist и заново резолвить в TMDB' },
            onChange: ()=>{
                const user   = getStr(S.USER, DEF.user).trim();
                const pages  = Math.max(1, Math.min(5, getInt(S.PAGES, DEF.pages)));
                const worker = getStr(S.WORKER, DEF.worker).trim();
                if(!user){
                    Lampa.Noty.show('Сначала укажите имя пользователя');
                    Lampa.Controller.toggle('settings_component');
                    return;
                }
                Lampa.Noty.show('Обновляю Letterboxd…');
                refreshList(user, pages, worker, function(){
                    Lampa.Noty.show('Готово');
                    Lampa.Controller.toggle('settings_component');
                });
            }
        });

        // очистить кэш
        Lampa.SettingsApi.addParam({
            component: 'letterboxd',
            param: { type: 'button', name: 'letterboxd_delete_cache' },
            field: { name: 'Очистить кэш', description: 'Если что-то поехало, можно зачистить локальный список' },
            onChange: ()=>{
                writeJSON(S.MOVIES, []);
                Lampa.Noty.show('Кэш Letterboxd очищен');
                Lampa.Controller.toggle('settings_component');
            }
        });
    }

    startPlugin();
})();
