import { useState, useEffect, useCallback, useRef } from 'react';
import { landingContent } from '../../content/landing';

const { walkthrough } = landingContent;
const slides = walkthrough.slides;

/* Tailwind color map → CSS class for the accent bar */
const accentColorMap: Record<string, string> = {
  sky:     'bg-sky-500',
  indigo:  'bg-indigo-500',
  emerald: 'bg-emerald-500',
  violet:  'bg-violet-500',
  rose:    'bg-rose-500',
  amber:   'bg-amber-500',
  teal:    'bg-teal-500',
  fuchsia: 'bg-fuchsia-500',
  slate:   'bg-slate-500',
};

export default function WalkthroughCarousel() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tablistRef = useRef<HTMLDivElement>(null);

  const goTo = useCallback((index: number) => {
    setActive(((index % slides.length) + slides.length) % slides.length);
  }, []);

  /* Auto-advance every 5.5 s unless paused or user prefers reduced motion */
  useEffect(() => {
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (paused || prefersReducedMotion) return;
    intervalRef.current = setInterval(() => {
      setActive((prev) => (prev + 1) % slides.length);
    }, 5500);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [paused]);

  /* ARIA tablist keyboard navigation (WAI-ARIA 1.2 pattern) */
  const handleTablistKeyDown = (e: React.KeyboardEvent) => {
    let next = active;
    if      (e.key === 'ArrowRight') { e.preventDefault(); next = (active + 1) % slides.length; }
    else if (e.key === 'ArrowLeft')  { e.preventDefault(); next = (active - 1 + slides.length) % slides.length; }
    else if (e.key === 'Home')       { e.preventDefault(); next = 0; }
    else if (e.key === 'End')        { e.preventDefault(); next = slides.length - 1; }
    else return;
    goTo(next);
    setPaused(true);
    /* Move DOM focus to the newly selected tab */
    const tabs = tablistRef.current?.querySelectorAll<HTMLElement>('[role="tab"]');
    if (tabs) tabs[next]?.focus();
  };

  const slide = slides[active];
  const accentClass = accentColorMap[slide.color] ?? 'bg-primary';

  return (
    <section id="walkthrough" className="py-14 lg:py-18 bg-brand-light">
      <div className="w-full px-6 lg:px-12">
        <div className="max-w-[1200px] mx-auto">

          {/* Header */}
          <div className="text-center mb-7">
            <div className="section-label mb-2">{walkthrough.label}</div>
            <h2 className="font-display text-3xl lg:text-5xl font-bold text-brand-dark mb-4">
              {walkthrough.heading}
            </h2>
            <p className="text-lg text-brand-gray max-w-xl mx-auto">
              {walkthrough.subheading}
            </p>
          </div>

          <div
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
          >
          {/* Accessible live region: announces slide changes to screen readers */}
          <div aria-live="polite" aria-atomic="true" className="sr-only">
            Slide {active + 1} of {slides.length}: {slide.title}
          </div>

          {/* Tab pills */}
          <div
            className="feature-tabs-row"
            role="tablist"
            aria-label="Feature walkthrough tabs"
            ref={tablistRef}
            onKeyDown={handleTablistKeyDown}
          >
            {slides.map((s, i) => (
              <button
                key={s.id}
                role="tab"
                aria-selected={i === active}
                tabIndex={i === active ? 0 : -1}
                onClick={() => { goTo(i); setPaused(true); }}
                className={`feature-tab-pill${i === active ? ' feature-tab-pill-active' : ''}`}
              >
                {s.label}
              </button>
            ))}
          </div>

            <div className="feature-main-grid">
              {/* Screenshot frame */}
              <div className="feature-screenshot-wrap">
                <button
                  onClick={() => { goTo(active - 1); setPaused(true); }}
                  className="feature-arrow feature-arrow-left"
                  aria-label="Previous slide"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M15 18l-6-6 6-6"/>
                  </svg>
                </button>
                <button
                  onClick={() => { goTo(active + 1); setPaused(true); }}
                  className="feature-arrow feature-arrow-right"
                  aria-label="Next slide"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M9 18l6-6-6-6"/>
                  </svg>
                </button>

                <div className="dashboard-card feature-frame">
                  <div className="window-chrome">
                    <span className="window-dot window-dot-red"></span>
                    <span className="window-dot window-dot-yellow"></span>
                    <span className="window-dot window-dot-green"></span>
                    <span className="ml-2 text-sm text-brand-gray">{slide.label}</span>
                  </div>
                  <div className="feature-image-shell">
                    <img
                      key={slide.image}
                      src={slide.image}
                      alt={slide.title}
                      className="w-full rounded-xl slideshow-img"
                      loading="lazy"
                      decoding="async"
                      width={1200}
                      height={750}
                      sizes="(max-width: 768px) 100vw, (max-width: 1280px) 60vw, 800px"
                    />
                  </div>
                </div>
              </div>

              {/* Content column */}
              <div className="feature-content-panel">
                <div className="feature-content-left">
                  <div className={`feature-content-accent ${accentClass}`}></div>
                  <h3 className="font-display text-2xl lg:text-3xl font-bold text-brand-dark mb-2">
                    {slide.title}
                  </h3>
                  <p className="text-brand-gray leading-relaxed">{slide.description}</p>
                </div>

                <ul className="feature-bullets">
                  {slide.bullets.map((b) => (
                    <li key={b} className="flex items-center gap-3 text-sm text-brand-gray">
                      <svg className="w-4 h-4 text-emerald-500 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M5 13l4 4L19 7"/>
                      </svg>
                      {b}
                    </li>
                  ))}
                </ul>

                {/* Dot nav */}
                <div className="feature-dots">
                  {slides.map((_, i) => (
                    <button
                      key={i}
                      onClick={() => { goTo(i); setPaused(true); }}
                      className={`slideshow-dot${i === active ? ' slideshow-dot-active' : ''}`}
                      aria-label={`Go to slide ${i + 1}: ${slides[i].label}`}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </section>
  );
}
