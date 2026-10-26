# S1 — целостность документа и совместимость 0.1

Дата: 24 октября 2026. Реализация для ревью, **не выпуск FORMA 0.2**. Основание: [решение владельца в PR №1](https://github.com/dmitriy5885as-design/forma-3d/pull/1#issuecomment-6385002392). PR №1 остаётся draft и не объединяется автоматически.

## Реализованные изменения

- Общий `validateProject(unknown)` для runtime-кандидатов, чтения и сериализации, execute/Undo/Redo, замены проекта и камеры. Проверка происходит до принятия документа и изменения history. Нулевой/отрицательный scale, NaN/Infinity, неверные типы, undefined, функции, Map/BigInt, sparse arrays, getters и циклические данные не маскируются через JSON.stringify.
- Отказ возвращает `rejected` и сообщение; document, selection, tool, revision, saved signature, dirty, Undo/Redo и redo-ветка остаются прежними. No-op не записывается. Асинхронные/вложенные draft-команды отвергаются; принятые данные заморожены, захваченный draft и внешние снимки не могут изменить history.
- `setLocked` — отдельное разрешённое действие. Mixed patch с ключом locked отвергается. Общая mutation-policy также запрещает изменение lock в обход intent и изменение/удаление заблокированных объектов. Учитываются предки по parentId; это не добавляет наследование transform.
- CommandHistory работает с копиями и проверяет результат до изменения стеков. Ошибка execute/undo/redo не расходует запись. SnapshotCommand защищает before/after от последующих изменений вызывающей стороны. Камера сохраняется при Undo/Redo редактирования.
- Properties не принимает нулевой scale; после отказа отображается прежнее значение. Gizmo возвращается к принятой трансформации, если его patch отвергнут. Пользователь видит причину отказа.
- Parent graph валидируется итеративно через Map и мемоизацию, вместо повторных Array.find во всех цепочках. Общая byte-policy 20 MB применяется к UTF-8 входу и сохраняемому представлению; это технический предел, не тариф.
- Browser adapter возвращает `download-started`, UI не вызывает markSaved: предупреждение о несохранённых изменениях остаётся, физическая запись не обещается. Save As готовит отдельный snapshot; отмена не переименовывает документ. Подтверждённое сохранение помечает именно записанный snapshot, поэтому более новые правки остаются dirty.
- Native open разделён на candidate → validate → accept/reject. Старый destination не сбрасывается при выборе другого файла. Только accept текущего token меняет путь; cancel, invalid JSON/schema и stale token не должны менять его. Файловые intents сериализуются в нативной сессии; tempfile/sync/persist сохранены. UI блокирует конкурирующие файловые действия и проверяет неизменность документа перед open acceptance.
- Dependency checker использует TS AST/module resolution и рекурсивный обход apps/packages: imports, type imports, reexports, literal dynamic imports/require и worker URL; проверяются декларации manifests и циклы. Nonliteral imports отвергаются как непроверяемые. Явно объявлены уже используемые зависимости; версии библиотек не обновлялись.
- Добавлены три статичных golden `.v3d` для m/cm/mm с SHA-256 manifest: все четыре примитива, стабильные текстовые ID, parentId, положения/rotation/scale, материалы, hidden/locked и обе камеры. Проверяются полное восстановление и неизменность исходных bytes.

Golden fixtures закреплены с LF через `.gitattributes`, чтобы Windows checkout с autocrlf не менял эталонные hashes.

## Доказательство устранения двух дефектов

Два постоянных regression tests сначала выполнены против исходного кода: **оба упали**. Нулевой scale менял dirty/revision и очищал redo; mixed patch `{locked:true,name:'bypass'}` менял locked объект и создавал историю.

После исправлений оба безопасных ожидания проходят. Setup блокировки использует новый отдельный intent; mixed patch по-прежнему подаётся как runtime-объект и отвергается. Старый lock-тест обновлён только для намеренного изменения API, его проверки удаления/дублирования/имени сохранены.

## Результаты проверок

| Проверка                     | Результат                                                      |
| ---------------------------- | -------------------------------------------------------------- |
| `pnpm test`                  | **64/64**, 6 suites                                            |
| Исходные unit 0.1            | **18/18** сохранены                                            |
| `pnpm build`                 | Strict TypeScript и production Vite успешны                    |
| `pnpm check:deps`            | **12 workspaces**, recursive imports/declarations/cycles       |
| Playwright / `pnpm test:e2e` | **8/8**, Chromium/software WebGL                               |
| Golden v1                    | m/cm/mm, полный roundtrip, исходные hashes сохранены           |
| Глубокие родители            | 10 000 объектов проходят итеративную проверку, цикл выявляется |
| Native Rust                  | Добавлены 3 FileSession tests; **не выполнены** без Rust/Cargo |
| `pnpm desktop:build`         | Останавливается на `cargo metadata`: program not found         |
| NSIS / Windows / offline E2E | **Не проверены**, обязательный release gate остаётся открытым  |

Suites: 18 прежних; 16 editor regression; 6 atomic history; 10 file adapters; 8 compatibility/schema; 6 dependency checker. Native adapter проверяется mock transport, **не** системными диалогами/записью Windows.

E2E: один Undo на gizmo drag; cube→X=4,25→download→reopen; mouse selection/duplicate/history/cameras/themes/resolutions; повреждённый файл и отмена New; invalid scale/lock/unlock; dirty warning после download; выбор legacy child в прежней мировой координате и roundtrip; отмена Save As без переименования. Проверка нулевого масштаба через UI выполнялась числовым полем; отдельно жест «перетащить gizmo точно через ноль» не автоматизирован.

## Обязательные условия и границы S1

| Условие                                                                  | Статус                                                                                               |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Валидация до history; отказ сохраняет document/selection/dirty/Undo/Redo | Реализовано и проверено, включая exception/no-op/nested/async и сбои Undo/Redo                       |
| Locks по intent и родителям                                              | Реализовано и проверено                                                                              |
| Совместимость v1: ID/material/world placement                            | Golden unit + E2E прошли; формат остаётся v1                                                         |
| Миграция v1→v2                                                           | Не добавлялась: запланирована S4.1, не выдаётся за завершённую                                       |
| Новая topology с проверяемыми Entity IDs/связями                         | Следующий S2; в S1 проверяются старые object IDs и parent links                                      |
| Stale Worker results                                                     | Geometry Worker ещё отсутствует. Native open защищён candidate tokens; общий worker protocol — S2/S9 |
| Download не равен подтверждённой записи                                  | Исправлено, unit + браузерный E2E                                                                    |
| Windows — отдельный обязательный gate                                    | Сохранён, готовность не заявляется                                                                   |

Snapshot history и полные проверки/сериализации по-прежнему стоят O(размер документа) на правку; delta/memory budget/selectors остаются следующими задачами. Новые линии, контуры, грани, Push/Pull и B-Rep не реализованы на S1. Изменения Rust требуют проверки в поддерживаемом окружении до снятия draft/release gate Desktop.

Следующий этап: S2.1/S2.2 — topology types, IDs/связи, GeometryPolicy, delta/inverse/lineage и async backend contract. Затем S3 — настоящие segment intersections и planar faces, S4–S6 — совместимый документ, отображение и рабочие инструменты. Не добавлять кнопки моделирования до соответствующего геометрического результата и пользовательского сценария.

## Воспроизводимая проверка

```powershell
pnpm install --frozen-lockfile
pnpm test
pnpm exec vitest run tests/s1-regressions.test.ts tests/history-safety.test.ts
pnpm build
pnpm check:deps
pnpm exec playwright install chromium
pnpm test:e2e
# Только после подготовки Rust/MSVC/WebView2:
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
pnpm desktop:build
```
