(function () {
    'use strict';

    var network = new Lampa.Reguest();

    // === STORAGE KEYS & DEFAULTS ===
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

    // === UTIL ===
    function readJSON(key, fallback) {
        try {
            const raw = Lampa.Storage.get(key, null);
            if (Array.isArray(raw)) return raw; // на всякий
            if (typeof raw === 'string') return JSON.parse(raw);
            return fallback;
        } catch {
            return fallback;
        }
    }

    function writeJSON(key, value) {
        try { Lampa.Storage.set(key, JSON.stringify(value)); }
        catch { Lampa.Storage.set(key, value); }
    }

    function tmdbBase() {
        // используем tmdb.* из манифеста Lampa
        return Lampa.Utils.protocol() + 'tmdb.' + Lampa.Manifest.cub_domain + '/3';
    }

    function todayISO() {
        const d = new Date();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${d.getFullYear()}-${m}-${day}`;
    }

    // Нормализация объектов из воркера
    function normalizeWorkerItems(resp) {
        const arr = Array.isArray(resp?.items) ? resp.items : (Array.isArray(resp) ? resp : []);
        const out = [];
        const seen = new Set();
        for (const it of arr) {
            const tmdb = it.tmdb_id ?? it.tmdb ?? it.id_tmdb ?? null;
            const imdb = it.imdb_id ?? it.imdb ?? null;
            const title = it.title ?? it.name ?? '';
            const year = it.year ?? it.release_year ?? it.first_air_date?.slice(0,4) ?? it.release_date?.slice(0,4) ?? '';
            const media_type = it.media_type ?? it.type ?? null; // 'movie' | 'tv' | null
            const key = tmdb ? 'tmdb:' + tmdb : `t:${title}|y:${year}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({ tmdb, imdb, title, year, media_type });
        }
        return out;
    }

    // Получаем Letterboxd данные через воркер
    function fetchLetterboxdBatch(user, page, worker, onDone) {
        const url = `${worker}/?user=${encodeURIComponent(user)}&page=${encodeURIComponent(page)}`;
        network.silent(url, function (data) {
            onDone(null, normalizeWorkerItems(data));
        }, function (err) {
            onDone(err || 'error', []);
        }, false, { type: 'get' });
    }

    async function getLetterboxdData(user, pages, worker, onProgress) {
        // Сначала попробуем единым запросом ?pages=N
        const tryMerged = () => new Promise((resolve) => {
            const url = `${worker}/?user=${encodeURIComponent(user)}&pages=${encodeURIComponent(pages)}`;
            network.silent(url, function (data) {
                const items = normalizeWorkerItems(data);
                // уведомим
                onProgress && onProgress(items.length, items.length);
                resolve(items);
            }, function () {
                resolve(null);
            }, false, { type: 'get' });
        });

        const merged = await tryMerged();
        if (merged) return merged;

        // Фолбэк: постранично
        return new Promise((resolve) => {
            let page = 1;
            let acc = [];
            let total = 0;
            let processed = 0;

            const next = () => {
                if (page > pages) {
                    resolve(acc);
                    return;
                }
                fetchLetterboxdBatch(user, page, worker, function (_err, items) {
                    if (Array.isArray(items)) {
                        acc = acc.concat(items);
                        total += items.length;
                    }
                    processed++;
                    onProgress && onProgress(processed, pages);
                    page++;
                    next();
                });
            };
            next();
        });
    }

    // Забор деталей из TMDB
    function tmdbFetchById(id, mediaType, onDone) {
        const base = tmdbBase();
        const api_key = '4ef0d7355d9ffb5151e987764708ce96';
        const url = mediaType
            ? `${base}/${mediaType}/${id}?api_key=${api_key}&language=ru`
            : `${base}/movie/${id}?api_key=${api_key}&language=ru`;

        network.silent(url, function (data) {
            if (data && data.id) onDone(null, data);
            else onDone('empty', null);
        }, function (err) {
            onDone(err || 'error', null);
        });
    }

    function tmdbSearchByTitle(title, year, preferTV, onDone) {
        const base = tmdbBase();
        const api_key = '4ef0d7355d9ffb5151e987764708ce96';

        // Сначала попробуем multi
        const qMulti = `${base}/search/multi?query=${encodeURIComponent(title)}&api_key=${api_key}&language=ru&include_adult=false${year ? `&year=${year}` : ''}`;
        network.silent(qMulti, function (data) {
            const pick = () => {
                if (!data || !Array.isArray(data.results) || !data.results.length) return null;
                // если preferTV просили, попробуем отдать tv
                if (preferTV) {
                    const tv = data.results.find(r => r.media_type === 'tv');
                    if (tv) return { item: tv, type: 'tv' };
                }
                // иначе первый подходящий movie/tv
                const first = data.results.find(r => r.media_type === 'movie' || r.media_type === 'tv') || data.results[0];
                if (!first) return null;
                const type = first.media_type === 'tv' ? 'tv' : 'movie';
                return { item: first, type };
            };
            const chosen = pick();
            if (chosen) onDone(null, chosen.item, chosen.type);
            else onDone('not_found', null, null);
        }, function () {
            // Фолбэк: отдельные поиски
            const qMovie = `${base}/search/movie?query=${encodeURIComponent(title)}&api_key=${api_key}&language=ru${year ? `&year=${year}` : ''}`;
            network.silent(qMovie, function (md) {
                if (md && md.results && md.results[0]) onDone(null, md.results[0], 'movie');
                else {
                    const qTv = `${base}/search/tv?query=${encodeURIComponent(title)}&api_key=${api_key}&language=ru${year ? `&first_air_date_year=${year}` : ''}`;
                    network.silent(qTv, function (td) {
                        if (td && td.results && td.results[0]) onDone(null, td.results[0], 'tv');
                        else onDone('not_found', null, null);
                    }, function (err) { onDone(err || 'error', null, null); });
                }
            }, function (err) { onDone(err || 'error', null, null); });
        });
    }

    function dateReleased(item) {
        const d = item.release_date || item.first_air_date;
        if (!d) return true;
        return d <= todayISO();
    }

    // === PIPELINE: получаем воркер → приводим к TMDB карточкам → кладём в кэш ===
    function processLetterboxdToTMDB(user, pages, worker, done) {
        const existing = readJSON(S_KEYS.MOVIES, []);
        // оставим только те, что ещё в вочлисте (обновим позже)
        const keep = [];
        writeJSON(S_KEYS.MOVIES, keep);

        getLetterboxdData(user, pages, worker, function (a, b) {
            // a/b тут просто для логов прогресса
        }).then(function (items) {
            if (!items.length) {
                writeJSON(S_KEYS.MOVIES, keep);
                Lampa.Noty.show('Список Letterboxd пуст или закрыт');
                return done(null, keep);
            }

            const receivedKeySet = new Set();
            items.forEach(it => {
                const key = it.tmdb ? 'tmdb:' + it.tmdb : `t:${it.title}|y:${it.year}`;
                receivedKeySet.add(key);
            });

            // Сохраняем только актуальные из старого
            const filteredOld = existing.filter(x => {
                const key = x && x.id ? 'tmdb:' + x.id : '';
                return key && receivedKeySet.has(key);
            });

            writeJSON(S_KEYS.MOVIES, filteredOld);

            let processed = 0;
            const total = items.length;
            if (!total) {
                done(null, filteredOld);
                return;
            }

            function stepDone() {
                processed++;
                if (processed >= total) {
                    const finalArr = readJSON(S_KEYS.MOVIES, []);
                    Lampa.Noty.show('Обновление Letterboxd завершено (' + String(finalArr.length) + ')');
                    // Первый запуск: откроем компонент
                    if (Lampa.Storage.get(S_KEYS.FIRST, false) === false) {
                        Lampa.Storage.set(S_KEYS.FIRST, true);
                        Lampa.Activity.push({
                            url: '',
                            title: 'Letterboxd',
                            component: 'letterboxd',
                            page: 1
                        });
                    }
                    done(null, finalArr);
                }
            }

            items.forEach(function (it) {
                // если уже есть карточка в кэше по tmdb id — пропускаем запрос
                if (it.tmdb) {
                    const have = readJSON(S_KEYS.MOVIES, []).some(m => String(m.id) === String(it.tmdb));
                    if (have) return stepDone();
                }

                if (it.tmdb) {
                    tmdbFetchById(it.tmdb, it.media_type, function (_e, tmdbItem) {
                        if (tmdbItem) {
                            if (dateReleased(tmdbItem)) {
                                const cur = readJSON(S_KEYS.MOVIES, []);
                                cur.unshift(tmdbItem);
                                writeJSON(S_KEYS.MOVIES, cur);
                            }
                        }
                        stepDone();
                    });
                } else {
                    // нет tmdb id — ищем по названию
                    tmdbSearchByTitle(it.title, it.year, it.media_type === 'tv', function (_e, found, type) {
                        if (found) {
                            if (dateReleased(found)) {
                                const cur = readJSON(S_KEYS.MOVIES, []);
                                cur.unshift(found);
                                writeJSON(S_KEYS.MOVIES, cur);
                            }
                        }
                        stepDone();
                    });
                }
            });
        });
    }

    // === API ДЛЯ КОМПОНЕНТА ===
    function full(params, oncomplete, _onerror) {
        const user   = Lampa.Storage.get(S_KEYS.USER, DEFAULTS.user);
        const pages  = Number(Lampa.Storage.get(S_KEYS.PAGES, DEFAULTS.pages)) || 1;
        const worker = Lampa.Storage.get(S_KEYS.WORKER, DEFAULTS.worker);

        if (!user) {
            Lampa.Noty.show('Укажите имя пользователя Letterboxd в настройках');
            oncomplete({ secuses: true, page: 1, results: [] });
            return;
        }

        processLetterboxdToTMDB(user, pages, worker, function () {
            // отдаём что есть в кэше
            oncomplete({
                secuses: true,
                page: 1,
                results: readJSON(S_KEYS.MOVIES, [])
            });
        });
    }

    function clear() { network.clear(); }

    var Api = { full, clear };

    // === COMPONENT ===
    function component(object) {
        var comp = new Lampa.InteractionCategory(object);
        comp.create = function () {
            Api.full(object, this.build.bind(this), this.empty.bind(this));
        };
        comp.nextPageReuest = function (object, resolve, reject) {
            Api.full(object, resolve.bind(comp), reject.bind(comp));
        };
        return comp;
    }

    // === SETTINGS & MENU ===
    function startPlugin() {
        var manifest = {
            type: 'video',
            version: '0.4.0',
            name: 'Letterboxd',
            description: 'Watchlist из Letterboxd',
            component: 'letterboxd'
        };

        Lampa.Manifest.plugins = manifest;
        Lampa.Component.add('letterboxd', component);

        function addMenu() {
            var button = $(
                `<li class="menu__item selector">
                    <div class="menu__ico">
                        <svg viewBox="0 0 24 24" width="239" height="239" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                          <path d="M4 4h16v2H4zM4 9h16v2H4zM4 14h16v2H4zM4 19h10v2H4z" />
                        </svg>
                    </div>
                    <div class="menu__text">${manifest.name}</div>
                </li>`
            );
            button.on('hover:enter', function () {
                if (!Lampa.Storage.get(S_KEYS.USER, '')) {
                    Lampa.Noty.show('Сначала задайте имя пользователя в настройках');
                    Lampa.Controller.toggle('settings_component');
                }
                Lampa.Activity.push({
                    url: '',
                    title: manifest.name,
                    component: 'letterboxd',
                    page: 1
                });
            });
            $('.menu .menu__list').eq(0).append(button);
        }

        if (window.appready) addMenu();
        else {
            Lampa.Listener.follow('app', function (e) {
                if (e.type == 'ready') addMenu();
            });
        }

        // SETTINGS
        if (!window.lampa_settings.letterboxd) {
            Lampa.SettingsApi.addComponent({
                component: 'letterboxd',
                icon: '<svg viewBox="0 0 24 24" width="239" height="239" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M4 4h16v2H4zM4 9h16v2H4zM4 14h16v2H4zM4 19h10v2H4z"/></svg>',
                name: 'Letterboxd'
            });
        }

        Lampa.SettingsApi.addParam({
            component: 'letterboxd',
            param: { type: 'title' },
            field: { name: 'Параметры' }
        });

        // Имя пользователя
        Lampa.SettingsApi.addParam({
            component: 'letterboxd',
            param: {
                name: S_KEYS.USER,
                type: 'input',
                default: Lampa.Storage.get(S_KEYS.USER, DEFAULTS.user)
            },
            field: {
                name: 'Имя пользователя',
                description: 'Публичный username в Letterboxd'
            },
            onChange: (v) => {
                Lampa.Storage.set(S_KEYS.USER, String(v || '').trim());
            }
        });

        // Кол-во страниц воркера
        Lampa.SettingsApi.addParam({
            component: 'letterboxd',
            param: {
                name: S_KEYS.PAGES,
                type: 'select',
                values: [1, 2, 3, 4, 5],
                default: Number(Lampa.Storage.get(S_KEYS.PAGES, DEFAULTS.pages)) || 1
            },
            field: {
                name: 'Страниц',
                description: 'Сколько страниц тащить из воркера'
            },
            onChange: (v) => {
                Lampa.Storage.set(S_KEYS.PAGES, Number(v) || 1);
            }
        });

        // URL воркера
        Lampa.SettingsApi.addParam({
            component: 'letterboxd',
            param: {
                name: S_KEYS.WORKER,
                type: 'input',
                default: Lampa.Storage.get(S_KEYS.WORKER, DEFAULTS.worker)
            },
            field: {
                name: 'URL воркера',
                description: 'Cloudflare Worker, отдающий JSON watchlist'
            },
            onChange: (v) => {
                Lampa.Storage.set(S_KEYS.WORKER, String(v || '').trim() || DEFAULTS.worker);
            }
        });

        // Обновить сейчас
        Lampa.SettingsApi.addParam({
            component: 'letterboxd',
            param: { type: 'button', name: 'letterboxd_refresh' },
            field: {
                name: 'Обновить список',
                description: 'Забрать свежий watchlist'
            },
            onChange: () => {
                const user   = Lampa.Storage.get(S_KEYS.USER, DEFAULTS.user);
                const pages  = Number(Lampa.Storage.get(S_KEYS.PAGES, DEFAULTS.pages)) || 1;
                const worker = Lampa.Storage.get(S_KEYS.WORKER, DEFAULTS.worker);
                if (!user) {
                    Lampa.Noty.show('Сначала задайте имя пользователя');
                    return;
                }
                processLetterboxdToTMDB(user, pages, worker, function () {
                    Lampa.Noty.show('Готово. Откройте раздел Letterboxd.');
                });
            }
        });

        // Очистить кэш
        Lampa.SettingsApi.addParam({
            component: 'letterboxd',
            param: { type: 'button', name: 'letterboxd_delete_cache' },
            field: {
                name: 'Очистить кэш',
                description: 'Если что-то сломалось или надо пересобрать список'
            },
            onChange: () => {
                writeJSON(S_KEYS.MOVIES, []);
                Lampa.Noty.show('Кэш Letterboxd очищен');
            }
        });
    }

    if (!window.letterboxd_ready) startPlugin();
})();
