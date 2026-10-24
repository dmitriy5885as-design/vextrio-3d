# Changelog

## Unreleased — S1 надёжности для 0.2 Sketch

- Общая валидация candidate до принятия документа/истории; отказ от нулевого масштаба и несериализуемых runtime-значений.
- Раздельные lock/unlock intents, защита от mixed patch и заблокированных предков, атомарные ошибки Undo/Redo.
- Browser download-started сохраняет dirty warning; отмена Save As не меняет имя.
- Native open candidate/accept/reject сохраняет прежний путь до принятия валидного файла; Rust/Windows проверка требуется.
- Golden v1 fixtures, постоянные regression tests и рекурсивная проверка зависимостей. [Результаты S1](docs/0.2/S1_REPORT.md).

## 0.1.0 — Foundation (разработка)

- Создан pnpm-монорепозиторий, React/Vite/TypeScript, Vitest и Playwright.
- Введены документ v1, валидатор, обратимые команды и история.
- Добавлены Three.js viewport, примитивы, выделение, трансформации, камеры и материалы.
- Добавлен интерфейс FORMA с геометрическим знаком F, палитрой Graphite/Blue/Mint/Cloud, двумя темами и стартовым экраном.
- Реализованы браузерные файлы .v3d; подготовлены нативные команды Tauri с атомарной записью.
- Добавлены архитектурные документы и план 0.2.
- Windows-сборка ожидает проверки в окружении Rust/MSVC.

## Unreleased — S2 геометрического основания

- Независимые topology tables/IDs, политика точности, плоскости/размещения, ownership и граф групп/компонентов.
- Проверяемые delta/inverse/lineage, preview и защита от stale async результатов; local move-vertices harness.
- PrimitiveAdapter перенесён в viewport; v1 и работающие инструменты сохранены. 59 новых unit tests; [отчёт S2](docs/0.2/S2_REPORT.md).
