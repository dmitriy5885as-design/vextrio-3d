import {
  House,
  FolderOpen,
  Boxes,
  GraduationCap,
  Settings2,
  BookOpen,
  Info,
  ArrowUpRight,
} from "lucide-react";
import { APP_RELEASE_LABEL } from "@forma/shared";
export type HomePage =
  "home" | "projects" | "templates" | "learning" | "settings";
const links = [
  { id: "home", label: "Главная", icon: House },
  { id: "projects", label: "Проекты", icon: FolderOpen },
  { id: "templates", label: "Шаблоны", icon: Boxes },
  { id: "learning", label: "Обучение", icon: GraduationCap },
  { id: "settings", label: "Настройки", icon: Settings2 },
] as const;
export function HomeSidebar({
  page,
  onNavigate,
  onAbout,
}: {
  page: HomePage;
  onNavigate: (page: HomePage) => void;
  onAbout: () => void;
}) {
  return (
    <aside className="home-sidebar">
      <a
        className="home-brand"
        href="https://github.com/dmitriy5885as-design/vextrio-3d"
        target="_blank"
        rel="noreferrer"
      >
        <img
          src={`${import.meta.env.BASE_URL}vextrio.svg`}
          alt="Знак VEXTRIO 3D"
        />
        <span>
          <strong>
            VEXTRIO <em>3D</em>
          </strong>
          <small>Придай идее форму</small>
        </span>
      </a>
      <nav aria-label="Стартовый центр">
        {links.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            aria-current={page === id ? "page" : undefined}
            onClick={() => onNavigate(id)}
          >
            <Icon size={21} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="home-sidebar-links">
        <button onClick={() => onNavigate("learning")}>
          <BookOpen size={19} />
          Руководство
        </button>
        <button onClick={onAbout}>
          <Info size={19} />О программе
        </button>
        <a
          href="https://github.com/dmitriy5885as-design/vextrio-3d"
          target="_blank"
          rel="noreferrer"
        >
          Развитие проекта
          <ArrowUpRight size={14} />
        </a>
      </div>
      <div className="home-sidebar-note">
        <span className="mint-dot" /> Без подписки.
        <br />
        Без регистрации.<small>VEXTRIO 3D · {APP_RELEASE_LABEL}</small>
      </div>
    </aside>
  );
}
