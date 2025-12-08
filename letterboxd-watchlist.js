(function () {
    'use strict';

    // --- КОНФИГУРАЦИЯ ---
    const PLUGIN_NAME = 'Letterboxd Watchlist';
    const BLOCK_ID = 'lb-watchlist-block-v8';
    const STORAGE_KEY = 'lb_settings_v8';
    
    // --- ХЕЛПЕРЫ ---
    const Settings = {
        get: () => Lampa.Storage.get(STORAGE_KEY, '{}'),
        set: (v) => Lampa.Storage.set(STORAGE_KEY, v)
    };

    // --- ОСНОВНАЯ ЛОГИКА ---
    function startPlugin() {
        // Проверка на дубликаты
        if (window.lb_plugin_v8_inited) return;
        window.lb_plugin_v8_inited = true;

        // 1. Уведомление о старте (чтобы вы поняли, что плагин вообще загрузился)
        Lampa.Noty.show('Letterboxd Plugin: Loaded');
        console.log('[LB] Plugin started');

        // 2. Запускаем "монитор", который следит за наличием линии на главной
        // Это самый надежный способ на ТВ, чтобы не зависеть от событий
        setInterval(monitor, 2000);
        
        // Первая проверка сразу
        monitor();
    }

    function monitor() {
        // Проверяем, активна ли сейчас "Главная" (component: 'main')
        const active = Lampa.Activity.active();
        if (!active || active.component !== 'main') return;

        // Проверяем, есть ли уже наша линия в DOM
        // Используем Lampa.jQuery для надежности
        const $ = Lampa.jQuery;
        if ($('#' + BLOCK_ID).length > 0) return;

        // Если главной нет, или линии нет - пытаемся внедрить
        inject($);
    }

    function inject($) {
        console.log('[LB] Trying to inject...');
        
        // Ищем контейнер скролла на активной странице
        // В Lampa 3+ это обычно .activity--active .scroll__body
        const scrollBody = $('.activity--active .scroll__body').first();

        if (!scrollBody.length) {
            console.log('[LB] Scroll body not found');
            return;
        }

        // Создаем контейнер линии
        // Важно: используем стандартный темплейт Lampa
        const line_outer = Lampa.Template.get('items_line', { title: 'Letterboxd Watchlist' });
        line_outer.attr('id', BLOCK_ID);

        // Вставляем линию. 
        // Логика: Вставить ПОСЛЕ первой найденной линии (обычно это "Сейчас смотрят" или меню)
        const firstLine = scrollBody.find('.items-line').first();
        if (firstLine.length) {
            firstLine.after(line_outer);
        } else {
            scrollBody.append(line_outer);
        }

        // Рендерим содержимое
        renderContent(line_outer.find('.scroll__body'), $);
    }

    function renderContent(container, $) {
        // Сразу задаем высоту, чтобы фокус не пролетал мимо
        container.css({ 'min-height': '180px' }); 
        container.empty();

        const cfg = Settings.get();

        // 1. Если нет настроек - кнопка настройки
        if (!cfg.user) {
            createButton(container, 'settings', 'Настроить', 'Введите никнейм');
            return;
        }

        // 2. Кнопка загрузки
        createButton(container, 'broadcast', 'Загрузка...', 'Подождите');

        // 3. Запрос данных
        loadData(cfg).then(items => {
            // Если контейнера уже нет (ушли со страницы) - стоп
            if (!container.closest('body').length) return;
            
            container.empty();

            if (!items.length) {
                createButton(container, 'empty', 'Пусто', 'Список пуст');
                return;
            }

            // Рендер фильмов
            items.forEach(item => {
                const card = new Lampa.Card(item, {
                    card_small: true,
                    object: item
                });
                card.create();
                
                // Долгое нажатие - настройки
                card.render().on('contextmenu', (e) => {
                    e.preventDefault();
                    openSettings();
                });

                container.append(card.render());
            });

            // Обновляем контроллер, чтобы он увидел новые карточки
            Lampa.Controller.toggle('content');

        }).catch(err => {
            console.error('[LB]', err);
            container.empty();
            createButton(container, 'error', 'Ошибка', 'Нажмите для повтора');
        });
    }

    // Создание системной кнопки (Настройки/Ошибка) через Lampa.Card
    function createButton(container, type, title, subtitle) {
        const item = { id: -1, title: title, release_date: subtitle };
        const card = new Lampa.Card(item, { card_small: true });
        card.create();

        // Кастомизация вида
        const view = card.render().find('.card__view');
        view.css({ background: '#222', display: 'flex', alignItems: 'center', justifyContent: 'center' });
        
        let icon = '';
        if (type === 'settings') icon = '<svg style="width:40px;height:40px;fill:white;opacity:0.5" viewBox="0 0 24 24"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>';
        if (type === 'broadcast') icon = '<svg style="width:40px;height:40px;fill:white;opacity:0.5" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/></svg>';
        if (type === 'error') icon = '<svg style="width:40px;height:40px;fill:#f55;opacity:0.8" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>';
        
        view.html(icon || '');

        card.render().on('click', () => {
            if (type === 'settings') openSettings();
            else {
                const $ = Lampa.jQuery;
                renderContent(container, $);
            }
        });

        container.append(card.render());
    }

    async function loadData(cfg) {
        const worker = 'https://lbox-proxy.nellrun.workers.dev';
        const u = encodeURIComponent(cfg.user);
        let items = [];

        // Простой фетч
        const fetchPage = async (p) => {
            const r = await fetch(`${worker}/?user=${u}&page=${p}`);
            return r.json();
        };

        try {
            if ((cfg.pages || 1) > 1) {
                const reqs = [];
                for(let i=1; i<=(cfg.pages||1); i++) reqs.push(fetchPage(i).catch(()=>({})));
                const res = await Promise.all(reqs);
                res.forEach(x => { if(x.items) items.push(...x.items); });
            } else {
                const r = await fetchPage(1);
                items = r.items || [];
            }
        } catch(e) { throw e; }

        // Нормализация для Lampa
        return items.map(it => {
            let poster = it.poster || it.poster_path;
            if(poster && poster.startsWith('/')) poster = 'https://image.tmdb.org/t/p/w300' + poster;
            
            return {
                source: 'tmdb',
                id: it.tmdb_id || it.tmdb,
                title: it.title || it.name,
                original_title: it.title,
                release_date: (it.year || '0000') + '-01-01',
                poster_path: poster,
                vote_average: 0
            };
        });
    }

    function openSettings() {
        const cfg = Settings.get();
        Lampa.Input.edit({
            title: 'Letterboxd Никнейм',
            value: cfg.user,
            free: true,
            nosave: true
        }, (val) => {
            Settings.set({ ...cfg, user: val });
            Lampa.Noty.show('Сохранено. Перезагрузка списка...');
            
            // Триггер на обновление
            const $ = Lampa.jQuery;
            const container = $('#' + BLOCK_ID + ' .scroll__body');
            if(container.length) renderContent(container, $);
        });
    }

    // --- ИНИЦИАЛИЗАЦИЯ ---
    if (window.Lampa && window.Lampa.Listener && window.Lampa.jQuery) {
        startPlugin();
    } else {
        // Ожидание загрузки ядра
        const t = setInterval(() => {
            if (window.Lampa && window.Lampa.Listener && window.Lampa.jQuery) {
                clearInterval(t);
                startPlugin();
            }
        }, 200);
    }

})();
