(function () {
    'use strict';

    // ID для сохранения настроек и идентификации линии
    const STORAGE_KEY = 'lb_watchlist_cfg_native';
    const BLOCK_ID = 'lb-native-line';
    
    // Настройки по умолчанию
    const DEFAULTS = {
        user: '',
        pages: 1,
        worker: 'https://lbox-proxy.nellrun.workers.dev'
    };

    // Хелпер для работы с настройками
    const Settings = {
        get: () => Object.assign({}, DEFAULTS, Lampa.Storage.get(STORAGE_KEY, '{}')),
        set: (data) => Lampa.Storage.set(STORAGE_KEY, data)
    };

    // --- Основной класс плагина ---
    function LBPlugin() {
        let component = null;
        let line = null;

        // Точка входа: запускаем только когда Lampa готова
        this.init = function () {
            if (window.lb_plugin_inited) return;
            window.lb_plugin_inited = true;

            // Слушаем смену экранов (Activities)
            Lampa.Listener.follow('activity', (e) => {
                if (e.type === 'active' && e.component === 'main') {
                    component = e.object; // Ссылка на объект главной страницы
                    this.injectLine();
                }
            });

            // На случай если плагин загрузился после старта (инъекция на лету)
            if (Lampa.Activity.active() && Lampa.Activity.active().component === 'main') {
                component = Lampa.Activity.active().object;
                this.injectLine();
            }
        };

        this.injectLine = function () {
            // Если линия уже есть в DOM, не дублируем
            if ($('#' + BLOCK_ID).length) return;

            // Находим контейнер главной страницы
            const scroll_body = component.render().find('.scroll__body').first();
            if (!scroll_body.length) return;

            // Создаем структуру линии через встроенный шаблон Lampa
            // Это создает div с классом items-line и правильной структурой
            const body = Lampa.Template.get('items_line', {
                title: 'Letterboxd Watchlist'
            });
            
            body.attr('id', BLOCK_ID);
            
            // Ссылка на контейнер карточек внутри линии
            line = body.find('.scroll__body');
            
            // Чтобы фокус не пролетал, задаем минимальную высоту, пока грузимся
            line.css('min-height', '19em'); 

            // Вставляем линию после "Меню" или первой линии, но до подвала
            // Обычно в Lampa вставляют в конец scroll_body
            scroll_body.append(body);

            this.loadContent();
        };

        this.loadContent = function () {
            const cfg = Settings.get();

            // 1. Если нет юзера - показываем карточку настройки
            if (!cfg.user) {
                this.renderActionCard('settings', 'Настроить', 'Укажите ник Letterboxd');
                return;
            }

            // 2. Показываем карточку загрузки (чтобы фокус мог встать на неё)
            this.renderActionCard('broadcast', 'Загрузка...', 'Получение списка');

            // 3. Грузим данные
            this.fetchData(cfg)
                .then(items => {
                    line.empty(); // Очищаем "Загрузку"
                    
                    if (!items || items.length === 0) {
                        this.renderActionCard('empty', 'Пусто', 'Список пуст или закрыт');
                        return;
                    }

                    // Рендерим фильмы
                    items.forEach(item => {
                        // Создаем нативную карточку Lampa
                        // Lampa.Card сама обработает клик, longpress и фокус
                        const card = new Lampa.Card(item, {
                            card_small: true, // или false, если нужны большие
                            object: item      // передаем объект для Context Menu
                        });

                        card.create(); // Генерирует DOM

                        // Добавляем обработчик долгого нажатия для настроек
                        card.render().on('contextmenu', (e) => {
                            e.preventDefault();
                            this.openSettings();
                        });

                        line.append(card.render());
                    });
                    
                    // Сообщаем контроллеру Lampa, что контент изменился
                    if(Lampa.Controller.enabled().name === 'content') {
                        // Это помогает пересчитать навигацию
                        Lampa.Controller.toggle('content'); 
                    }
                })
                .catch(err => {
                    console.error('LB Error', err);
                    this.renderActionCard('error', 'Ошибка', 'Не удалось загрузить');
                });
        };

        // Загрузка данных с воркера
        this.fetchData = async function (cfg) {
            let allItems = [];
            const worker = cfg.worker || DEFAULTS.worker;
            
            // Функция-хелпер для fetch
            const getPage = async (p) => {
                const url = `${worker}/?user=${encodeURIComponent(cfg.user)}&page=${p}`;
                const res = await fetch(url);
                if (!res.ok) throw new Error('Network error');
                return res.json();
            };

            // Логика страниц
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

            // Превращаем JSON Letterboxd в объект, понятный Lampa (TMDB format)
            return this.normalize(allItems);
        };

        // Маппинг данных в формат Lampa
        this.normalize = function (items) {
            const result = [];
            const seen = new Set();

            items.forEach(it => {
                // Пытаемся найти ID
                const tmdb_id = it.tmdb_id || it.tmdbId || it.tmdb;
                const title = it.title || it.name;
                const year = it.year || it.release_year || '0000';
                
                // Уникальность
                const key = tmdb_id ? 'id_'+tmdb_id : 't_'+title;
                if(seen.has(key)) return;
                seen.add(key);

                // Формируем объект Lampa Movie
                // Важно: 'source: tmdb' заставляет Лампу саму искать ссылки и описание
                const obj = {
                    id: tmdb_id,
                    title: title,
                    original_title: title, // Фолбек
                    release_date: year + '-01-01',
                    poster_path: it.poster || it.poster_path,
                    vote_average: 0, // Можно парсить рейтинг если есть
                    source: 'tmdb',  // Говорим Лампе, что это TMDB контент
                    project: 'letterboxd' // Метка
                };
                
                // Если постера нет или он кривой, фиксим
                if(obj.poster_path && !obj.poster_path.startsWith('http') && !obj.poster_path.startsWith('/')) {
                     // если там base64 или что-то странное, пропускаем
                } else if (obj.poster_path && obj.poster_path.startsWith('/')) {
                    obj.poster_path = 'https://image.tmdb.org/t/p/w300' + obj.poster_path;
                }
                
                // Если нет TMDB ID, карточка будет "глупой" (только поиск), 
                // если есть - она откроет полную информацию.
                if(!tmdb_id) obj.source = ''; // Снимаем флаг источника, чтобы открылся поиск

                result.push(obj);
            });
            return result;
        };

        // Рендер служебных карточек (Настройки, Ошибка)
        this.renderActionCard = function (action, title, desc) {
            line.empty();
            
            // Создаем фейковый объект фильма для карточки
            const item = {
                title: title,
                release_date: desc,
                poster_path: '', // Нет постера
                id: -1
            };

            const card = new Lampa.Card(item, {
                card_small: true
            });
            card.create();

            // Переопределяем внешний вид под "кнопку"
            const img_div = card.render().find('.card__view');
            img_div.css({
                background: '#2b2d31',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
            });
            
            // Иконка
            let icon = '';
            if(action === 'settings') icon = '<svg width="40" height="40" viewBox="0 0 24 24" fill="white" fill-opacity="0.5"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>';
            else if(action === 'broadcast') icon = '<svg width="40" height="40" viewBox="0 0 24 24" fill="white" fill-opacity="0.5"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/></svg>'; // play-ish
            else icon = '<svg width="40" height="40" viewBox="0 0 24 24" fill="white" fill-opacity="0.5"><path d="M11 15h2v2h-2zm0-8h2v6h-2zm1-5C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/></svg>';

            img_div.html(icon);

            // Клик по служебной карточке
            card.render().on('click', () => {
                if (action === 'settings') this.openSettings();
                else this.loadContent(); // ретрай
            });

            line.append(card.render());
        };

        // Окно настроек (используем нативные инпуты Lampa если возможно, но проще свой модал)
        this.openSettings = function () {
            const cfg = Settings.get();
            
            // Используем Lampa.Interaction.input (нативная клавиатура) для ввода ника?
            // Это решит проблему с вводом на ТВ и ПК.
            
            Lampa.Input.edit({
                title: 'Letterboxd Username',
                value: cfg.user,
                free: true,
                nosave: true
            }, (new_user) => {
                // Сохраняем юзера
                Settings.set({ ...cfg, user: new_user });
                
                // Спрашиваем количество страниц
                Lampa.Select.show({
                    title: 'Количество страниц',
                    items: [
                        { title: '1 страница', value: 1 },
                        { title: '2 страницы', value: 2 },
                        { title: '3 страницы', value: 3 },
                        { title: '5 страниц', value: 5 }
                    ],
                    onSelect: (a) => {
                        Settings.set({ ...Settings.get(), pages: a.value });
                        Lampa.Controller.toggle('content'); // возвращаем фокус
                        this.loadContent(); // Перезагружаем линию
                    },
                    onBack: () => {
                        Lampa.Controller.toggle('content');
                    }
                });
            });
        };
    }

    // Запуск
    if (window.Lampa && window.Lampa.Listener) {
        new LBPlugin().init();
    } else {
        // Ждем загрузки Lampa
        let waiter = setInterval(() => {
            if (window.Lampa && window.Lampa.Listener) {
                clearInterval(waiter);
                new LBPlugin().init();
            }
        }, 300);
    }

})();
