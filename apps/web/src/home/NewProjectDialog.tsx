import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import {
  templates,
  type TemplateId,
  type NewProjectOptions,
} from "./templates";
export function NewProjectDialog({
  initial,
  busy,
  onCreate,
  onClose,
}: {
  initial: TemplateId;
  busy: boolean;
  onCreate: (options: NewProjectOptions) => Promise<boolean>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    [name, setName] = useState("Без названия"),
    [template, setTemplate] = useState(initial),
    [units, setUnits] = useState<NewProjectOptions["units"]>(
      templates.find((t) => t.id === initial)!.units,
    ),
    [error, setError] = useState("");
  useEffect(() => {
    const active = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    element?.showModal();
    element?.querySelector<HTMLInputElement>("input")?.focus();
    return () => {
      element?.close();
      active?.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="new-project-dialog"
      aria-labelledby="new-project-heading"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <button
        type="button"
        className="dialog-close"
        aria-label="Закрыть создание проекта"
        disabled={busy}
        onClick={onClose}
      >
        <X size={19} />
      </button>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          try {
            if (await onCreate({ name, units, template })) onClose();
          } catch (e) {
            setError(
              e instanceof Error ? e.message : "Не удалось создать проект.",
            );
          }
        }}
      >
        <span className="eyebrow">НОВАЯ ИДЕЯ</span>
        <h2 id="new-project-heading">Новый проект</h2>
        <label>
          Название проекта
          <input
            required
            maxLength={200}
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
          />
        </label>
        <label>
          Шаблон проекта
          <select
            aria-label="Шаблон проекта"
            value={template}
            onChange={(e) => {
              const id = e.target.value as TemplateId;
              setTemplate(id);
              setUnits(templates.find((t) => t.id === id)!.units);
            }}
            disabled={busy}
          >
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Единицы измерения
          <select
            aria-label="Единицы измерения"
            value={units}
            onChange={(e) =>
              setUnits(e.target.value as NewProjectOptions["units"])
            }
            disabled={busy}
          >
            <option value="m">Метры</option>
            <option value="cm">Сантиметры</option>
            <option value="mm">Миллиметры</option>
          </select>
        </label>
        <p className="dialog-note">
          {templates.find((t) => t.id === template)!.description} Шаблон задаёт
          единицы, масштаб вида и шаг привязки; готовые объекты не добавляются.
        </p>
        {error && <p role="alert">{error}</p>}
        <div className="home-dialog-actions">
          <button type="button" disabled={busy} onClick={onClose}>
            Отмена
          </button>
          <button
            className="home-primary"
            type="submit"
            disabled={busy || !name.trim()}
          >
            Создать проект
          </button>
        </div>
      </form>
    </dialog>
  );
}
