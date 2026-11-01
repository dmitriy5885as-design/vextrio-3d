import { Box, ScanLine, Layers, Package } from "lucide-react";
export function HeroSection() {
  return (
    <section className="home-hero" aria-labelledby="home-hero-heading">
      <img
        className="home-hero-image"
        src={`${import.meta.env.BASE_URL}home-hero.webp`}
        width="1120"
        height="747"
        alt="Архитектурная визуализация: разрез современного дома с интерьером"
      />
      <div className="home-hero-copy">
        <span className="eyebrow">ПРИДАЙ ИДЕЕ ФОРМУ</span>
        <h1 id="home-hero-heading">
          Превращайте идеи
          <br />в реальные
          <br />
          <em>3D-модели</em>
        </h1>
        <p>
          От первого эскиза до объёмной модели.
          <br />
          Ваше пространство для проектирования,
          <br />
          творчества и точных деталей.
        </p>
      </div>
      <div className="home-feature-row">
        {[
          { icon: Box, label: "Точные размеры" },
          { icon: ScanLine, label: "Привязки" },
          { icon: Layers, label: "Группы и компоненты" },
          { icon: Package, label: "OBJ / STL" },
        ].map(({ icon: Icon, label }) => (
          <span key={label}>
            <Icon size={23} />
            {label}
          </span>
        ))}
      </div>
      <small className="home-visual-note">Концептуальная визуализация</small>
    </section>
  );
}
