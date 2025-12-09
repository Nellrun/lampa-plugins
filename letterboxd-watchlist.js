(function () {
    'use strict';

    // --- CONFIG ---
    var STORAGE_KEY = 'lb_watchlist_v10';
    var CONFIG_KEY = 'lb_config_v10';
    var network = new Lampa.Reguest();

    var defaults = {
        user: '',
        pages: 1,
        worker: 'https://lbox-proxy.nellrun.workers.dev'
    };

    function getConfig() {
        return Object.assign({}, defaults, Lampa.Storage.get(CONFIG_KEY, '{}'));
    }

    function setConfig(newConf) {
        Lampa.Storage.set(CONFIG_KEY, newConf);
    }

    // --- LOGIC ---

    // Основная функция загрузки
    function loadData(callback_success, callback_error) {
        var cfg = getConfig();
        if (!cfg.user) {
            if (callback_error) callback_error({ type: 'empty', msg: 'Никнейм не указан' });
            return;
        }

        var allItems = [];
        var count = 0;
        var maxPages = parseInt(cfg.pages) || 1;

        function fetchPage(p) {
            var url = cfg.worker + '/?user=' + encodeURIComponent(cfg.user) + '&page=' + p;
            network.silent(url, function (data) {
                var items = data.items || data || [];
                if (items.length) allItems = allItems.concat(items);

                count++;
                if (count >= maxPages) finish();
                else fetchPage(count + 1);
            }, function (a, c) {
                // Даже если ошибка, пробуем следующую страницу
                count++;
                if (count >= maxPages) finish();
                else fetchPage(count + 1);
            });
        }

        function finish() {
            if (!allItems.length) {
                if (callback_error) callback_error({ type: 'empty', msg: 'Список пуст или ошибка сети' });
                return;
            }
            // Нормализация
            var clean = normalize(allItems);
            // Кэшируем
            Lampa.Storage.set(STORAGE_KEY, clean);
            if (callback_success) callback_success(clean);
        }

        fetchPage(1);
    }

    function normalize(items) {
        var result = [];
        var seen = {};
        
        items.forEach(function (it) {
            var tmdb = it.tmdb_id || it.tmdb;
            var title = it.title || it.name;
            var year = it.year || it.release_year || '0000';
            var key = tmdb ? 'id_' + tmdb : 't_' + title;

            if (seen[key]) return;
            seen[key] = true;

            var poster = it.poster || it.poster_path || '';
            if (poster && poster.indexOf('/') === 0) poster = 'https://image.tmdb.org/t/p/w300' + poster;

            result.push({
                source: 'tmdb',
                id: tmdb,
                title: title,
                original_title: title,
                release_date: year + '-01-01',
                poster_path: poster,
                vote_average: 0
            });
        });
        return result;
    }

    // --- HOME PAGE INJECTION ---
    
    function injectRow() {
        // Проверяем, на главной ли мы
        var active = Lampa.Activity.active();
        if (!active || active.component !== 'main') return;

        // Ищем контейнер скролла
        var scroll_body = $('.activity--active .scroll__body');
        if (!scroll_body.length) return;

        var ID = 'lb-row-home';
        
        // Если строка уже есть - обновляем контент внутри, если нужно
        if ($('#' + ID).length) return;

        // Создаем контейнер линии через Template (это важно для TV навигации)
        var line = Lampa.Template.get('items_line', { title: 'Letterboxd Watchlist' });
        line.attr('id', ID);

        // Вставляем после первой линии (обычно меню) или в конец
        var first = scroll_body.find('.items-line').eq(0);
        if (first.length) first.after(line);
        else scroll_body.append(line);

        // Рендер содержимого
        var body = line.find('.scroll__body');
        
        // 1. Показываем кэш СРАЗУ (чтобы не прыгало)
        var cached = Lampa.Storage.get(STORAGE_KEY, []);
        if (cached.length) {
            renderCards(body, cached);
        } else {
            // Если кэша нет - показываем заглушку, чтобы фокус не пролетал
            renderAction(body, 'broadcast', 'Загрузка...', 'Подождите');
        }

        // 2. Загружаем свежие данные
        loadData(function (items) {
            // Если мы всё еще на главной
            if ($('#' + ID).length) {
                renderCards(body, items);
            }
        }, function (err) {
            if ($('#' + ID).length && !cached.length) {
                if(err.type === 'empty') renderAction(body, 'empty', 'Пусто', 'Настройте плагин');
                else renderAction(body, 'error', 'Ошибка', 'Проверьте сеть');
            }
        });
    }

    function renderCards(container, items) {
        container.empty();
        items.forEach(function (item) {
            var card = new Lampa.Card(item, { card_small: true, object: item });
            card.create();
            container.append(card.render());
        });
        // Обновляем контроллер (фикс для навигации)
        Lampa.Controller.toggle('content');
    }

    function renderAction(container, type, title, subtitle) {
        container.empty();
        var item = { id: -1, title: title, release_date: subtitle };
        var card = new Lampa.Card(item, { card_small: true });
        card.create();
        card.render().find('.card__view').css({ background: '#333', display: 'flex', alignItems: 'center', justifyContent: 'center' }).html('<div style="opacity:0.5;font-size:2em">⚙️</div>');
        container.append(card.render());
    }

    // --- COMPONENT (Для отдельной страницы) ---
    // Это аналог того, как сделан Кинопоиск, открывается через меню
    function component(object) {
        var comp = new Lampa.InteractionCategory(object);
        comp.create = function () {
            this.activity.loader(true);
            loadData(function (items) {
                comp.build(items);
                comp.activity.loader(false);
            }, function (err) {
                comp.empty();
                comp.activity.loader(false);
            });
        };
        return comp;
    }

    // --- MENU ITEM ---
    function addMenu() {
        var item = $('<li class="menu__item selector"><div class="menu__ico"><svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2z"/></svg></div><div class="menu__text">Letterboxd</div></li>');
        item.on('hover:enter', function () {
            Lampa.Activity.push({
                url: '',
                title: 'Letterboxd',
                component: 'letterboxd',
                page: 1
            });
        });
        $('.menu .menu__list').eq(0).append(item);
    }

    // --- SETTINGS (Native) ---
    function addSettings() {
        Lampa.SettingsApi.addComponent({
            component: 'letterboxd',
            name: 'Letterboxd',
            icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 14.5c-2.49 0-4.5-2.01-4.5-4.5S9.51 7.5 12 7.5s4.5 2.01 4.5 4.5-2.01 4.5-4.5 4.5z"/></svg>'
        });

        Lampa.SettingsApi.addParam({
            component: 'letterboxd',
            param: { name: 'lb_user', type: 'input' },
            field: { name: 'Никнейм', description: 'Username на Letterboxd' },
            onChange: function (val) {
                var c = getConfig();
                c.user = val;
                setConfig(c);
                // Сброс кэша
                Lampa.Storage.set(STORAGE_KEY, []);
                Lampa.Noty.show('Сохранено. Перезагрузите главную.');
            }
        });

        Lampa.SettingsApi.addParam({
            component: 'letterboxd',
            param: { name: 'lb_pages', type: 'select', values: { 1: '1', 2: '2', 3: '3', 5: '5' }, default: 1 },
            field: { name: 'Страницы', description: 'Глубина загрузки' },
            onChange: function (val) {
                var c = getConfig();
                c.pages = val;
                setConfig(c);
            }
        });
        
        // Синхронизация полей
        var curr = getConfig();
        Lampa.Storage.set('lb_user', curr.user);
        Lampa.Storage.set('lb_pages', curr.pages);
    }

    // --- START ---
    function start() {
        if (window.lb_plugin_v10_init) return;
        window.lb_plugin_v10_init = true;

        // 1. Регистрируем компонент (для меню)
        Lampa.Component.add('letterboxd', component);

        // 2. Добавляем настройки
        addSettings();

        // 3. Добавляем пункт в меню
        addMenu();

        // 4. Следим за главной страницей (для строки)
        Lampa.Listener.follow('activity', function (e) {
            if (e.type === 'active' && e.component === 'main') {
                setTimeout(injectRow, 100);
            }
        });

        // Если стартанули уже на главной
        if (Lampa.Activity.active().component === 'main') {
            injectRow();
        }
    }

    if (window.appready) start();
    else {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') start();
        });
    }

})();
