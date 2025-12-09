(function() {
    'use strict';
    
    // Используем встроенный класс запросов Lampa (с сохранением опечатки Reguest, как в ядре)
    var network = new Lampa.Reguest();
    var STORAGE_KEY = 'lb_watchlist_cache';
    var CONFIG_KEY = 'lb_config';

    // Конфигурация по умолчанию
    var defaults = {
        user: '',
        pages: 1,
        worker: 'https://lbox-proxy.nellrun.workers.dev'
    };

    function getConfig() {
        var stored = Lampa.Storage.get(CONFIG_KEY, '{}');
        return Object.assign({}, defaults, stored);
    }

    // --- ЛОГИКА ЗАГРУЗКИ ---

    function getWatchlist() {
        var cfg = getConfig();
        if (!cfg.user) return;

        // 1. Сначала отображаем то, что есть в кэше (чтобы линия появилась мгновенно)
        var cached = Lampa.Storage.get(STORAGE_KEY, []);
        if (cached.length) {
            renderLine(cached);
        }

        // 2. Фоновое обновление данных
        console.log('Letterboxd', 'Start updating watchlist for user:', cfg.user);
        
        var allItems = [];
        var count = 0;
        var maxPages = cfg.pages || 1;

        function fetchPage(page) {
            var url = cfg.worker + '/?user=' + encodeURIComponent(cfg.user) + '&page=' + page;
            
            network.silent(url, function(data) {
                // Успех
                var items = data.items || data || [];
                if (items.length) {
                    allItems = allItems.concat(items);
                }

                count++;
                if (count >= maxPages) {
                    processData(allItems);
                } else {
                    fetchPage(count + 1);
                }
            }, function(err) {
                // Ошибка
                console.log('Letterboxd', 'Error loading page ' + page, err);
                count++;
                if (count >= maxPages && allItems.length) processData(allItems);
            });
        }

        fetchPage(1);
    }

    function processData(rawItems) {
        if (!rawItems || !rawItems.length) return;

        console.log('Letterboxd', 'Received items:', rawItems.length);

        // Нормализация данных под формат Lampa
        var cleanItems = [];
        var seen = new Set();

        rawItems.forEach(function(it) {
            var tmdb = it.tmdb_id || it.tmdb || null;
            var title = it.title || it.name;
            var year = it.year || it.release_year || '0000';
            
            // Уникальность
            var key = tmdb ? 'id_' + tmdb : 't_' + title;
            if (seen.has(key)) return;
            seen.add(key);

            // Обработка постера
            var poster = it.poster || it.poster_path || '';
            if (poster && poster.startsWith('/')) {
                poster = 'https://image.tmdb.org/t/p/w300' + poster;
            }

            var item = {
                source: 'tmdb',
                id: tmdb,
                title: title,
                original_title: title,
                release_date: year + '-01-01',
                poster_path: poster,
                vote_average: 0
            };
            
            cleanItems.push(item);
        });

        // Сохраняем в кэш
        Lampa.Storage.set(STORAGE_KEY, cleanItems);
        
        // Перерисовываем линию с новыми данными
        renderLine(cleanItems);
    }

    // --- ОТРИСОВКА ЛИНИИ НА ГЛАВНОЙ ---

    function renderLine(items) {
        // Ищем активную вкладку и контейнер скролла
        var active = $('.activity--active');
        // Если мы не на главной, ничего не делаем, данные сохранятся в кэше
        if (active.find('.head__title').text().toLowerCase() !== Lampa.Lang.translate('title_home').toLowerCase() && 
            active.attr('id') !== 'main') {
            return;
        }

        var scroll_body = active.find('.scroll__body').first();
        if (!scroll_body.length) return;

        var BLOCK_ID = 'lb-watchlist-row';
        var line_container = $('#' + BLOCK_ID);

        // Если линии нет - создаем
        if (!line_container.length) {
            var template = Lampa.Template.get('items_line', {
                title: 'Letterboxd Watchlist'
            });
            template.attr('id', BLOCK_ID);

            // Вставляем после первой линии (обычно меню или "Сейчас смотрят")
            var first_line = scroll_body.find('.items-line').eq(0);
            if (first_line.length) first_line.after(template);
            else scroll_body.append(template);

            line_container = template;
        }

        var body = line_container.find('.scroll__body');
        body.empty();

        // Рендер карточек
        items.forEach(function(item) {
            var card = new Lampa.Card(item, {
                card_small: true,
                object: item
            });
            card.create();
            body.append(card.render());
        });

        // Важно: сообщаем контроллеру, что контент изменился, чтобы обновить навигацию
        if (Lampa.Controller.enabled().name === 'content') {
            Lampa.Controller.toggle('content');
        }
    }

    // --- ИНТЕГРАЦИЯ В НАСТРОЙКИ (как в примере) ---

    function addSettings() {
        if (window.lb_settings_added) return;
        window.lb_settings_added = true;

        // Добавляем раздел в настройки
        Lampa.SettingsApi.addComponent({
            component: 'letterboxd',
            name: 'Letterboxd',
            icon: '<svg width="24px" height="24px" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>'
        });

        // Параметр: Никнейм
        Lampa.SettingsApi.addParam({
            component: 'letterboxd',
            param: {
                name: 'lb_user',
                type: 'input'
            },
            field: {
                name: 'Никнейм',
                description: 'Ваш Username на Letterboxd (публичный)'
            },
            onChange: function(value) {
                var cfg = getConfig();
                cfg.user = value;
                Lampa.Storage.set(CONFIG_KEY, cfg);
                // Очищаем кэш при смене юзера
                Lampa.Storage.set(STORAGE_KEY, []);
                // Запускаем обновление
                setTimeout(getWatchlist, 1000);
            }
        });

        // Параметр: Страницы
        Lampa.SettingsApi.addParam({
            component: 'letterboxd',
            param: {
                name: 'lb_pages',
                type: 'select',
                values: {
                    1: '1 страница',
                    2: '2 страницы',
                    3: '3 страницы',
                    5: '5 страниц'
                },
                default: 1
            },
            field: {
                name: 'Глубина загрузки',
                description: 'Сколько страниц списка загружать'
            },
            onChange: function(value) {
                var cfg = getConfig();
                cfg.pages = parseInt(value);
                Lampa.Storage.set(CONFIG_KEY, cfg);
            }
        });

        // Кнопка: Обновить
        Lampa.SettingsApi.addParam({
            component: 'letterboxd',
            param: {
                name: 'lb_refresh',
                type: 'button'
            },
            field: {
                name: 'Обновить список',
                description: 'Принудительно загрузить данные'
            },
            onChange: function() {
                Lampa.Storage.set(STORAGE_KEY, []); // сброс кэша
                getWatchlist();
                Lampa.Noty.show('Загрузка запущена...');
            }
        });
        
        // Принудительно выставляем значения из конфига в поля настроек
        var currentCfg = getConfig();
        Lampa.Storage.set('lb_user', currentCfg.user); 
        Lampa.Storage.set('lb_pages', currentCfg.pages);
    }

    // --- ЗАПУСК ---

    function startPlugin() {
        window.plugin_lb_ready = true;
        
        // 1. Добавляем настройки
        addSettings();

        // 2. Ловим событие перехода на главную
        Lampa.Listener.follow('activity', function(e) {
            if (e.type === 'active' && e.component === 'main') {
                // Небольшая задержка, чтобы DOM построился
                setTimeout(getWatchlist, 100);
            }
        });

        // 3. Если плагин загрузился уже на главной - запускаем сразу
        if (Lampa.Activity.active().component === 'main') {
            getWatchlist();
        }
    }

    if (!window.plugin_lb_ready) {
        // Ждем готовности приложения, как в примере Кинопоиска
        if (window.appready) startPlugin();
        else {
            Lampa.Listener.follow('app', function(e) {
                if (e.type == 'ready') startPlugin();
            });
        }
    }
})();
