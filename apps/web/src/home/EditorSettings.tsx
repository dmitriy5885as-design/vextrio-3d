import { useEditor } from "@forma/editor";
export function EditorSettings() {
  const s = useEditor();
  return (
    <div className="editor-settings">
      <label className="setting-row">
        Оформление
        <select
          aria-label="Тема"
          value={s.theme}
          onChange={(e) =>
            useEditor.setState({ theme: e.target.value as "dark" | "light" })
          }
        >
          <option value="dark">Графитовая</option>
          <option value="light">Светлая</option>
        </select>
      </label>
      <label className="setting-row">
        Чувствительность навигации
        <input
          aria-label="Чувствительность навигации"
          type="range"
          min="0.2"
          max="2"
          step="0.1"
          value={s.sensitivity}
          onChange={(e) =>
            useEditor.setState({ sensitivity: Number(e.target.value) })
          }
        />
        <span>{s.sensitivity.toFixed(1)}</span>
      </label>
      <label className="setting-row">
        Рабочая сетка
        <input
          type="checkbox"
          checked={s.grid}
          onChange={(e) => useEditor.setState({ grid: e.target.checked })}
        />
      </label>
      <label className="setting-row">
        Привязка к сетке 0,25 м
        <input
          type="checkbox"
          checked={s.snap}
          onChange={(e) => useEditor.setState({ snap: e.target.checked })}
        />
      </label>
      <p className="dialog-note">
        Настройки применяются к текущему сеансу редактора.
      </p>
    </div>
  );
}
