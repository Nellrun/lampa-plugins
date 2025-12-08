(function () {
    'use strict';

    // --- НАСТРОЙКИ ---
    const STORAGE_KEY = 'lb_watchlist_native_v7'; // Новый ключ, настройки придется ввести заново
    const BLOCK_ID = 'lb-native-line-v7';
    const DEFAULTS = {
        user: '',
        pages: 1,
        worker: 'https://lbox-proxy.nellrun.workers.dev'
    };

    // --- ХЕЛПЕРЫ ---
    // Безопасный доступ к jQuery внутри Lampa
    const $ = (selector) => {
        if (window.Lampa && window.Lampa.$) return window.Lampa.$(selector);
        if (window.jQuery) return window.jQuery(selector);
        return window.$(selector); // fallback
    };

    const Settings = {
        get: () => Object.assign({}, DEFAULTS, Lampa.Storage.get(STORAGE_KEY, '{}')),
        set: (data) => Lampa.Storage.set(STORAGE_KEY, data)
    };

    const log = (msg, err) => {
        console.log('[LB Plugin]', msg, err || '');
    };

    // --- КЛАСС ПЛАГИНА ---
    function LBPlugin() {
        let line = null;

        this.init = function () {
            log('Inited');
            
            // 1. Слушаем переходы по страницам
            Lampa.Listener.follow('activity', (e) => {
                if (e.type === 'active' && e.component === 'main') {
                    log('Activity changed to MAIN');
                    setTimeout(() => this.inject(), 100);
                }
            });

            // 2. Слушаем событие готовности приложения (если плагин грузится на старте)
            Lampa.Listener.follow('app', (e) => {
                if (e.type === 'ready') setTimeout(() => this.check(), 200);
            });

            // 3. Проверка прямо сейчас (для горячей замены кода)
            this.check();
        };

        this.check = function() {
            if (Lampa.Activity.active() && Lampa.Activity.active().component === 'main') {
                this.inject();
            }
        };

        // Вставка линии в DOM
        this.inject = function () {
            // Если линия уже есть, не трогаем
            if ($('#' + BLOCK_ID).length) return;

            // Ищем контейнер скролла на АКТИВНОЙ вкладке
            const active_act = $('.activity--active');
            const scroll_body = active_act.find('.scroll__body').first();

            if (!scroll_body.length) {
                log('Scroll body not found');
                return;
            }

            log('Injecting line...');

            // Создаем структуру через шаблон Lampa
            const template = Lampa.Template.get('items_line', {
                title: 'Letterboxd Watchlist'
            });
            
            template.attr('id', BLOCK_ID);
            
            // Находим место вставки (после первой линии или в конец)
            const first_line = scroll_body.find('.items-line').first();
            if(first_line.length) {
                first_line.after(template);
            } else {
                scroll_body.append(template);
            }

            // Сохраняем ссылку на контейнер для карточек
            line = template.find('.scroll__body');
            
            // Важно: задаем мин. высоту, чтобы фокус не перепрыгивал, пока пусто
            line.css({
                'min-height': '19em',
                'display': 'flex' // фикс для некоторых скинов
            });

            this.loadContent();
        };

        this.loadContent = function () {
            const cfg = Settings.get();
            line.empty();

            if (!cfg.user) {
                this.renderButton('settings', 'Настроить', 'Укажите никнейм');
                return;
            }

            this.renderButton('broadcast', 'Загрузка...', 'Получение списка');

            this.fetchData(cfg)
                .then(items => {
                    // Если после загрузки пользователь уже ушел с главной - не рендерим
                    if (!$('#' + BLOCK_ID).length) return;

                    line.empty();

                    if (!items || !items.length) {
                        this.renderButton('empty', 'Пусто', 'Список пуст или ошибка');
                        return;
                    }

                    items.forEach(item => {
                        // Создаем нативную карточку
                        const card = new Lampa.Card(item, {
                            card_small: true,
                            object: item
                        });
                        
                        card.create();

                        // Добавляем Context Menu (долгое нажатие)
                        card.render().on('contextmenu', (e) => {
                            e.preventDefault();
                            this.openSettings();
                        });

                        line.append(card.render());
                    });

                    // Сообщаем контроллеру об изменениях
                    if(Lampa.Controller.enabled().name === 'content') {
                        Lampa.Controller.toggle('content');
                    }
                })
                .catch(e => {
                    log('Error loading', e);
                    if ($('#' + BLOCK_ID).length) {
                        line.empty();
                        this.renderButton('error', 'Ошибка', 'Нажмите для повтора');
                    }
                });
        };

        // Загрузка данных
        this.fetchData = async function (cfg) {
            let allItems = [];
            const worker = cfg.worker || DEFAULTS.worker;
            
            const getPage = async (p) => {
                const url = `${worker}/?user=${encodeURIComponent(cfg.user)}&page=${p}`;
                const res = await fetch(url);
                if (!res.ok) throw new Error('Network error');
                return res.json();
            };

            try {
                if (cfg.pages > 1) {
                    const promises = [];
                    for (let i = 1; i <= cfg.pages; i++) promises.push(getPage(i).catch(()=>({items:[]})));
                    const results = await Promise.all(promises);
                    results.forEach(r => {
                        const list = r.items || r || [];
                        if(Array.isArray(list)) allItems.push(...list);
                    });
                } else {
                    const res = await getPage(1);
                    allItems = res.items || res || [];
                }
            } catch (e) {
                log('Fetch error', e);
                throw e;
            }

            return this.normalize(allItems);
        };

        // Приведение данных к формату Lampa
        this.normalize = function (items) {
            const result = [];
            const seen = new Set();
            items.forEach(it => {
                const tmdb_id = it.tmdb_id || it.tmdbId || it.tmdb;
                const title = it.title || it.name;
                const year = it.year || it.release_year || '0000';
                
                const key = tmdb_id ? 'id_'+tmdb_id : 't_'+title;
                if(seen.has(key)) return;
                seen.add(key);

                result.push({
                    id: tmdb_id,
                    title: title,
                    original_title: title,
                    release_date: year + '-01-01',
                    poster_path: (it.poster || it.poster_path || '').replace(/^\//, 'https://image.tmdb.org/t/p/w300/'),
                    vote_average: 0,
                    source: 'tmdb', // Активирует поиск источников
                    project: 'letterboxd'
                });
            });
            return result;
        };

        // Рендер служебной кнопки (через нативный Card, чтобы ловился фокус)
        this.renderButton = function (type, title, subtitle) {
            const item = { title: title, release_date: subtitle, id: -1 };
            const card = new Lampa.Card(item, { card_small: true });
            card.create();

            const view = card.render().find('.card__view');
            view.css({
                background: '#2a2d31', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center'
            });

            // Иконки SVG
            const icons = {
                settings: '<svg width="40" height="40" viewBox="0 0 24 24" fill="white" style="opacity:0.5"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>',
                broadcast: '<svg width="40" height="40" viewBox="0 0 24 24" fill="white" style="opacity:0.5"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/></svg>',
                error: '<svg width="40" height="40" viewBox="0 0 24 24" fill="#ff6b6b" style="opacity:0.8"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>',
                empty: '<svg width="40" height="40" viewBox="0 0 24 24" fill="white" style="opacity:0.5"><path d="M14 6l-3.75 5 2.85 3.8-1.6 1.2C9.81 13.8 9 10.2 9 6h5zm-2 14c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z"/></svg>'
            };
            
            view.html(icons[type] || icons.settings);

            // Обработчик клика
            card.render().on('click', () => {
                if (type === 'settings') this.openSettings();
                else this.loadContent();
            });

            line.append(card.render());
        };

        // --- НАСТРОЙКИ (Нативные Lampa) ---
        this.openSettings = function () {
            const cfg = Settings.get();
            
            // 1. Ввод ника через нативную клавиатуру
            Lampa.Input.edit({
                title: 'Letterboxd Username',
                value: cfg.user,
                free: true,
                nosave: true
            }, (new_user) => {
                const new_cfg = { ...cfg, user: new_user };
                Settings.set(new_cfg);
                
                // 2. Выбор страниц
                Lampa.Select.show({
                    title: 'Сколько страниц грузить?',
                    items: [
                        { title: '1 страница', value: 1 },
                        { title: '2 страницы', value: 2 },
                        { title: '3 страницы', value: 3 },
                        { title: '5 страниц', value: 5 }
                    ],
                    onSelect: (a) => {
                        Settings.set({ ...new_cfg, pages: a.value });
                        this.loadContent();
                        Lampa.Controller.toggle('content');
                    },
                    onBack: () => Lampa.Controller.toggle('content')
                });
            });
        };
    }

    // --- ЗАПУСК ---
    // Пытаемся запустить, когда Lampa готова или если уже загружена
    const start = () => {
        if (window.lb_plugin_running) return;
        window.lb_plugin_running = true;
        new LBPlugin().init();
    };

    if (window.Lampa && window.Lampa.Listener && window.Lampa.Card) {
        start();
    } else {
        // Ждем загрузки ядра (до 5 секунд)
        let tries = 0;
        const timer = setInterval(() => {
            if (window.Lampa && window.Lampa.Listener && window.Lampa.Card) {
                clearInterval(timer);
                start();
            }
            if (++tries > 50) clearInterval(timer); // give up
        }, 100);
    }

})();
