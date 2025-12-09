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
            name: item.title,
            original_title: item.title,
            original_name: item.title,
            overview: item.overview || '',
            poster_path: item.poster ? item.poster.replace('https://image.tmdb.org/t/p/w500', '') : '',
            backdrop_path: item.backdrop ? item.backdrop.replace('https://image.tmdb.org/t/p/w780', '') : '',
            vote_average: item.vote_average || 0,
            release_date: item.year ? item.year + '-01-01' : '',
            first_air_date: item.year ? item.year + '-01-01' : '',
            source: 'tmdb',
            letterboxd_slug: item.slug
        };
    }

    /**
     * Загружает watchlist из API и сохраняет в Storage
     */
    function loadWatchlist(callback) {
        var username = Lampa.Storage.get('letterboxd_username', '');
        
        if (!username) {
            console.log('Letterboxd', 'No username set');
            if (callback) callback([]);
            return;
        }

        var url = API_BASE_URL + '?user=' + encodeURIComponent(username) + '&pages=1';

        console.log('Letterboxd', 'Fetching watchlist from:', url);

        network.silent(url, function(data) {
            if (data && data.items && Array.isArray(data.items)) {
                var results = data.items.map(transformToTMDBFormat);
                
                console.log('Letterboxd', 'Received ' + results.length + ' movies for user: ' + data.user);

                // Сохраняем данные
                Lampa.Storage.set('letterboxd_movies', results);
                Lampa.Storage.set('letterboxd_movies_count', data.count);

                Lampa.Noty.show('Letterboxd: загружено ' + results.length + ' фильмов');

                if (callback) callback(results);
            } else {
                console.log('Letterboxd', 'Invalid response:', data);
                if (callback) callback([]);
            }
        }, function(error) {
            console.log('Letterboxd', 'API Error:', error);
            Lampa.Noty.show('Ошибка загрузки Letterboxd');
            if (callback) callback([]);
        });
    }

    /**
     * API для компонента
     */
    function full(params, oncomplete, onerror) {
        var username = Lampa.Storage.get('letterboxd_username', '');
        
        if (!username) {
            Lampa.Noty.show('Укажите имя пользователя Letterboxd в настройках');
            onerror();
            return;
        }

        var movies = Lampa.Storage.get('letterboxd_movies', []);

        // Если есть кэшированные данные - показываем их
        if (movies && movies.length > 0) {
            oncomplete({
                results: movies,
                page: 1
            });
        } else {
            // Загружаем данные
            loadWatchlist(function(results) {
                if (results.length > 0) {
                    oncomplete({
                        results: results,
                        page: 1
                    });
                } else {
                    onerror();
                }
            });
        }
    }

    function clear() {
        network.clear();
    }

    var Api = {
        full: full,
        clear: clear
    };

    /**
     * Компонент для отображения списка фильмов
     */
    function component(object) {
        var comp = new Lampa.InteractionCategory(object);
        
        comp.create = function() {
            Api.full(object, this.build.bind(this), this.empty.bind(this));
        };
        
        comp.nextPageReuest = function(object, resolve, reject) {
            Api.full(object, resolve.bind(comp), reject.bind(comp));
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
                    </svg>\
                </div>\
                <div class="menu__text">' + manifest.name + '</div>\
            </li>');

            button.on('hover:enter', function() {
                var username = Lampa.Storage.get('letterboxd_username', '');
                
                if (!username) {
                    Lampa.Noty.show('Укажите имя пользователя в настройках');
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
                    Lampa.Storage.set('letterboxd_movies', []);
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
                    Lampa.Storage.set('letterboxd_movies', []);
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
                    loadWatchlist();
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
