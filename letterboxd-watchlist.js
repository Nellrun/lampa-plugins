(function() {
    'use strict';

    var network = new Lampa.Reguest();
    var PLUGIN_NAME = 'Letterboxd';
    var API_BASE_URL = 'https://lbox-proxy.nellrun.workers.dev/';

    /**
     * Преобразует данные из API Letterboxd в формат TMDB для Lampa
     */
    function transformToTMDBFormat(item) {
        return {
            id: item.tmdb_id,
            title: item.title,
            name: item.title, // для совместимости с TV
            original_title: item.title,
            original_name: item.title,
            overview: item.overview,
            poster_path: item.poster ? item.poster.replace('https://image.tmdb.org/t/p/w500', '') : null,
            backdrop_path: item.backdrop ? item.backdrop.replace('https://image.tmdb.org/t/p/w780', '') : null,
            vote_average: item.vote_average,
            release_date: item.year + '-01-01',
            first_air_date: item.year + '-01-01',
            media_type: 'movie',
            letterboxd_slug: item.slug
        };
    }

    /**
     * Получает данные watchlist из API
     */
    function fetchWatchlist(params, oncomplete, onerror) {
        var username = Lampa.Storage.get('letterboxd_username', '');
        
        if (!username) {
            Lampa.Noty.show('Укажите имя пользователя Letterboxd в настройках');
            onerror();
            return;
        }

        var page = params.page || 1;
        var url = API_BASE_URL + '?user=' + encodeURIComponent(username) + '&pages=' + page;

        console.log('Letterboxd', 'Fetching watchlist from:', url);

        network.silent(url, function(data) {
            if (data && data.items && Array.isArray(data.items)) {
                var results = data.items.map(transformToTMDBFormat);
                
                console.log('Letterboxd', 'Received ' + results.length + ' movies for user: ' + data.user);

                // Кэшируем данные
                Lampa.Storage.set('letterboxd_movies', JSON.stringify(results));
                Lampa.Storage.set('letterboxd_movies_count', data.count);

                oncomplete({
                    results: results,
                    total_pages: Math.ceil(data.count / data.items.length) || 1,
                    total_results: data.count,
                    page: page
                });
            } else {
                console.log('Letterboxd', 'Invalid response:', data);
                Lampa.Noty.show('Не удалось получить данные из Letterboxd');
                onerror();
            }
        }, function(error) {
            console.log('Letterboxd', 'API Error:', error);
            
            // Пробуем использовать кэшированные данные
            var cached = Lampa.Storage.get('letterboxd_movies', '[]');
            try {
                var cachedMovies = JSON.parse(cached);
                if (cachedMovies.length > 0) {
                    Lampa.Noty.show('Используются кэшированные данные Letterboxd');
                    oncomplete({
                        results: cachedMovies,
                        total_pages: 1,
                        total_results: cachedMovies.length,
                        page: 1
                    });
                    return;
                }
            } catch(e) {}
            
            Lampa.Noty.show('Ошибка при загрузке данных из Letterboxd');
            onerror();
        });
    }

    function clear() {
        network.clear();
    }

    var Api = {
        fetch: fetchWatchlist,
        clear: clear
    };

    /**
     * Компонент для отображения списка фильмов
     */
    function component(object) {
        var comp = new Lampa.InteractionCategory(object);
        
        comp.create = function() {
            Api.fetch(object, this.build.bind(this), this.empty.bind(this));
        };
        
        comp.nextPageReuest = function(object, resolve, reject) {
            Api.fetch(object, resolve.bind(comp), reject.bind(comp));
        };
        
        return comp;
    }

    /**
     * Запуск плагина
     */
    function startPlugin() {
        var manifest = {
            type: 'video',
            version: '1.0.0',
            name: PLUGIN_NAME,
            description: 'Отображение watchlist из Letterboxd',
            component: 'letterboxd'
        };

        Lampa.Manifest.plugins = manifest;
        Lampa.Component.add('letterboxd', component);

        /**
         * Добавление кнопки в меню
         */
        function addMenuButton() {
            var button = $('<li class="menu__item selector">\
                <div class="menu__ico">\
                    <svg viewBox="0 0 500 500" fill="none" xmlns="http://www.w3.org/2000/svg">\
                        <circle cx="129" cy="250" r="95" fill="#00E054"/>\
                        <circle cx="371" cy="250" r="95" fill="#40BCF4"/>\
                        <circle cx="250" cy="250" r="95" fill="#FF8000"/>\
                        <path d="M196 175 C220 210, 220 290, 196 325" stroke="#00E054" stroke-width="8" fill="none"/>\
                        <path d="M304 175 C280 210, 280 290, 304 325" stroke="#40BCF4" stroke-width="8" fill="none"/>\
                    </svg>\
                </div>\
                <div class="menu__text">' + manifest.name + '</div>\
            </li>');

            button.on('hover:enter', function() {
                var username = Lampa.Storage.get('letterboxd_username', '');
                
                if (!username) {
                    Lampa.Noty.show('Укажите имя пользователя в настройках Letterboxd');
                    Lampa.Settings.open('letterboxd');
                    return;
                }

                Lampa.Activity.push({
                    url: '',
                    title: manifest.name + ' - ' + username,
                    component: 'letterboxd',
                    page: 1
                });
            });

            $('.menu .menu__list').eq(0).append(button);
        }

        /**
         * Настройки плагина
         */
        function addSettings() {
            Lampa.SettingsApi.addComponent({
                component: 'letterboxd',
                icon: '<svg viewBox="0 0 500 500" fill="none" xmlns="http://www.w3.org/2000/svg">\
                    <circle cx="129" cy="250" r="95" fill="#00E054"/>\
                    <circle cx="371" cy="250" r="95" fill="#40BCF4"/>\
                    <circle cx="250" cy="250" r="95" fill="#FF8000"/>\
                    <path d="M196 175 C220 210, 220 290, 196 325" stroke="#00E054" stroke-width="8" fill="none"/>\
                    <path d="M304 175 C280 210, 280 290, 304 325" stroke="#40BCF4" stroke-width="8" fill="none"/>\
                </svg>',
                name: PLUGIN_NAME
            });

            // Заголовок секции аккаунта
            Lampa.SettingsApi.addParam({
                component: 'letterboxd',
                param: {
                    type: 'title'
                },
                field: {
                    name: 'Аккаунт'
                }
            });

            // Поле для ввода имени пользователя
            Lampa.SettingsApi.addParam({
                component: 'letterboxd',
                param: {
                    name: 'letterboxd_username',
                    type: 'input',
                    default: ''
                },
                field: {
                    name: 'Имя пользователя',
                    description: 'Введите ваш username на Letterboxd'
                },
                onChange: function(value) {
                    Lampa.Storage.set('letterboxd_username', value);
                    // Очищаем кэш при смене пользователя
                    Lampa.Storage.set('letterboxd_movies', '[]');
                    Lampa.Storage.set('letterboxd_movies_count', 0);
                    console.log('Letterboxd', 'Username changed to:', value);
                }
            });

            // Заголовок секции настроек
            Lampa.SettingsApi.addParam({
                component: 'letterboxd',
                param: {
                    type: 'title'
                },
                field: {
                    name: 'Настройки'
                }
            });

            // Кнопка очистки кэша
            Lampa.SettingsApi.addParam({
                component: 'letterboxd',
                param: {
                    name: 'letterboxd_clear_cache',
                    type: 'button'
                },
                field: {
                    name: 'Очистить кэш',
                    description: 'Очистить кэшированные данные о фильмах'
                },
                onChange: function() {
                    Lampa.Storage.set('letterboxd_movies', '[]');
                    Lampa.Storage.set('letterboxd_movies_count', 0);
                    Lampa.Noty.show('Кэш Letterboxd очищен');
                }
            });

            // Кнопка обновления списка
            Lampa.SettingsApi.addParam({
                component: 'letterboxd',
                param: {
                    name: 'letterboxd_refresh',
                    type: 'button'
                },
                field: {
                    name: 'Обновить список',
                    description: 'Загрузить актуальный watchlist из Letterboxd'
                },
                onChange: function() {
                    var username = Lampa.Storage.get('letterboxd_username', '');
                    if (!username) {
                        Lampa.Noty.show('Сначала укажите имя пользователя');
                        return;
                    }
                    
                    Lampa.Noty.show('Загружаем список...');
                    
                    fetchWatchlist({ page: 1 }, function(data) {
                        Lampa.Noty.show('Загружено фильмов: ' + data.total_results);
                    }, function() {
                        Lampa.Noty.show('Ошибка при загрузке');
                    });
                }
            });
        }

        // Инициализация при готовности приложения
        if (window.appready) {
            addMenuButton();
            addSettings();
        } else {
            Lampa.Listener.follow('app', function(e) {
                if (e.type == 'ready') {
                    addMenuButton();
                    addSettings();
                }
            });
        }
    }

    // Защита от повторной инициализации
    if (!window.letterboxd_plugin_ready) {
        window.letterboxd_plugin_ready = true;
        startPlugin();
    }
})();

