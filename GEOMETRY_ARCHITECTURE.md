# Геометрическое ядро

S2.1/S2.2 и S3.1/S3.2 реализованы отдельным pure TypeScript API в `packages/geometry`: topology entities/IDs, GeometryPolicy, математика плоскостей/размещений, validators, delta/inverse/lineage и async backend/session harness. Three.js, UI и DOM не являются зависимостями ядра. [Отчёт, проверки и границы S2](docs/0.2/S2_REPORT.md).

Прежний PrimitiveAdapter перенесён в viewport без изменения алгоритмов. Legacy-примитивы используют его локально. [S4](docs/0.2/S4_REPORT.md) подключает production Document v2, явную миграцию v1, GeometrySession.prepare к общей истории, TopologyBridge и entity picking с occurrencePath. Native topology — источник истины; треугольники Earcut используются только для отображения. Рисование — S6; S5 ещё не начат.

Топологический closed-shell не означает solid. Validator S2 не заменяет будущую полную проверку arrangements и пересечений разных граней. Local backend поддерживает move-vertices, insert-segments, make-face и face-only delete; удаление рёбер пока возвращает UNSUPPORTED_OPERATION. [Результаты и ограничения S3](docs/0.2/S3_REPORT.md). OpenCascade.js станет отдельным representation/backend, не WASM pointer внутри JSON и не Mesh вместо документа.

Полная целевая архитектура: [0.2 ARCHITECTURE](docs/0.2/ARCHITECTURE.md), [контракты](docs/0.2/CONTRACTS.md), [этапы](docs/0.2/IMPLEMENTATION_PLAN.md).
