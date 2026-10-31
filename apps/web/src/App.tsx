import { TopologyTree } from "./TopologyTree";
import { EditContext } from "./EditContext";
import { useRecovery } from "./useRecovery";
import { PrecisionPanel } from "./PrecisionPanel";
import { SketchPanel } from "./SketchPanel";
import { ExtrudePanel } from "./ExtrudePanel";
import {
  getLegacyObjects,
  emptyProjectV2,
  definitionOccurrences,
} from "@forma/document";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowUpRight,
  Box,
  Boxes,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Circle,
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
  Pencil,
} from "lucide-react";
import { Viewport, NavigationCube } from "@forma/viewport";
import { useEditor, isDirty, awaitGeometryCommits } from "@forma/editor";
import {
  browserFileAdapter,
  downloadGeometry,
  isDesktop,
  openNative,
  acceptNativeOpen,
  rejectNativeOpen,
  saveNative,
  resetNativeDestination,
} from "@forma/file-io";

import {
  APP_RELEASE_LABEL,
  APP_VERSION,
  primitiveNames,
  type Primitive,
} from "@forma/shared";
import { ru } from "@forma/ui";
import { shortcuts, toolLabels, isSketchTool } from "@forma/tools";
import { Properties } from "./Properties";
import { devblogEntries } from "./changelog";

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
  const recovery = useRecovery();
  const [welcome, setWelcome] = useState(true),
    [modal, setModal] = useState<"settings" | "help" | null>(null),
    [menu, setMenu] = useState<string | null>(null),
    [query, setQuery] = useState(""),
    [structure, setStructure] = useState(true),
    [dockTab, setDockTab] = useState<"structure" | "properties">("structure"),
    [helpTab, setHelpTab] = useState<"hotkeys" | "about">("hotkeys");
  // KOMPAS-style left dock: show properties automatically once something is
  // selected and return to the structure tree when the selection is cleared.
  useEffect(() => {
    if (s.selected || s.topologySelection) setDockTab("properties");
    else setDockTab("structure");
  }, [s.selected, s.topologySelection]);
  const removeSelected = () => {
    if (s.topologySelections.length > 1) {
      s.notify("Для удаления выберите одну грань.");
      return;
    }
    const ref = s.topologySelection;
    if (ref?.kind === "face")
      void s.editGeometry(ref, {
        kind: "delete-entities",
        entityIds: [ref.entityId],
      });
    else s.remove();
  };
  const nativeContexts =
    s.project.schemaVersion === 2
      ? definitionOccurrences(s.project).filter(
          (o) =>
            s.project.schemaVersion === 2 &&
            (o.path.length > 0 ||
              s.project.definitions[o.definitionId].geometryId),
        )
      : [];
  const input = useRef<HTMLInputElement>(null);
  const fileBusyRef = useRef(false);
  const [fileBusy, setFileBusy] = useState(false);
  const beginFile = () => {
    if (fileBusyRef.current) return false;
    fileBusyRef.current = true;
    setFileBusy(true);
    return true;
  };
  const endFile = () => {
    fileBusyRef.current = false;
    setFileBusy(false);
  };
  const dirty = JSON.stringify(s.project) !== s.savedSignature;
  const safe = () =>
    !isDirty() ||
    window.confirm(
      "В проекте есть несохранённые изменения. Продолжить без сохранения?",
    );
  const newProject = async () => {
    if (fileBusyRef.current || !safe() || !beginFile()) return;
    try {
      await resetNativeDestination();
      const result = s.replace(emptyProjectV2());
      if (result.status === "rejected") throw Error(result.error);
      setWelcome(false);
    } catch (error) {
      alert(
        error instanceof Error ? error.message : "Не удалось создать проект",
      );
    } finally {
      endFile();
    }
  };
  const save = async (as = false) => {
    if (!beginFile()) return;
    try {
      await awaitGeometryCommits();
      const startedProject = useEditor.getState().project;
      const project = structuredClone(startedProject);
      if (as) {
        const name = prompt("Название проекта", project.name);
        if (name === null) return;
        project.name = name.trim().slice(0, 200) || "Без названия";
      }
      const result = isDesktop()
        ? await saveNative(project, as)
        : await browserFileAdapter.save(project);
      if (result.status === "saved") {
        if (as && useEditor.getState().project === startedProject)
          s.mutate("Название проекта", (p) => {
            p.name = project.name;
          });
        s.markSaved(JSON.stringify(project));
      } else if (result.status === "download-started")
        s.notify("Скачивание начато. Запись на диск не подтверждена.");
    } catch (error) {
      alert(
        error instanceof Error ? error.message : "Не удалось сохранить проект",
      );
    } finally {
      endFile();
    }
  };
  const open = async () => {
    if (fileBusyRef.current) return;
    if (!isDesktop()) {
      input.current?.click();
      return;
    }
    if (!safe() || !beginFile()) return;
    try {
      const startedProject = useEditor.getState().project,
        candidate = await openNative();
      if (!candidate) return;
      if (useEditor.getState().project !== startedProject) {
        await rejectNativeOpen(candidate);
        throw Error("Проект изменился во время открытия. Повторите открытие.");
      }
      const project = await acceptNativeOpen(candidate);
      const result = s.replace(project);
      if (result.status === "rejected") throw Error(result.error);
      setWelcome(false);
    } catch (error) {
      alert(error instanceof Error ? error.message : "Не удалось открыть файл");
    } finally {
      endFile();
    }
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
          globalThis.confirm(
            "Есть несохранённые изменения. Закрыть VEXTRIO 3D?",
          )
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
        fileBusyRef.current ||
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
      if (key === "delete" || key === "backspace") removeSelected();
      if (key === " ") e.preventDefault();
      if (key === "escape") {
        s.select(null);
        setMenu(null);
      }
      if (key === "f") s.view("focus");
      if (e.shiftKey && key === "z") {
        e.preventDefault();
        s.view("reset");
        return;
      }
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
      {
        label: "Преобразовать в v2",
        action: () => s.upgradeProject(),
        disabled: s.project.schemaVersion === 2,
      },
      { label: "Новый проект", action: newProject, shortcut: "Ctrl N" },
      { label: "Открыть…", action: open, shortcut: "Ctrl O" },
      { label: "Сохранить", action: () => void save(), shortcut: "Ctrl S" },
      {
        label: "Сохранить как…",
        action: () => void save(true),
        shortcut: "Ctrl Shift S",
      },
      ...(!isDesktop()
        ? (["obj", "stl"] as const).map((format) => ({
            label: `Экспорт ${format.toUpperCase()}${format === "stl" ? " (мм)" : " (м)"}…`,
            action: () => {
              try {
                downloadGeometry(s.project, format);
                useEditor.setState({
                  message: `Начато скачивание ${format.toUpperCase()}. Проверьте файл в загрузках.`,
                });
              } catch (e) {
                useEditor.setState({
                  message:
                    e instanceof Error
                      ? e.message
                      : "Не удалось экспортировать.",
                });
              }
            },
          }))
        : []),
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
        action: removeSelected,
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
        shortcut: "M",
      },
      { label: "Вращение", action: () => s.setTool("rotate"), shortcut: "Q" },
      { label: "Линия", action: () => s.setTool("line"), shortcut: "L" },
      {
        label: "Прямоугольник",
        action: () => s.setTool("rectangle"),
        shortcut: "R",
      },
      { label: "Окружность", action: () => s.setTool("circle"), shortcut: "C" },
      { label: "Масштаб", action: () => s.setTool("scale"), shortcut: "S" },
      {
        label: "Вытянуть / вдавить",
        action: () => s.setTool("extrude"),
        shortcut: "P",
      },
      { label: "Орбита", action: () => s.setTool("orbit"), shortcut: "O" },
      { label: "Панорама", action: () => s.setTool("pan"), shortcut: "H" },
    ],
    Окно: [
      {
        label: structure ? "Скрыть боковую панель" : "Показать боковую панель",
        action: () => setStructure(!structure),
      },
      { label: "Настройки", action: () => setModal("settings") },
    ],
    Справка: [
      { label: "О VEXTRIO 3D и управление", action: () => setModal("help") },
    ],
  };
  return (
    <div className={`app ${s.theme}`} aria-busy={fileBusy}>
      {fileBusy && (
        <div className="file-busy-overlay" role="status">
          Работа с файлом…
        </div>
      )}
      <input
        hidden
        ref={input}
        type="file"
        accept=".v3d,.json"
        aria-label="Открыть файл проекта"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file || fileBusyRef.current || !safe() || !beginFile()) return;
          const startedProject = useEditor.getState().project;
          try {
            const project = await browserFileAdapter.open(file);
            if (useEditor.getState().project !== startedProject)
              throw Error(
                "Проект изменился во время открытия. Повторите открытие.",
              );
            const result = s.replace(project);
            if (result.status === "rejected") throw Error(result.error);
            setWelcome(false);
          } catch (error) {
            alert(
              error instanceof Error
                ? error.message
                : "Не удалось открыть файл",
            );
          } finally {
            endFile();
          }
        }}
      />
      <header className="topbar">
        <div className="menu-anchor brand">
          <button
            aria-label="Файл"
            title="Файл — открыть, сохранить, экспортировать"
            className={menu === "Файл" ? "menu-active" : ""}
            onClick={() => setMenu(menu === "Файл" ? null : "Файл")}
          >
            <img src={`${import.meta.env.BASE_URL}vextrio.svg`} alt="" />
          </button>
          <strong>VEXTRIO 3D</strong>
          {menu === "Файл" && (
            <>
              <div className="menu-backdrop" onClick={() => setMenu(null)} />
              <div className="dropdown">
                {actions["Файл"].map((a) => (
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
                  <div
                    className="menu-backdrop"
                    onClick={() => setMenu(null)}
                  />
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
        </nav>
        <div className="project-title">
          <span className={dirty ? "unsaved-dot" : "saved-dot"} />
          {s.project.name}
          <span className="file-extension">.v3d</span>
          <ChevronDown size={12} />
        </div>
        <div className="topbar-right">
          <div className="local-badge">
            <span className="mint-dot" /> Локальный проект
          </div>
          <Button title="Настройки" onClick={() => setModal("settings")}>
            <Settings2 size={16} />
          </Button>
        </div>
      </header>
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
        </div>
      </div>
      <main className="workspace">
        <aside className="tool-rail">
          <div>
            {(
              [
                {
                  tool: "select",
                  icon: <MousePointer2 size={20} />,
                  key: "Space",
                },
                { tool: "line", icon: <Pencil size={20} />, key: "L" },
                { tool: "rectangle", icon: <Square size={20} />, key: "R" },
                { tool: "circle", icon: <Circle size={20} />, key: "C" },
                { tool: "extrude", icon: <ArrowUpRight size={20} />, key: "P" },
                { tool: "translate", icon: <Move3D size={21} />, key: "M" },
                { tool: "rotate", icon: <Rotate3D size={21} />, key: "Q" },
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
                title={`Создать: ${primitiveNames[p.type]}`}
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
              disabled={!s.selected && s.topologySelection?.kind !== "face"}
              onClick={removeSelected}
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
            <div className="dock-tabs">
              <button
                className={dockTab === "structure" ? "active" : ""}
                aria-pressed={dockTab === "structure"}
                onClick={() => setDockTab("structure")}
              >
                Структура
              </button>
              <button
                className={dockTab === "properties" ? "active" : ""}
                aria-pressed={dockTab === "properties"}
                onClick={() => setDockTab("properties")}
              >
                Свойства
              </button>
              <button
                className="plain dock-hide"
                title="Скрыть боковую панель"
                onClick={() => setStructure(false)}
              >
                <PanelRight size={14} />
              </button>
            </div>
            <div
              className={`dock-pane${dockTab === "structure" ? "" : " is-hidden"}`}
            >
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
                <span>{getLegacyObjects(s.project).length}</span>
              </div>
              <div className="object-list">
                {getLegacyObjects(s.project)
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
                      <button
                        onClick={() => {
                          s.select(o.id);
                          setDockTab("properties");
                        }}
                      >
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
                        onClick={() => s.setLocked(o.id, !o.locked)}
                      >
                        {o.locked ? <Lock size={12} /> : <Unlock size={12} />}
                      </button>
                    </div>
                  ))}
                <TopologyTree onSelect={() => setDockTab("properties")} />
                {getLegacyObjects(s.project).length === 0 &&
                  nativeContexts.length === 0 && (
                    <div className="empty-tree">
                      Ваша сцена пока пуста.
                      <br />
                      Добавьте первую форму.
                    </div>
                  )}
              </div>
              <div className="structure-footer">
                <Boxes size={14} />{" "}
                {getLegacyObjects(s.project).length + nativeContexts.length}{" "}
                объектов{" "}
                <button title="Добавить куб" onClick={() => s.add("cube")}>
                  +
                </button>
              </div>
            </div>
            <div
              className={`dock-pane${dockTab === "properties" ? "" : " is-hidden"}`}
            >
              <Properties />
            </div>
          </aside>
        )}
        <section
          className={`scene${isSketchTool(s.tool) ? " sketch-active" : ""}`}
        >
          <Viewport />
          {isSketchTool(s.tool) ? (
            <SketchPanel />
          ) : s.tool === "extrude" ? (
            <ExtrudePanel />
          ) : (
            <PrecisionPanel />
          )}
          <div className="viewport-header">
            <button onClick={() => s.view("projection")}>
              <View size={14} />
              {s.project.camera.projection === "perspective"
                ? "Перспектива"
                : "Ортография"}
              <ChevronDown size={12} />
            </button>
          </div>
          <NavigationCube />
          <EditContext />
          <div className="viewport-bottom">
            <span>
              <MousePointer2 size={12} />{" "}
              {isSketchTool(s.tool) ? "ЛКМ · точка" : "Выбор · ЛКМ · Shift"}
            </span>
            <span>
              <Rotate3D size={13} />{" "}
              {isSketchTool(s.tool)
                ? "ПКМ · орбита"
                : "Орбита · перетаскивание"}
            </span>
            <span>
              <Hand size={13} /> Орбита · СКМ · Shift: панорама
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
      </main>
      <footer className="statusbar">
        <span
          className="recovery-status"
          data-testid="recovery-status"
          role="status"
          title={
            recovery.error ||
            "Последняя локальная автокопия: " +
              new Date(recovery.savedAt).toLocaleTimeString()
          }
        >
          {recovery.error
            ? "Автокопия: ошибка"
            : recovery.savedAt
              ? "Автокопия ✓"
              : ""}
        </span>
        <span className="status-message">
          <span className="mint-dot" />
          {s.message}
        </span>
        <span>{toolLabels[s.tool]}</span>
        {s.topologySelections.length > 1 && (
          <span data-testid="selection-count">
            Выбрано: {s.topologySelections.length}
          </span>
        )}
        <span className="status-selection">
          {s.topologySelection
            ? `Выбрана топология: ${s.topologySelection.entityId}`
            : s.selected
              ? "Выделен 1 объект"
              : "Нет выделения"}
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
      </footer>
      {welcome && (
        <div className="modal-overlay welcome-overlay">
          <div className="welcome">
            <div className="welcome-art">
              <img
                src={`${import.meta.env.BASE_URL}vextrio.svg`}
                alt="Знак VEXTRIO 3D"
              />
              <div className="art-grid" />
              <span>ОТ ЭСКИЗА К ГОТОВОЙ ДЕТАЛИ</span>
              <h1>
                Придай идее
                <br />
                <em>форму.</em>
              </h1>
              <p>
                Трёхмерное моделирование в браузере:
                <br />
                эскизы с точными размерами, объёмы
                <br />и точная работа с гранями.
              </p>
              <div className="art-stats">
                <div>
                  <strong>4 примитива</strong>
                  <small>куб, сфера, цилиндр, плоскость</small>
                </div>
                <div>
                  <strong>OBJ / STL</strong>
                  <small>экспорт готовой геометрии</small>
                </div>
                <div>
                  <strong>.v3d</strong>
                  <small>геометрия, материалы и структура</small>
                </div>
              </div>
              <small>VEXTRIO 3D {APP_RELEASE_LABEL}</small>
            </div>
            <div className="welcome-content">
              <span className="eyebrow">
                VEXTRIO 3D · ЛОКАЛЬНЫЙ 3D-РЕДАКТОР
              </span>
              <h2>Начнём с идеи</h2>
              {(recovery.snapshot || recovery.error) && (
                <div className="recovery-card" data-testid="recovery-card">
                  <strong>Локальная автокопия</strong>
                  {recovery.snapshot && (
                    <p>
                      {recovery.snapshot.project.name} ·{" "}
                      {new Date(recovery.snapshot.savedAt).toLocaleString()}
                    </p>
                  )}
                  {recovery.error && <p role="alert">{recovery.error}</p>}
                  <div>
                    {recovery.snapshot && (
                      <button
                        disabled={recovery.busy}
                        onClick={async () => {
                          if (await recovery.restore()) setWelcome(false);
                        }}
                      >
                        Восстановить проект
                      </button>
                    )}
                    <button
                      disabled={recovery.busy}
                      onClick={() => void recovery.discard()}
                    >
                      Удалить автокопию
                    </button>
                  </div>
                  <small>
                    Последний редактируемый проект в этом браузере. Файл на
                    диске не перезаписывается.
                  </small>
                </div>
              )}
              <p>
                Нарисуйте эскиз, задайте точный размер и получите объём — всё в
                одном окне, без установки и регистрации.
              </p>
              <button className="start-card" onClick={newProject}>
                <span className="start-icon">
                  <FilePlus />
                </span>
                <span>
                  <strong>Новый проект</strong>
                  <small>
                    Эскиз → точный размер → объём. Линии, грани, топология.
                  </small>
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
              <div className="welcome-cols">
                <div className="welcome-col">
                  <h4>Быстрый старт</h4>
                  <div className="welcome-shortcuts">
                    <span>
                      <kbd>R</kbd> Прямоугольник
                    </span>
                    <span>
                      <kbd>C</kbd> Окружность
                    </span>
                    <span>
                      <kbd>P</kbd> Выдавить грань
                    </span>
                    <span>
                      <kbd>Space</kbd> Выделение
                    </span>
                    <span>
                      <kbd>F</kbd> Фокус на объекте
                    </span>
                    <span>
                      <kbd>Ctrl S</kbd> Сохранить
                    </span>
                  </div>
                </div>
                <div className="welcome-col">
                  <h4>Возможности</h4>
                  <ul className="welcome-list">
                    <li>Эскизы с точными размерами и привязками</li>
                    <li>Выдавливание, окна и сквозные проёмы</li>
                    <li>Группы, экземпляры и топология граней</li>
                    <li>Автокопия сессии и экспорт OBJ / STL</li>
                  </ul>
                </div>
              </div>
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
                  VEXTRIO 3D <small>{APP_RELEASE_LABEL}</small>
                </h2>
                <div className="dock-tabs dialog-tabs">
                  <button
                    className={helpTab === "hotkeys" ? "active" : ""}
                    aria-pressed={helpTab === "hotkeys"}
                    onClick={() => setHelpTab("hotkeys")}
                  >
                    Горячие клавиши
                  </button>
                  <button
                    className={helpTab === "about" ? "active" : ""}
                    aria-pressed={helpTab === "about"}
                    onClick={() => setHelpTab("about")}
                  >
                    О программе
                  </button>
                </div>
                {helpTab === "hotkeys" ? (
                  <>
                    <p>
                      Нарисуйте прямоугольник (R), выберите его грань (Space),
                      задайте высоту (P). Сгруппируйте результат и собирайте
                      модель из независимых частей.
                    </p>
                    <div className="help-grid">
                      <kbd>Space / V</kbd>
                      <span>Выделение</span>
                      <kbd>L / R / C</kbd>
                      <span>Линия / прямоугольник / окружность</span>
                      <kbd>P</kbd>
                      <span>Вытянуть / вдавить выбранную грань</span>
                      <kbd>M / Q / S</kbd>
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
                        Средняя кнопка — орбита, колесо — зум, Shift + средняя
                        кнопка — панорама
                      </span>
                    </div>
                    <p className="dialog-note">
                      Выдавливание поддерживает плоские контуры и ограниченные
                      углубления и сквозные окна между параллельными гранями.
                      Поддерживаются сквозные дверные проёмы до края стены.
                      Общие булевы операции пока не поддерживаются. Экспорт
                      OBJ/STL — в меню за значком программы слева сверху.
                      Основные инструменты остаются бесплатными.
                    </p>
                  </>
                ) : (
                  <>
                    <p>
                      Бесплатный браузерный и настольный редактор 3D-моделей:
                      эскизы на гранях, выдавливание, окна, сквозные проёмы,
                      группы и экземпляры, экспорт OBJ / STL. Без регистрации;
                      файлы остаются у вас. Текущая версия{" "}
                      <strong>
                        {APP_VERSION} ({APP_RELEASE_LABEL})
                      </strong>
                      .
                    </p>
                    <h3>Недавние изменения</h3>
                    <div className="devblog">
                      {devblogEntries.map((entry) => (
                        <article
                          className="devblog-entry"
                          key={`${entry.version} ${entry.title}`}
                        >
                          <h4>
                            {entry.title} <small>{entry.version}</small>
                          </h4>
                          <ul>
                            {entry.items.map((item, index) => (
                              <li key={`${entry.version}-${index}`}>{item}</li>
                            ))}
                          </ul>
                        </article>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
