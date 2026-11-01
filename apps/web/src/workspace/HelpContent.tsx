import { useState } from "react";
import { APP_RELEASE_LABEL, APP_VERSION } from "@forma/shared";
import { manual } from "./manual";
import { devblogEntries } from "../changelog";
export function HelpContent() {
  const [section, setSection] = useState("Руководство"),
    [query, setQuery] = useState("");
  const categories = [...new Set(manual.map((m) => m.category))];
  return (
    <div className="help-content">
      <span className="eyebrow">VEXTRIO 3D · Придай идее форму</span>
      <h2>Справка</h2>
      <div
        className="help-navigation"
        role="tablist"
        aria-label="Разделы справки"
      >
        {["Руководство", "Горячие клавиши", "О программе"].map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={t === section}
            onClick={() => setSection(t)}
          >
            {t}
          </button>
        ))}
      </div>
      <section role="tabpanel" aria-label={section}>
        {section === "Руководство" ? (
          <>
            <label>
              Найти функцию
              <input
                type="search"
                placeholder="Например: дуга, импорт, сохранение"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            {categories.map((category) => {
              const entries = manual.filter(
                (m) =>
                  m.category === category &&
                  (m.name + " " + m.description)
                    .toLocaleLowerCase()
                    .includes(query.toLocaleLowerCase()),
              );
              return entries.length ? (
                <section key={category}>
                  <h3>{category}</h3>
                  {entries.map((m) => (
                    <details key={m.name} open={query ? true : undefined}>
                      <summary>
                        {m.name} <kbd>{m.key}</kbd>
                      </summary>
                      <p>{m.description}</p>
                    </details>
                  ))}
                </section>
              ) : null;
            })}
            {!manual.some((m) =>
              (m.name + " " + m.description)
                .toLocaleLowerCase()
                .includes(query.toLocaleLowerCase()),
            ) && <p role="status">Функция не найдена</p>}
          </>
        ) : section === "Горячие клавиши" ? (
          <div className="help-grid">
            {manual
              .filter((m) => m.key)
              .map((m) => (
                <div key={m.name}>
                  <kbd>{m.key}</kbd>
                  <span>{m.name}</span>
                </div>
              ))}
          </div>
        ) : (
          <>
            <h3>VEXTRIO 3D · {APP_RELEASE_LABEL}</h3>
            <p>
              Бесплатный редактор для Windows и браузера. Версия {APP_VERSION}.
              Придай идее форму.
            </p>
            <p>
              Формат .v3d совместим с прежними проектами редактора. Регистрация
              и подписка не требуются.
            </p>
            <h3>Журнал изменений</h3>
            {devblogEntries.map((e) => (
              <details key={e.version + e.title}>
                <summary>
                  {e.title} · {e.version}
                </summary>
                <ul>
                  {e.items.map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              </details>
            ))}
          </>
        )}
      </section>
    </div>
  );
}
