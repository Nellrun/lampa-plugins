(function() {
    'use strict';

    var network = new Lampa.Reguest();
    var PLUGIN_NAME = 'Letterboxd';

    /**
     * Преобразует данные из нового API в формат TMDB для Lampa
     */
    function transformToTMDBFormat(item) {
        return {
            id: item.id,
            title: item.title || '',
            original_title: item.title || '',
            release_date: item.release_year ? String(item.release_year) + '-01-01' : '',
            media_type: 'movie',
            source: 'tmdb'
        };
    }

    /**
     * Проверяет, вышел ли фильм (год <= текущий год)
     */
    function isReleased(item) {
        var year = parseInt(item.release_year, 10);
        return !isNaN(year) && year <= new Date().getFullYear();
    }

    /**
     * Загружает watchlist из URL
     */
    function loadWatchlist(callback, onerror) {
        var url = Lampa.Storage.get('letterboxd_url', '');
        
        if (!url) {
            console.log('Letterboxd', 'No URL set');
            if (onerror) onerror();
            return;
        }

        console.log('Letterboxd', 'Fetching watchlist from:', url);

        network.silent(url, function(data) {
            if (data && Array.isArray(data)) {
                var results = [];
                var skipped = 0;
                
                for (var i = 0; i < data.length; i++) {
                    try {
                        var item = data[i];
                        
                        // Пропускаем фильмы, которые ещё не вышли
                        if (!isReleased(item)) {
                            console.log('Letterboxd', 'Skipping unreleased:', item.title, '(' + item.release_year + ')');
                            skipped++;
                            continue;
                        }
                        
                        results.push(transformToTMDBFormat(item));
                    } catch (e) {
                        console.log('Letterboxd', 'Error transforming item:', e);
                    }
                }
                
                if (skipped > 0) {
                    console.log('Letterboxd', 'Skipped ' + skipped + ' unreleased movies');
                }
                
                console.log('Letterboxd', 'Loaded ' + results.length + ' movies');

                if (callback) callback(results);
            } else {
                console.log('Letterboxd', 'Invalid response:', data);
                Lampa.Noty.show('Letterboxd: неверный ответ от сервера');
                if (onerror) onerror();
            }
        }, function(error) {
            console.log('Letterboxd', 'API Error:', error);
            Lampa.Noty.show('Letterboxd: ошибка загрузки');
            if (onerror) onerror();
        });
    }

    /**
     * API для компонента
     */
    function full(params, oncomplete, onerror) {
        var url = Lampa.Storage.get('letterboxd_url', '');
        
        if (!url) {
            Lampa.Noty.show('Letterboxd: укажите URL в настройках');
            onerror();
            return;
        }

        loadWatchlist(function(results) {
            if (results && results.length > 0) {
                oncomplete({
                    results: results,
                    page: 1
                });
            } else {
                onerror();
            }
        }, onerror);
    }

    /**
     * Компонент для отображения списка фильмов
     */
    function component(object) {
        var comp = new Lampa.InteractionCategory(object);
        
        comp.create = function() {
            var _this = this;
            
            full(object, function(data) {
                _this.build(data);
            }, function() {
                _this.empty();
            });
        };
        
        comp.nextPageReuest = function(object, resolve, reject) {
            // Пагинации нет, возвращаем пустой результат
            reject();
        };
        
        return comp;
    }

    /**
     * Запуск плагина
     */
    function startPlugin() {
        var manifest = {
            type: 'video',
            version: '2.0.0',
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
                var url = Lampa.Storage.get('letterboxd_url', '');
                
                if (!url) {
                    Lampa.Noty.show('Letterboxd: укажите URL в настройках');
                    return;
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

        /**
         * Настройки плагина
         */
        function addSettings() {
            Lampa.SettingsApi.addComponent({
                component: 'letterboxd_settings',
                name: PLUGIN_NAME,
                icon: '<svg viewBox="0 0 500 500" fill="none" xmlns="http://www.w3.org/2000/svg">\
                    <circle cx="129" cy="250" r="95" fill="#00E054"/>\
                    <circle cx="371" cy="250" r="95" fill="#40BCF4"/>\
                    <circle cx="250" cy="250" r="95" fill="#FF8000"/>\
                </svg>'
            });

            // Поле для ввода URL
            Lampa.SettingsApi.addParam({
                component: 'letterboxd_settings',
                param: {
                    name: 'letterboxd_url',
                    type: 'input',
                    placeholder: 'https://lb-scrapper.nellrun.dev/username/watchlist',
                    values: '',
                    default: ''
                },
                field: {
                    name: 'URL списка фильмов',
                    description: 'Введите URL вашего watchlist (например: https://lb-scrapper.nellrun.dev/nellrun/watchlist)'
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
