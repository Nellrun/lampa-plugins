(function () {
    'use strict';

    var network = new Lampa.Reguest();

    // === KEYS ===
    const S_KEYS = {
        MOVIES: 'letterboxd_movies',
        USER:   'letterboxd_user',
        PAGES:  'letterboxd_pages',
        WORKER: 'letterboxd_worker',
        FIRST:  'letterboxd_launched_before'
    };

    const DEFAULTS = {
        user:   '',
        pages:  1,
        worker: 'https://lbox-proxy.nellrun.workers.dev'
    };

    // === HELPERS ===
    function readJSON(key, fallback) {
        try {
            const raw = Lampa.Storage.get(key, null);
            if (raw == null) return fallback;
            if (typeof raw === 'string') return JSON.parse(raw);
            if (Array.isArray(raw)) return raw;
            return raw || fallback;
        } catch { return fallback; }
    }

    function writeJSON(key, value) {
        try { Lampa.Storage.set(key, JSON.stringify(value)); }
        catch { Lampa.Storage.set(key, value); }
    }

    function tmdbBase() {
        return Lampa.Utils.protocol() + 'tmdb.' + Lampa.Manifest.cub_domain + '/3';
    }

    function todayISO() {
        const d = new Date(), m = String(d.getMonth()+1).padStart(2,'0'), day = String(d.getDate()).padStart(2,'0');
        return `${d.getFullYear()}-${m}-${day}`;
    }

    // Нормализуем элементы из воркера
    function normalizeWorkerItems(resp) {
        const arr = Array.isArray(resp?.items) ? resp.items : (Array.isArray(resp) ? resp : []);
        const out = [];
        const seen = new Set();
        for (const it of arr) {
            const tmdb = it.tmdb_id ?? it.tmdb ?? it.id_tmdb ?? null;
            const imdb = it.imdb_id ?? it.imdb ?? null;
            const title = it.title ?? it.name ?? '';
            const year = it.year ?? it.release_year ?? it.first_air_date?.slice(0,4) ?? it.release_date?.slice(0,4) ?? '';
            const media_type = it.media_type ?? it.type ?? null; // 'movie' | 'tv'
            const key = tmdb ? 'tmdb:' + tmdb : `t:${title}|y:${year}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({ tmdb, imdb, title, year, media_type });
        }
        return out;
    }

    // Вытаскиваем watchlist из воркера
    function fetchFromWorker(user, pages, worker, onDone) {
        // сначала пробуем merged ?pages=N
        const merged = `${worker}/?user=${encodeURIComponent(user)}&pages=${encodeURIComponent(pages)}`;
        network.silent(merged, function (data) {
            onDone(null, normalizeWorkerItems(data));
        }, function () {
            // фолбэк: страница за страницей
            let page = 1, acc = [];
            const next = () => {
                if (page > pages) return onDone(null, acc);
                const url = `${worker}/?user=${encodeURIComponent(user)}&page=${page}`;
                network.silent(url, function (d) {
                    acc = acc.concat(normalizeWorkerItems(d));
                    page++; next();
                }, function () { page++; next(); }, false, { type: 'get' });
            };
            next();
        }, false, { type: 'get' });
    }

    // TMDB: по id
    function tmdbFetchById(id, mediaType, cb) {
        const api_key = '4ef0d7355d9ffb5151e987764708ce96';
        const base = tmdbBase();
        const url = mediaType
            ? `${base}/${mediaType}/${id}?api_key=${api_key}&language=ru`
            : `${base}/movie/${id}?api_key=${api_key}&language=ru`;
        network.silent(url, d => cb(null, d), () => cb('err'), false, { type: 'get' });
    }

    // TMDB: поиск по названию
    function tmdbSearch(title, year, preferTV, cb) {
        const base = tmdbBase(), key = '4ef0d7355d9ffb5151e987764708ce96';
        const multi = `${base}/search/multi?query=${encodeURIComponent(title)}&api_key=${key}&language=ru&include_adult=false${year?`&year=${year}`:''}`;
        network.silent(multi, function (data) {
            const res = (data?.results || []).filter(r => r.media_type === 'movie' || r.media_type === 'tv');
            let pick = null;
            if (preferTV) pick = res.find(r => r.media_type === 'tv');
            pick = pick || res[0] || null;
            if (!pick) return cb('nf');
            cb(null, pick, pick.media_type === 'tv' ? 'tv' : 'movie');
        }, function () { cb('err'); }, false, { type: 'get' });
    }

    function released(item) {
        const d = item.release_date || item.first_air_date;
        return !d || d <= todayISO();
    }

    // Основной пайплайн
    function refreshList(user, pages, worker, done) {
        const old = readJSON(S_KEYS.MOVIES, []);
        writeJSON(S_KEYS.MOVIES, []); // очистим, наполним заново

        fetchFromWorker(user, pages, worker, function (_e, items) {
            if (!items || !items.length) {
                writeJSON(S_KEYS.MOVIES, []);
                Lampa.Noty.show('Список Letterboxd пуст или недоступен');
                return done([]);
            }

            let processed = 0;
            const total = items.length;

            function step() {
                processed++;
                if (processed >= total) {
                    const fin = readJSON(S_KEYS.MOVIES, []);
                    Lampa.Noty.show('Обновление Letterboxd завершено (' + String(fin.length) + ')');
                    if (Lampa.Storage.get(S_KEYS.FIRST, false) === false) {
                        Lampa.Storage.set(S_KEYS.FIRST, true);
                        Lampa.Activity.push({ url: '', title: 'Letterboxd', component: 'letterboxd', page: 1 });
                    }
                    done(fin);
                }
            }

            items.forEach(it => {
                // если есть tmdb id — берём быстро
                if (it.tmdb) {
                    tmdbFetchById(it.tmdb, it.media_type, function (_e2, data) {
                        if (data && data.id && released(data)) {
                            const cur = readJSON(S_KEYS.MOVIES, []);
                            cur.unshift(data);
                            writeJSON(S_KEYS.MOVIES, cur);
                        }
                        step();
                    });
                } else {
                    tmdbSearch(it.title, it.year, it.media_type === 'tv', function (_e3, found, type) {
                        if (found && released(found)) {
                            const cur = readJSON(S_KEYS.MOVIES, []);
                            cur.unshift(found);
                            writeJSON(S_KEYS.MOVIES, cur);
                        }
                        step();
                    });
                }
            });
        });
    }

    // === API для компонента ===
    function full(params, oncomplete) {
        const user   = String(Lampa.Storage.get(S_KEYS.USER, DEFAULTS.user) || '').trim();
        const pages  = Number(Lampa.Storage.get(S_KEYS.PAGES, DEFAULTS.pages)) || 1;
        const worker = String(Lampa.Storage.get(S_KEYS.WORKER, DEFAULTS.worker) || '').trim();

        if (!user) {
            Lampa.Noty.show('Укажите имя пользователя Letterboxd в настройках');
            oncomplete({ secuses: true, page: 1, results: [] });
            return;
        }

        refreshList(user, pages, worker, function () {
            oncomplete({ secuses: true, page: 1, results: readJSON(S_KEYS.MOVIES, []) });
        });
    }

    function clear(){ network.clear(); }
    var Api = { full, clear };

    // === Компонент ===
    function component(object) {
        var comp = new Lampa.InteractionCategory(object);
        comp.create = function() { Api.full(object, this.build.bind(this), this.empty.bind(this)); };
        comp.nextPageReuest = function(object, resolve, reject) { Api.full(object, resolve.bind(comp), reject.bind(comp)); };
        return comp;
    }

    // === Регистрация, меню и настройки ===
    function startPlugin() {
        var manifest = {
            type: 'video',
            version: '0.4.1',
            name: 'Letterboxd',
            description: 'Watchlist из Letterboxd',
            component: 'letterboxd'
        };

        // безопасно добавим в манифест
        if (Array.isArray(Lampa.Manifest?.plugins)) Lampa.Manifest.plugins.push(manifest);
        else Lampa.Manifest.plugins = manifest;

        Lampa.Component.add('letterboxd', component);

        function addMenu() {
            var button = $(
                `<li class="menu__item selector">
                    <div class="menu__ico">
                        <svg viewBox="0 0 24 24" width="239" height="239" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                          <path d="M4 4h16v2H4zM4 9h16v2H4zM4 14h16v2H4zM4 19h10v2H4z"/>
                        </svg>
                    </div>
                    <div class="menu__text">${manifest.name}</div>
                </li>`
            );
            button.on('hover:enter', function () {
                if (!Lampa.Storage.get(S_KEYS.USER, '')) {
                    Lampa.Noty.show('Сначала задайте имя пользователя в настройках');
                    Lampa.Controller.toggle('settings_component');
                    return;
                }
                Lampa.Activity.push({ url: '', title: manifest.name, component: 'letterboxd', page: 1 });
            });
            $('.menu .menu__list').eq(0).append(button);
        }

        if (window.appready) addMenu();
        else Lampa.Listener.follow('app', function(e){ if (e.type == 'ready') addMenu(); });

        // SETTINGS COMPONENT
        if (!window.lampa_settings || !window.lampa_settings.letterboxd) {
            Lampa.SettingsApi.addComponent({
                component: 'letterboxd',
                icon: '<svg viewBox="0 0 24 24" width="239" height="239" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M4 4h16v2H4zM4 9h16v2H4zM4 14h16v2H4zM4 19h10v2H4z"/></svg>',
                name: 'Letterboxd'
            });
        }

        // Заголовок
        Lampa.SettingsApi.addParam({
            component: 'letterboxd',
            param: { type: 'title' },
            field: { name: 'Параметры' }
        });

        // Имя пользователя (input)
        Lampa.SettingsApi.addParam({
            component: 'letterboxd',
            param: {
                name: S_KEYS.USER,
                type: 'input',
                default: Lampa.Storage.get(S_KEYS.USER, DEFAULTS.user) || ''
            },
            field: {
                name: 'Имя пользователя',
                description: 'Публичный username в Letterboxd'
            },
            onChange: (v) => { Lampa.Storage.set(S_KEYS.USER, String(v||'').trim()); }
        });

        // Количество страниц (input number, без select)
        Lampa.SettingsApi.addParam({
            component: 'letterboxd',
            param: {
                name: S_KEYS.PAGES,
                type: 'input',
                default: String(Lampa.Storage.get(S_KEYS.PAGES, DEFAULTS.pages) || 1)
            },
            field: {
                name: 'Страниц',
                description: 'Сколько страниц тянуть из воркера (число от 1 до 5)'
            },
            onChange: (v) => {
                const n = Math.max(1, Math.min(5, parseInt(v,10) || 1));
                Lampa.Storage.set(S_KEYS.PAGES, n);
            }
        });

        // URL воркера (input)
        Lampa.SettingsApi.addParam({
            component: 'letterboxd',
            param: {
                name: S_KEYS.WORKER,
                type: 'input',
                default: Lampa.Storage.get(S_KEYS.WORKER, DEFAULTS.worker) || ''
            },
            field: {
                name: 'URL воркера',
                description: 'Cloudflare Worker, отдающий JSON watchlist'
            },
            onChange: (v) => { Lampa.Storage.set(S_KEYS.WORKER, String(v||'').trim() || DEFAULTS.worker); }
        });

        // Кнопка: обновить
        Lampa.SettingsApi.addParam({
            component: 'letterboxd',
            param: { type: 'button', name: 'letterboxd_refresh' },
            field: { name: 'Обновить сейчас', description: 'Забрать свежий watchlist' },
            onChange: () => {
                const user   = String(Lampa.Storage.get(S_KEYS.USER, DEFAULTS.user) || '').trim();
                if (!user) { Lampa.Noty.show('Укажите имя пользователя'); return; }
                const pages  = Number(Lampa.Storage.get(S_KEYS.PAGES, DEFAULTS.pages)) || 1;
                const worker = String(Lampa.Storage.get(S_KEYS.WORKER, DEFAULTS.worker) || '').trim();
                refreshList(user, pages, worker, function () {
                    Lampa.Noty.show('Готово. Откройте раздел Letterboxd.');
                });
            }
        });

        // Кнопка: очистить кэш
        Lampa.SettingsApi.addParam({
            component: 'letterboxd',
            param: { type: 'button', name: 'letterboxd_delete_cache' },
            field: { name: 'Очистить кэш', description: 'Если что-то сломалось' },
            onChange: () => { writeJSON(S_KEYS.MOVIES, []); Lampa.Noty.show('Кэш Letterboxd очищен'); }
        });

        // отметим, что уже поднялись
        window.letterboxd_ready = true;
    }

    if (!window.letterboxd_ready) startPlugin();
})();
