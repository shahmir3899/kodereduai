import { useEffect, useRef, useState } from 'react';

type LegalKind = 'privacy' | 'terms' | 'support';

const EVENT_NAME = 'open-legal-dialog';

const contentMap: Record<LegalKind, { title: string; body: string; href: string; cta: string }> = {
  privacy: {
    title: 'Privacy Policy',
    body:
      'Education AI protects school and student data using role-based access, encrypted data transfer, and secure cloud storage practices. Review the full policy for details on collection, processing, and retention.',
    href: '/privacy',
    cta: 'Open full privacy policy',
  },
  terms: {
    title: 'Terms of Service',
    body:
      'These terms govern your use of Education AI services, platform access, responsibilities, and support boundaries. Please read the complete terms before onboarding your institution.',
    href: '/terms',
    cta: 'Open full terms',
  },
  support: {
    title: 'Support',
    body:
      'For demos, onboarding, and implementation support, contact our team directly at admin@koderkids.pk or 03167394390 (Islamabad).',
    href: '/support',
    cta: 'Open support page',
  },
};

export default function LegalInfoDialog() {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<LegalKind>('privacy');
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const handleOpen = (event: Event) => {
      const customEvent = event as CustomEvent<LegalKind>;
      const nextKind = customEvent.detail;
      if (nextKind && contentMap[nextKind]) {
        setKind(nextKind);
      }
      setOpen(true);
    };

    document.addEventListener(EVENT_NAME, handleOpen as EventListener);
    return () => document.removeEventListener(EVENT_NAME, handleOpen as EventListener);
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      dialog.showModal();
      document.body.style.overflow = 'hidden';
      return;
    }

    if (dialog.open) dialog.close();
    document.body.style.overflow = '';
  }, [open]);

  const close = () => {
    setOpen(false);
    document.body.style.overflow = '';
  };

  const current = contentMap[kind];

  return (
    <dialog
      ref={dialogRef}
      onCancel={close}
      onClick={(e) => {
        if (e.target === dialogRef.current) close();
      }}
      className="bg-transparent p-0 max-w-none w-full h-full backdrop:bg-brand-dark/70 backdrop:backdrop-blur-sm"
      aria-labelledby="legal-dialog-title"
    >
      <div className="min-h-screen w-full flex items-center justify-center p-4">
        <div className="demo-dialog-panel relative w-full max-w-xl">
          <button onClick={close} className="demo-dialog-close" aria-label="Close legal info dialog">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>

          <span className="section-label block mb-1">LEGAL</span>
          <h2 id="legal-dialog-title" className="font-display text-2xl font-bold text-brand-dark mb-3">
            {current.title}
          </h2>
          <p className="text-brand-gray leading-relaxed mb-5">{current.body}</p>

          <div className="flex flex-wrap gap-2">
            <a href={current.href} className="btn-primary">
              {current.cta}
            </a>
            <button type="button" onClick={close} className="btn-secondary">
              Close
            </button>
          </div>
        </div>
      </div>
    </dialog>
  );
}
