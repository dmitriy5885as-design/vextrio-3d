import { FilePlus2, FolderOpen, LayoutGrid, ChevronRight } from "lucide-react";
export function QuickActions({
  onNew,
  onOpen,
  onTemplates,
  busy,
}: {
  onNew: () => void;
  onOpen: () => void;
  onTemplates: () => void;
  busy: boolean;
}) {
  return (
    <section
      className="home-quick-actions"
      aria-labelledby="home-actions-heading"
    >
      <h2 id="home-actions-heading">Начать работу</h2>
      <button
        className="start-card home-primary"
        aria-label="Новый проект"
        onClick={onNew}
        disabled={busy}
      >
        <FilePlus2 size={28} />
        <span>
          <strong>Новый проект</strong>
          <small>Название, единицы и шаблон</small>
        </span>
        <ChevronRight size={18} />
      </button>
      <button
        className="start-card"
        aria-label="Открыть проект"
        onClick={onOpen}
        disabled={busy}
      >
        <FolderOpen size={28} />
        <span>
          <strong>Открыть проект</strong>
          <small>Продолжить работу с файлом .v3d</small>
        </span>
        <ChevronRight size={18} />
      </button>
      <button
        className="start-card"
        aria-label="Шаблоны проектов"
        onClick={onTemplates}
        disabled={busy}
      >
        <LayoutGrid size={28} />
        <span>
          <strong>Шаблоны проектов</strong>
          <small>Архитектура, мебель и детали</small>
        </span>
        <ChevronRight size={18} />
      </button>
    </section>
  );
}
