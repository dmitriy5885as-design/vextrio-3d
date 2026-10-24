# Геометрическое ядро

S2.1/S2.2 реализованы отдельным pure TypeScript API в `packages/geometry`: topology entities/IDs, GeometryPolicy, математика плоскостей/размещений, validators, delta/inverse/lineage и async backend/session harness. Three.js, UI и DOM не являются зависимостями ядра. [Отчёт, проверки и границы S2](docs/0.2/S2_REPORT.md).

Прежний PrimitiveAdapter перенесён в viewport без изменения алгоритмов. Отображение FORMA 0.1 использует его локально; формат v1 и production store/history сохраняются. Новый topology API пока не подключён к инструментам и файлам: автообразование граней/пересечения — S3, миграция/render bridge — S4, рисование — S6.

Топологический closed-shell не означает solid. Validator S2 не заменяет будущую полную проверку arrangements и пересечений разных граней. Local backend поддерживает move-vertices; остальные новые intents честно возвращают UNSUPPORTED_OPERATION. OpenCascade.js станет отдельным representation/backend, не WASM pointer внутри JSON и не Mesh вместо документа.

Полная целевая архитектура: [0.2 ARCHITECTURE](docs/0.2/ARCHITECTURE.md), [контракты](docs/0.2/CONTRACTS.md), [этапы](docs/0.2/IMPLEMENTATION_PLAN.md).
