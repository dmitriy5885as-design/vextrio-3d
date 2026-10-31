import { Box, Building2, Armchair, Printer, ArrowUpRight } from "lucide-react";
import { templates, type TemplateId } from "./templates";
const icons = {
  empty: Box,
  architecture: Building2,
  furniture: Armchair,
  printing: Printer,
};
export function TemplateGallery({
  onChoose,
  busy,
}: {
  onChoose: (id: TemplateId) => void;
  busy: boolean;
}) {
  return (
    <section className="home-templates">
      <h1>Шаблоны проектов</h1>
      <p className="home-lead">
        Выберите отправную точку. Все шаблоны создают чистый документ с
        подходящими единицами, видом и шагом привязки.
      </p>
      <div className="home-template-grid">
        {templates.map((t) => {
          const Icon = icons[t.id];
          return (
            <button
              className={`home-template template-${t.id}`}
              key={t.id}
              disabled={busy}
              onClick={() => onChoose(t.id)}
            >
              <div className="home-template-art">
                <Icon size={56} />
                <span>{t.units.toUpperCase()}</span>
              </div>
              <small>{t.badge}</small>
              <h2>{t.name}</h2>
              <p>{t.description}</p>
              <span className="home-text-link">
                Создать проект
                <ArrowUpRight size={16} />
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
