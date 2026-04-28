import { useState, useEffect } from 'react';
import { fetchMainAppMetrics, FALLBACK_METRICS, type LandingMetrics } from '../../services/mainAppMetrics';

type Props = {
  /** Render variant: 'strip' = dark bg strip (SocialProof), 'bar' = inline trust bar (Hero) */
  variant?: 'strip' | 'bar';
};

export default function LiveMetrics({ variant = 'strip' }: Props) {
  const [metrics, setMetrics] = useState<LandingMetrics>(FALLBACK_METRICS);

  useEffect(() => {
    let mounted = true;
    fetchMainAppMetrics()
      .then((data) => { if (mounted) setMetrics(data); })
      .catch(() => {/* keep fallback */});
    return () => { mounted = false; };
  }, []);

  const items = [
    { value: metrics.schools,   label: 'Schools'   },
    { value: metrics.students,  label: 'Students'  },
    { value: metrics.teachers,  label: 'Teachers'  },
    { value: metrics.countries, label: 'Countries' },
  ];

  if (variant === 'bar') {
    return (
      <div className="flex flex-wrap gap-6">
        {items.map((item, i) => (
          <>
            {i > 0 && <div className="w-px bg-white/10 self-stretch" key={`sep-${i}`}></div>}
            <div key={item.label}>
              <div className="text-2xl font-display font-bold text-white">{item.value}</div>
              <div className="text-xs text-brand-gray mt-0.5">{item.label}</div>
            </div>
          </>
        ))}
      </div>
    );
  }

  /* strip variant */
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-0 rounded-2xl bg-brand-dark overflow-hidden">
      {items.map((item, i) => (
        <div
          key={item.label}
          className={[
            'flex flex-col items-center justify-center py-10 px-6 text-center',
            i < items.length - 1 ? 'border-r border-white/10' : '',
          ].join(' ')}
        >
          <div className="font-display text-3xl sm:text-4xl font-bold text-white mb-1">
            {item.value}
          </div>
          <div className="text-xs text-brand-gray uppercase tracking-widest">{item.label}</div>
        </div>
      ))}
    </div>
  );
}
