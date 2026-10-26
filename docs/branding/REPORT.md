# Ребрендинг FORMA 3D → VEXTRIO 3D

Дата: 24 октября 2026. Отдельное изменение поверх проверенного S2 (`3e608ce0f0d97ca609fbdd369067d1e8d7f4892d`). Архитектура геометрии и поведение S1/S2 не изменяются.

## Инвентаризация до изменений

[forma-inventory.tsv](forma-inventory.tsv) получен из полного исходного дерева S2, до ребрендинга: 185 строк — 32 пользовательские, 143 технические и 10 исторических. Классификация построчная: строка со ссылкой/import/идентификатором может одновременно содержать пользовательский текст; такие строки проверены отдельно. Слова «форма», «формат», «трансформация» не являются названием бренда.

- Пользовательские: title HTML/Tauri, header/statusbar/welcome/help/close confirmation, brand metadata, сообщения валидации, native file filters/ошибка запуска, актуальные заголовки README/стратегии/спецификации, логотипы/иконки.
- Технические: workspace imports/имена пакетов, Cargo binary, app identifier, репозиторий/ссылки, legacy SVG URL, NSIS registry keys, формат проектов и тестовые идентификаторы. Изменены только публичные метаданные и ресурсы; техническая идентичность сохранена.
- Исторические: REPORT.md, предыдущие записи CHANGELOG, аудит и отчёты S1/S2, примеры FORMA Pro/Edu как отменённого направления. История не переписана. Старые screenshots в artifacts — исторические, не ресурсы приложения.

## Изменения

1. Приложение представляется как VEXTRIO 3D в Web и метаданных Desktop/NSIS. Обновлены актуальные документы, стартовый экран, справка и сообщения. Версия 0.1.0 не выдаётся за готовую 0.2.
2. Новый собственный SVG V и сгенерированные из него PNG/ICO/ICNS/Appx/mobile assets. Legacy URL /forma.svg отдаёт тот же новый V. Графитовая тема, синие/бирюзовые акценты, читаемость двух тем сохранены. Ширина wordmark подстроена под длинное имя.
3. Tauri productName/title/publisher/description и installer/uninstaller icons обновлены. App identifier `studio.forma.editor`, Cargo name/mainBinaryName `forma-editor`, target `nsis`, installMode/currentUser, IPC commands и версия сохранены.
4. Windows NSIS: стандартный шаблон Tauri CLI 2.12.4 закреплён с MIT-лицензией и исходным URL/SHA256. В шаблоне ровно две смысловые замены: UNINSTKEY остаётся `Software\Microsoft\Windows\CurrentVersion\Uninstall\FORMA`, MANUPRODUCTKEY — `Software\forma\FORMA`. Отображаемые DisplayName/Publisher берутся из нового бренда. Путь прежней установки обнаруживается через старый registry key; новая установка получает имя VEXTRIO 3D. Обновление CLI требует проверки/обновления шаблона, что контролирует unit test.
5. Postinstall hook переименовывает только старые FORMA.lnk на рабочем столе/в стандартном Start Menu, если их target точно совпадает с executable текущей установки. Если новый ярлык уже существует и ведёт в эту же установку, удаляется только дубликат старого. Чужие ссылки не заменяются и не удаляются; rename работает и в update mode, где стандартное создание shortcut пропускается. Произвольные закрепления taskbar/пользовательские переименованные ссылки автоматически не мигрируются.

Основание для сохранения identity и отдельной проверки NSIS: [официальная конфигурация Tauri](https://v2.tauri.app/reference/config/) и [шаблон установленной версии](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.12.4/crates/tauri-bundler/src/bundle/windows/nsis/installer.nsi). Сам identifier не гарантирует сохранение productName-зависимых registry keys, поэтому простой замены JSON недостаточно.

## Совместимость файлов и данных

Файловые writer/reader и логика миграций не изменены; у валидатора изменён только текст ошибки. Расширение `.v3d`, schemaVersion, IDs, materials, camera, units, legacy parent semantics и неизвестные JSON extensions сохраняются. Маркер `format: "forma"` не заменён. Реально поддерживаемый production формат по-прежнему v1; будущий v2 из архитектурного предложения не объявляется реализованным этим PR. Неизвестные версии продолжают отвергаться.

Web: origin/пути проектов/семантика download-started не меняются. Desktop: dialog-selected destination, candidate/accept/reject, временная запись рядом с файлом и dirty/history не меняются. Пользовательские файлы не перемещаются и не переименовываются. Сохранён app identifier для прежнего WebView/app-data namespace. Корень workspace и GitHub-репозиторий forma-3d не переименовываются.

## Проверки

- 128/128 unit: прежние 123 + 5 новых; legacy discriminator и пользовательские имена FORMA сохраняются после roundtrip; unknown schema отвергается; метаданные согласованы; reverse patch шаблона даёт официальный upstream SHA; проверены PNG/ICO.
- 9/9 E2E: прежние восемь сценариев v1 и новый проход welcome → settings → help → cube → Undo/Redo с новым title/logo и без старого бренда в DOM. Скриншоты: test-results/vextrio-welcome.png, test-results/vextrio-editor.png. В первом запуске новый тест неверно предполагал закрытие Settings через Escape; исправлен сам тест на существующую кнопку «Закрыть», приложение ради теста не менялось.
- Strict TypeScript/Vite build и check:deps проходят. Зависимости и lockfile не изменены.
- Перед PR проверяется совпадение полного дерева локальных исходников и загруженных файлов; исторические fixtures и геометрическое ядро остаются прежними.

## Windows release gate

Команда pnpm desktop:build завершилась на cargo metadata: program not found. Rust/Cargo отсутствует. Реальный build/NSIS execution, upgrade существующей FORMA → VEXTRIO, uninstall/reinstall, WebView profile и запуск offline НЕ подтверждены. Статические regression tests шаблона не заменяют установку на Windows.

Обязательная приёмка перед выпуском: собрать NSIS; установить старую FORMA currentUser, открыть контрольный .v3d и создать пользовательские данные; запустить новый установщик; проверить единственную запись приложения с DisplayName VEXTRIO 3D, прежний InstallLocation/данные и новые shortcut/icon/title; открыть прежний файл и сохранить/отменить; проверить uninstall без удаления проектов, чистую установку и работу без сети. Пользовательские закрепления taskbar могут потребовать ручного переприкрепления.

Готовность Windows и юридическая доступность нового имени/знака этим PR не заявляются. Следующая продуктовая задача остаётся S3: реальные пересечения и автоматические грани.
