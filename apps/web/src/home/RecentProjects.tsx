import {
  FolderOpen,
  FileBox,
  Trash2,
  ArrowRight,
  FileQuestion,
} from "lucide-react";
import type { RecentProject } from "@forma/file-io";
export function RecentProjects({
  entries,
  error,
  busy,
  all = false,
  onOpen,
  onRemove,
  onClear,
  onBrowse,
  onAll,
}: {
  entries: RecentProject[];
  error: string;
  busy: boolean;
  all?: boolean;
  onOpen: (entry: RecentProject) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  onBrowse: () => void;
  onAll: () => void;
}) {
  return (
    <section className="home-recents" aria-labelledby="recent-heading">
      <div className="home-section-heading">
        {all ? (
          <h1 id="recent-heading">Проекты</h1>
        ) : (
          <h2 id="recent-heading">Недавние проекты</h2>
        )}
        {!all && entries.length > 0 && (
          <button className="home-text-link" onClick={onAll}>
            Все проекты
            <ArrowRight size={15} />
          </button>
        )}
      </div>
      {error ? (
        <div className="home-empty">
          <FileQuestion size={28} />
          <div>
            <strong>Список проектов недоступен</strong>
            <p role="alert">{error}</p>
          </div>
          <button disabled={busy} onClick={onClear}>
            Очистить список
          </button>
        </div>
      ) : entries.length === 0 ? (
        <div className="home-empty" data-testid="recent-empty">
          <FolderOpen size={30} />
          <div>
            <strong>Здесь появятся ваши проекты</strong>
            <p>
              Откройте .v3d, чтобы вернуться к нему позже. Список хранится
              только на этом устройстве.
            </p>
          </div>
          <button disabled={busy} onClick={onBrowse}>
            Открыть файл
          </button>
        </div>
      ) : (
        <div className="home-recent-grid">
          {(all ? entries : entries.slice(0, 6)).map((entry) => (
            <article className="home-recent-card" key={entry.id}>
              <button
                className="home-recent-open"
                aria-label={`Открыть недавний проект ${entry.name}`}
                onClick={() => onOpen(entry)}
                disabled={busy}
              >
                <div className="home-recent-preview">
                  <FileBox size={33} />
                  <span>.v3d</span>
                </div>
                <strong title={entry.name}>{entry.name}</strong>
                <span className="recent-file-name" title={entry.fileName}>
                  {entry.fileName}
                </span>
                <small>
                  {new Date(entry.lastOpened).toLocaleDateString("ru-RU")}
                </small>
                <span
                  className={`recent-access ${entry.source === "native" && !entry.available ? "missing" : ""}`}
                >
                  {entry.source === "browser"
                    ? "Выбрать файл повторно"
                    : entry.available
                      ? "На этом компьютере"
                      : "Файл недоступен"}
                </span>
              </button>
              {entry.source === "native" && (
                <span className="recent-path" title={entry.path}>
                  {entry.path}
                </span>
              )}
              <button
                className="home-recent-remove"
                aria-label={`Удалить из списка ${entry.name}`}
                title="Удалить запись — файл останется на диске"
                disabled={busy}
                onClick={() => onRemove(entry.id)}
              >
                <Trash2 size={15} />
              </button>
            </article>
          ))}
        </div>
      )}
      {entries.length > 0 && (
        <p className="home-storage-note">
          В браузере для повторного открытия нужно выбрать файл заново.
          Скачивание не подтверждает сохранение на диск.
        </p>
      )}
    </section>
  );
}
