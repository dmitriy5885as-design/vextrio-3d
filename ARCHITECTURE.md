# Архитектура VEXTRIO 3D

Текущее дополнение [S6](docs/0.2/S6_REPORT.md): tools содержит независимый ToolController/ToolHost, editor связывает FSM с GeometrySession и общей историей, viewport/SketchPanel маршрутизируют мышь и клавиатуру. GeometryDocumentCommand поддерживает атомарное создание первой geometry/material; hover и множественный EntityRef selection остаются transient UI. Статусы предшествующих этапов ниже исторические.

Текущий этап: [S5 — точный ввод и независимый Snap Engine](docs/0.2/S5_REPORT.md), подготовлен к приёмке. snapping использует document/geometry/shared; editor и viewport потребляют snapping без обратной зависимости. Схема файла не менялась. Разделы S1–S3 ниже описывают состояние на момент соответствующего этапа.

Основание 0.1 развивается по утверждённой [архитектуре 0.2](docs/0.2/ARCHITECTURE.md). Реализованы S1–S3. [S4](docs/0.2/S4_REPORT.md) подключает production Document v2 к общей истории, файлам, отображению и выбору топологических сущностей; v1 остаётся совместимой веткой документа. Ни один PR автоматически не объединяется; S4 ожидает приёмки.

Зависимости направлены от приложений к пакетам. `shared` не зависит от других пакетов. `geometry` — независимое от Three.js/DOM ядро с Earcut для производной триангуляции. `document` использует `shared`/`geometry`; `commands` — документ; `editor` — документ, команды и геометрию. `viewport` использует editor/document/geometry и локальные PrimitiveAdapter/TopologyBridge. `file-io` использует документ. `ui` содержит токены и словарь. `pnpm check:deps` проверяет импорты, декларации и циклы.

Документ — JSON-совместимый Document v1/v2. Для v1 сохраняется Map ID→primitive Mesh. Для v2 канонические definitions/nodes/geometries/materials отображаются производным TopologyBridge с EntityRef и occurrencePath. Треугольники не сохраняются как топология. Камера не перестраивает отображение и индекс привязок. Render запускается по запросу; pointermove режима точной точки объединяется через RAF. ResizeObserver обновляет размер камеры и renderer. При потере WebGL-контекста показано сообщение.

`useEditor` разделяет поля документа (`project`) и временные поля UI (`selected`, `tool`, `grid`, тема, чувствительность). Подписка viewport сравнивает только значимые ссылки и параметры; изменения камеры не вызывают синхронизацию объектов. Для будущих больших сцен следует разделить Zustand на физические stores и заменить широкие React-подписки селекторами.

Изменения legacy проходят через mutate/SnapshotCommand; native geometry — через GeometrySession.prepare и GeometryDocumentCommand с forward/inverse в той же истории. Максимум 100 действий. Манипулятор legacy фиксирует одну команду при отпускании; точная точка остаётся временной до явного применения. Камера — навигационное состояние вне истории редактирования.

Файловые операции сначала проверяют/сериализуют данные. Ошибка открытия не заменяет текущий проект. Браузер скачивает Blob без изменения исходного файла. Нативный адаптер вызывает Rust-команды, выбранный путь хранится в Mutex; запись через tempfile в той же папке, sync_all, persist. Неуспешная запись не помечает проект сохранённым. Нативный слой требует проверки на Windows.

Будущий Worker получает сериализуемое описание геометрии и ID запроса, возвращает transferable Float32Array/Uint32Array. Реализация Three.js остаётся на главном потоке; OpenCascade должен жить в Worker. Модель документа не зависит от классов Three.js, хотя текущий контракт отображаемой геометрии их использует — этот тип нужно заменить типизированными массивами до интеграции Worker.

## S1: принятие документа

Общий validateProject проверяет runtime candidate до публикации и записи истории; CommandHistory проверяет execute/Undo/Redo до изменения стеков. Locks проверяются policy по отдельным intents; принятый документ заморожен. Валидация parentId итеративная через Map и memo. Dependency checker рекурсивный и учитывает manifests/TypeScript resolution. Native open имеет candidate/accept/reject tokens, browser save возвращает download-started без подтверждения записи. Полные snapshot/JSON проверки остаются в Foundation; delta/Worker и v2 идут по следующему плану.

## S2: чистое ядро

Geometry теперь не зависит от Three.js или UI; прежний PrimitiveAdapter находится локально в viewport. Реализованы topology/IDs/валидация/математика, граф определений групп и компонентов, delta/inverse/lineage и async session harness. Production UI остаётся на v1; новая история geometry пока не заменяет SnapshotCommand. [Подробности и границы S2](docs/0.2/S2_REPORT.md).

## S3: редактируемые рёбра и плоские области

Pure geometry backend теперь строит 3D T/X/overlap intersections, канонические вершины, минимальные рёбра, planar arrangements, bounded faces и holes. Все изменения остаются GeometryDelta с проверяемым inverse и lineage; GeometrySession сохраняет atomic/stale/cancel/Undo гарантии. Источник данных — GeometryModel, не Three.js. [Алгоритмы, численные примеры и границы S3](docs/0.2/S3_REPORT.md). UI и .v3d остаются на v1 до S4/S6.
