import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowUpRight,
  Box,
  Boxes,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Cylinder,
  Eye,
  EyeOff,
  FilePlus,
  FolderOpen,
  Grid3X3,
  Hand,
  Layers,
  Lock,
  Magnet,
  Maximize,
  MousePointer2,
  Move3D,
  PanelRight,
  Redo2,
  Rotate3D,
  Save,
  Scaling,
  Search,
  Settings2,
  Square,
  Undo2,
  Unlock,
  View,
  X,
  Trash2,
  Globe,
} from "lucide-react";
import { Viewport } from "@forma/viewport";
import { useEditor, isDirty } from "@forma/editor";
import {
  browserFileAdapter,
  isDesktop,
  openNative,
  saveNative,
  resetNativeDestination,
} from "@forma/file-io";
import { emptyProject } from "@forma/document";
import { primitiveNames, type Primitive } from "@forma/shared";
import { ru } from "@forma/ui";
import { shortcuts, toolLabels } from "@forma/tools";
import { Properties } from "./Properties";

function Button({
  children,
  title,
  onClick,
  active = false,
  disabled = false,
}: {
  children: ReactNode;
  title: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      title={title}
      aria-label={title}
      className={`icon-button ${active ? "active" : ""}`}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
export function App() {
  const s = useEditor();
  const [welcome, setWelcome] = useState(true),
    [modal, setModal] = useState<"settings" | "help" | null>(null),
    [menu, setMenu] = useState<string | null>(null),
    [query, setQuery] = useState(""),
    [structure, setStructure] = useState(true);
  const input = useRef<HTMLInputElement>(null);
  const dirty = JSON.stringify(s.project) !== s.savedSignature;
  const safe = () =>
    !isDirty() ||
    window.confirm(
      "В проекте есть несохранённые изменения. Продолжить без сохранения?",
    );
  const newProject = () => {
    if (!safe()) return;
    s.replace(emptyProject());
    void resetNativeDestination();
    setWelcome(false);
  };
  const save = async (as = false) => {
    try {
      if (as) {
        const name = prompt("Название проекта", s.project.name);
        if (name === null) return;
        s.mutate("Название проекта", (p) => {
          p.name = name.trim().slice(0, 200) || "Без названия";
        });
      }
      const project = structuredClone(useEditor.getState().project);
      if (isDesktop()) {
        if (!(await saveNative(project, as))) return;
      } else await browserFileAdapter.save(project);
      s.markSaved(JSON.stringify(project));
    } catch (e) {
      alert(e instanceof Error ? e.message : "Не удалось сохранить проект");
    }
  };
  const open = () => {
    if (!isDesktop()) {
      input.current?.click();
      return;
    }
    if (!safe()) return;
    void openNative()
      .then((project) => {
        if (project) {
          s.replace(project);
          setWelcome(false);
        }
      })
      .catch((e) => alert(String(e)));
  };
  useEffect(() => {
    const leave = (e: BeforeUnloadEvent) => {
      if (isDirty()) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, []);
  useEffect(() => {
    if (!isDesktop()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
      const window = getCurrentWindow();
      const stop = await window.onCloseRequested(async (event) => {
        event.preventDefault();
        if (
          !isDirty() ||
          globalThis.confirm("Есть несохранённые изменения. Закрыть FORMA?")
        )
          await window.destroy();
      });
      if (disposed) stop();
      else unlisten = stop;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement).matches("input,textarea,select") ||
        modal ||
        welcome
      )
        return;
      const key = e.key.toLowerCase();
      if (e.ctrlKey || e.metaKey) {
        if (["s", "o", "n", "z", "y", "d"].includes(key)) e.preventDefault();
        if (key === "s") void save(e.shiftKey);
        if (key === "o") open();
        if (key === "n") newProject();
        if (key === "z") e.shiftKey ? s.redo() : s.undo();
        if (key === "y") s.redo();
        if (key === "d") s.duplicate();
        return;
      }
      if (key === "delete" || key === "backspace") s.remove();
      if (key === "escape") {
        s.select(null);
        setMenu(null);
      }
      if (key === "f") s.view("focus");
      if (shortcuts[key]) s.setTool(shortcuts[key]);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  const primitives: { type: Primitive; icon: ReactNode; key: string }[] = [
    { type: "cube", icon: <Box size={18} />, key: "1" },
    { type: "sphere", icon: <Globe size={18} />, key: "2" },
    { type: "cylinder", icon: <Cylinder size={18} />, key: "3" },
    { type: "plane", icon: <Square size={18} />, key: "4" },
  ];
  const actions: Record<
    string,
    {
      label: string;
      action: () => void;
      shortcut?: string;
      disabled?: boolean;
    }[]
  > = {
    Файл: [
      { label: "Новый проект", action: newProject, shortcut: "Ctrl N" },
      { label: "Открыть…", action: open, shortcut: "Ctrl O" },
      { label: "Сохранить", action: () => void save(), shortcut: "Ctrl S" },
      {
        label: "Сохранить как…",
        action: () => void save(true),
        shortcut: "Ctrl Shift S",
      },
    ],
    Правка: [
      {
        label: "Отменить",
        action: s.undo,
        shortcut: "Ctrl Z",
        disabled: !s.canUndo,
      },
      {
        label: "Повторить",
        action: s.redo,
        shortcut: "Ctrl Y",
        disabled: !s.canRedo,
      },
      {
        label: "Дублировать",
        action: s.duplicate,
        shortcut: "Ctrl D",
        disabled: !s.selected,
      },
      {
        label: "Удалить",
        action: s.remove,
        shortcut: "Del",
        disabled: !s.selected,
      },
    ],
    Вид: [
      {
        label: s.grid ? "Скрыть сетку" : "Показать сетку",
        action: () => useEditor.setState({ grid: !s.grid }),
      },
      {
        label: "Сменить тему",
        action: () =>
          useEditor.setState({ theme: s.theme === "dark" ? "light" : "dark" }),
      },
    ],
    Камера: [
      { label: "Изометрия", action: () => s.view("iso") },
      { label: "Сверху", action: () => s.view("top") },
      { label: "Спереди", action: () => s.view("front") },
      { label: "Справа", action: () => s.view("right") },
      { label: "Перспектива / ортография", action: () => s.view("projection") },
      {
        label: "Фокус на выделении",
        action: () => s.view("focus"),
        shortcut: "F",
      },
      { label: "Сбросить камеру", action: () => s.view("reset") },
    ],
    Создание: primitives.map((p) => ({
      label: primitiveNames[p.type],
      action: () => s.add(p.type),
    })),
    Инструменты: [
      { label: "Выделение", action: () => s.setTool("select"), shortcut: "V" },
      {
        label: "Перемещение",
        action: () => s.setTool("translate"),
        shortcut: "G",
      },
      { label: "Вращение", action: () => s.setTool("rotate"), shortcut: "R" },
      { label: "Масштаб", action: () => s.setTool("scale"), shortcut: "S" },
      { label: "Push / Pull · в версии 0.3", action: () => {}, disabled: true },
    ],
    Окно: [
      {
        label: structure ? "Скрыть структуру" : "Показать структуру",
        action: () => setStructure(!structure),
      },
      { label: "Настройки", action: () => setModal("settings") },
    ],
    Справка: [
      { label: "О FORMA и управление", action: () => setModal("help") },
    ],
  };
  return (
    <div className={`app ${s.theme}`}>
      <input
        hidden
        ref={input}
        type="file"
        accept=".v3d,.json"
        aria-label="Открыть файл проекта"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file || !safe()) return;
          try {
            const project = await browserFileAdapter.open(file);
            s.replace(project);
            setWelcome(false);
          } catch (error) {
            alert(
              error instanceof Error
                ? error.message
                : "Не удалось открыть файл",
            );
          }
        }}
      />
      <header className="titlebar">
        <div className="brand">
          <img src="/forma.svg" alt="" />
          <strong>FORMA</strong>
          <span className="version">FOUNDATION</span>
        </div>
        <div className="project-title">
          <span className={dirty ? "unsaved-dot" : "saved-dot"} />
          {s.project.name}
          <span className="file-extension">.v3d</span>
          <ChevronDown size={12} />
        </div>
        <div className="local-badge">
          <span className="mint-dot" /> Локальный проект{" "}
          <span className="version">v0.1.0</span>
        </div>
      </header>
      <nav className="menubar">
        {ru.menus.map((m) => (
          <div className="menu-anchor" key={m}>
            <button
              className={menu === m ? "menu-active" : ""}
              onClick={() => setMenu(menu === m ? null : m)}
            >
              {m}
            </button>
            {menu === m && (
              <>
                <div className="menu-backdrop" onClick={() => setMenu(null)} />
                <div className="dropdown">
                  {actions[m].map((a) => (
                    <button
                      key={a.label}
                      disabled={a.disabled}
                      onClick={() => {
                        a.action();
                        setMenu(null);
                      }}
                    >
                      {a.label}
                      <kbd>{a.shortcut}</kbd>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        ))}
        <div className="menu-right">
          Придай идее форму <ArrowUpRight size={12} />
        </div>
      </nav>
      <div className="toolbar">
        <div className="toolbar-section">
          <Button title="Новый проект" onClick={newProject}>
            <FilePlus size={17} />
          </Button>
          <Button title="Открыть проект" onClick={open}>
            <FolderOpen size={17} />
          </Button>
          <Button title="Сохранить проект" onClick={() => void save()}>
            <Save size={17} />
          </Button>
        </div>
        <div className="toolbar-section">
          <Button title="Отменить" onClick={s.undo} disabled={!s.canUndo}>
            <Undo2 size={17} />
          </Button>
          <Button title="Повторить" onClick={s.redo} disabled={!s.canRedo}>
            <Redo2 size={17} />
          </Button>
        </div>
        <div className="toolbar-section create-tools">
          <span className="toolbar-caption">Создать</span>
          {primitives.map((p) => (
            <button
              className="primitive-button"
              key={p.type}
              onClick={() => s.add(p.type)}
              title={`Создать: ${primitiveNames[p.type]}`}
              aria-label={`Создать: ${primitiveNames[p.type]}`}
            >
              {p.icon}
              <span>{primitiveNames[p.type]}</span>
            </button>
          ))}
        </div>
        <div className="toolbar-spacer" />
        <div className="toolbar-section">
          <Button
            title="Привязка к сетке 0,25 м"
            active={s.snap}
            onClick={() => useEditor.setState({ snap: !s.snap })}
          >
            <Magnet size={17} />
          </Button>
          <Button
            title="Сетка и оси"
            active={s.grid}
            onClick={() => useEditor.setState({ grid: !s.grid })}
          >
            <Grid3X3 size={17} />
          </Button>
          <Button title="Настройки" onClick={() => setModal("settings")}>
            <Settings2 size={17} />
          </Button>
        </div>
      </div>
      <main className="workspace">
        <aside className="tool-rail">
          <div>
            {(
              [
                { tool: "select", icon: <MousePointer2 size={20} />, key: "V" },
                { tool: "translate", icon: <Move3D size={21} />, key: "G" },
                { tool: "rotate", icon: <Rotate3D size={21} />, key: "R" },
                { tool: "scale", icon: <Scaling size={20} />, key: "S" },
              ] as const
            ).map((t) => (
              <Button
                key={t.tool}
                title={`${toolLabels[t.tool]} (${t.key})`}
                active={s.tool === t.tool}
                onClick={() => s.setTool(t.tool)}
              >
                {t.icon}
              </Button>
            ))}
            <hr />
            {primitives.map((p) => (
              <Button
                key={p.type}
                title={`Создать ${primitiveNames[p.type].toLowerCase()}`}
                onClick={() => s.add(p.type)}
              >
                {p.icon}
              </Button>
            ))}
            <hr />
            <Button
              title="Фокус на объекте (F)"
              onClick={() => s.view("focus")}
            >
              <Maximize size={19} />
            </Button>
            <Button
              title="Удалить выделенное"
              disabled={!s.selected}
              onClick={s.remove}
            >
              <Trash2 size={18} />
            </Button>
          </div>
          <div>
            <Button
              title="Управление и справка"
              onClick={() => setModal("help")}
            >
              <CircleHelp size={19} />
            </Button>
          </div>
        </aside>
        {structure && (
          <aside className="structure">
            <div className="panel-heading">
              Структура проекта{" "}
              <button
                className="plain"
                title="Скрыть структуру"
                onClick={() => setStructure(false)}
              >
                <PanelRight size={14} />
              </button>
            </div>
            <label className="search">
              <Search size={14} />
              <input
                aria-label="Поиск объектов"
                placeholder="Найти объект…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <kbd>⌕</kbd>
            </label>
            <div className="scene-heading">
              <ChevronDown size={12} />
              <Layers size={14} />
              <strong>Сцена</strong>
              <span>{s.project.objects.length}</span>
            </div>
            <div className="object-list">
              {s.project.objects
                .filter((o) =>
                  o.name
                    .toLocaleLowerCase()
                    .includes(query.toLocaleLowerCase()),
                )
                .map((o) => (
                  <div
                    className={`tree-object ${s.selected === o.id ? "selected" : ""}`}
                    key={o.id}
                  >
                    <button onClick={() => s.select(o.id)}>
                      <Box size={14} />
                      <span>{o.name}</span>
                    </button>
                    <button
                      title={o.visible ? "Скрыть" : "Показать"}
                      disabled={o.locked}
                      onClick={() => s.patch(o.id, { visible: !o.visible })}
                    >
                      {o.visible ? <Eye size={13} /> : <EyeOff size={13} />}
                    </button>
                    <button
                      title={o.locked ? "Разблокировать" : "Заблокировать"}
                      onClick={() => s.patch(o.id, { locked: !o.locked })}
                    >
                      {o.locked ? <Lock size={12} /> : <Unlock size={12} />}
                    </button>
                  </div>
                ))}
              {s.project.objects.length === 0 && (
                <div className="empty-tree">
                  Ваша сцена пока пуста.
                  <br />
                  Добавьте первую форму.
                </div>
              )}
            </div>
            <div className="structure-footer">
              <Boxes size={14} /> {s.project.objects.length} объектов{" "}
              <button title="Добавить куб" onClick={() => s.add("cube")}>
                +
              </button>
            </div>
          </aside>
        )}
        <section className="scene">
          <Viewport />
          <div className="viewport-header">
            <button onClick={() => s.view("projection")}>
              <View size={14} />
              {s.project.camera.projection === "perspective"
                ? "Перспектива"
                : "Ортография"}
              <ChevronDown size={12} />
            </button>
            <span>Объёмный вид</span>
          </div>
          <div className="view-cube">
            <button
              onClick={() => s.view("top")}
              title="Вид сверху"
              aria-label="Вид сверху"
            >
              ВЕРХ
            </button>
            <div>
              <button onClick={() => s.view("front")}>ФРОНТ</button>
              <button onClick={() => s.view("right")}>ПРАВО</button>
            </div>
            <button className="iso" onClick={() => s.view("iso")}>
              Изометрия ↗
            </button>
          </div>
          <div className="scene-caption">
            <span className="mint-dot" /> ПРОСТРАНСТВО ДЛЯ ВАШИХ ИДЕЙ
          </div>
          <div className="viewport-bottom">
            <span>
              <MousePointer2 size={12} /> Выбор · ЛКМ
            </span>
            <span>
              <Rotate3D size={13} /> Орбита · перетаскивание
            </span>
            <span>
              <Hand size={13} /> Панорама · СКМ
            </span>
          </div>
          <button
            className="reset-view"
            title="Сбросить камеру"
            onClick={() => s.view("reset")}
          >
            <Maximize size={16} />
          </button>
        </section>
        <Properties />
      </main>
      <footer className="statusbar">
        <span className="status-message">
          <span className="mint-dot" />
          {s.message}
        </span>
        <span>{toolLabels[s.tool]}</span>
        <span className="status-selection">
          {s.selected ? "Выделен 1 объект" : "Нет выделения"}
        </span>
        <span className="status-spacer" />
        <span>Привязка: {s.snap ? "0,25 м" : "выкл."}</span>
        <label>
          Единицы{" "}
          <select
            aria-label="Единицы измерения"
            value={s.project.units}
            onChange={(e) =>
              s.mutate("Единицы измерения", (p) => {
                p.units = e.target.value as "m" | "cm" | "mm";
              })
            }
          >
            <option value="m">Метры</option>
            <option value="cm">Сантиметры</option>
            <option value="mm">Миллиметры</option>
          </select>
        </label>
        <span className="foundation">FORMA 0.1</span>
      </footer>
      {welcome && (
        <div className="modal-overlay welcome-overlay">
          <div className="welcome">
            <div className="welcome-art">
              <img src="/forma.svg" alt="Знак FORMA" />
              <div className="art-grid" />
              <span>ОТ ЭСКИЗА К ВОЗМОЖНОСТЯМ</span>
              <h1>
                Придай идее
                <br />
                <em>форму.</em>
              </h1>
              <p>
                Ваше пространство для моделирования,
                <br />
                проектирования и творчества.
              </p>
              <small>FORMA 0.1 · FOUNDATION</small>
            </div>
            <div className="welcome-content">
              <span className="eyebrow">FORMA EDITOR</span>
              <h2>Начнём с идеи</h2>
              <p>
                Всё необходимое, чтобы создать
                <br />
                первую трёхмерную модель.
              </p>
              <button className="start-card" onClick={newProject}>
                <span className="start-icon">
                  <FilePlus />
                </span>
                <span>
                  <strong>Новый проект</strong>
                  <small>Чистый лист. Безграничные возможности.</small>
                </span>
                <ArrowUpRight size={18} />
              </button>
              <button className="start-card" onClick={open}>
                <span className="start-icon muted">
                  <FolderOpen />
                </span>
                <span>
                  <strong>Открыть проект</strong>
                  <small>Продолжить работу с файлом .v3d</small>
                </span>
                <ChevronRight size={18} />
              </button>
              <div className="welcome-note">
                <span className="mint-dot" /> Без регистрации. Файлы остаются у
                вас.
              </div>
              <button
                className="text-link"
                onClick={() => {
                  setWelcome(false);
                  setModal("help");
                }}
              >
                Познакомиться с управлением <ArrowUpRight size={13} />
              </button>
            </div>
          </div>
        </div>
      )}
      {modal && (
        <div className="modal-overlay">
          <div className="dialog">
            <button
              className="dialog-close"
              aria-label="Закрыть"
              onClick={() => setModal(null)}
            >
              <X size={19} />
            </button>
            {modal === "settings" ? (
              <>
                <span className="eyebrow">ВАШЕ РАБОЧЕЕ ПРОСТРАНСТВО</span>
                <h2>Настройки</h2>
                <label className="setting-row">
                  Оформление{" "}
                  <select
                    aria-label="Тема"
                    value={s.theme}
                    onChange={(e) =>
                      useEditor.setState({
                        theme: e.target.value as "dark" | "light",
                      })
                    }
                  >
                    <option value="dark">Графитовая</option>
                    <option value="light">Светлая</option>
                  </select>
                </label>
                <label className="setting-row">
                  Чувствительность навигации{" "}
                  <input
                    type="range"
                    min="0.2"
                    max="2"
                    step="0.1"
                    value={s.sensitivity}
                    onChange={(e) =>
                      useEditor.setState({
                        sensitivity: Number(e.target.value),
                      })
                    }
                  />
                  <span>{s.sensitivity.toFixed(1)}</span>
                </label>
                <label className="setting-row">
                  Рабочая сетка{" "}
                  <input
                    type="checkbox"
                    checked={s.grid}
                    onChange={(e) =>
                      useEditor.setState({ grid: e.target.checked })
                    }
                  />
                </label>
                <label className="setting-row">
                  Привязка к сетке 0,25 м{" "}
                  <input
                    type="checkbox"
                    checked={s.snap}
                    onChange={(e) =>
                      useEditor.setState({ snap: e.target.checked })
                    }
                  />
                </label>
                <p className="dialog-note">
                  Настройки применяются к текущему сеансу редактора.
                </p>
              </>
            ) : (
              <>
                <span className="eyebrow">SHAPE YOUR IDEAS</span>
                <h2>
                  FORMA <small>0.1 Foundation</small>
                </h2>
                <p>
                  Создавайте примитивы, меняйте их форму и собирайте свои идеи в
                  пространстве.
                </p>
                <div className="help-grid">
                  <kbd>V</kbd>
                  <span>Выделение</span>
                  <kbd>G / R / S</kbd>
                  <span>Перемещение / вращение / масштаб</span>
                  <kbd>F</kbd>
                  <span>Фокус на выбранном объекте</span>
                  <kbd>Ctrl Z / Y</kbd>
                  <span>Отменить / повторить</span>
                  <kbd>Ctrl D</kbd>
                  <span>Дублировать объект</span>
                  <kbd>Delete</kbd>
                  <span>Удалить объект</span>
                  <kbd>Мышь</kbd>
                  <span>
                    Перетаскивание — орбита, колесо — зум, средняя кнопка —
                    панорама
                  </span>
                </div>
                <p className="dialog-note">
                  Push/Pull, B-Rep и булевы операции запланированы для следующих
                  версий. FORMA Pro и Edu — будущие редакции общей платформы.
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
