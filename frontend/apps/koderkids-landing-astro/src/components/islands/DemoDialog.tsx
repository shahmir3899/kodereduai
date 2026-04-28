import { useState, useEffect, useRef } from 'react';
import { siteConfig } from '../../content/landing';

const EVENT_NAME = 'open-demo-dialog';

const buildSubmitErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof TypeError) {
    return 'Unable to reach the server. Please check local backend/CORS settings and try again.';
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
};

const extractErrorDetail = async (response: Response): Promise<string | null> => {
  try {
    const payload = await response.json() as { detail?: unknown; message?: unknown };
    if (typeof payload.detail === 'string' && payload.detail.trim()) return payload.detail;
    if (typeof payload.message === 'string' && payload.message.trim()) return payload.message;
  } catch {
    try {
      const text = await response.text();
      if (text.trim()) return text.trim();
    } catch {
      return null;
    }
  }
  return null;
};

export default function DemoDialog() {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<'idle' | 'submitting' | 'submitted' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const dialogRef = useRef<HTMLDialogElement>(null);

  /* Listen for the custom event dispatched by static buttons */
  useEffect(() => {
    const handleOpen = () => setOpen(true);
    document.addEventListener(EVENT_NAME, handleOpen);
    return () => document.removeEventListener(EVENT_NAME, handleOpen);
  }, []);

  /* Sync open state with native <dialog> */
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      dialog.showModal();
      document.body.style.overflow = 'hidden';
    } else {
      dialog.close();
      document.body.style.overflow = '';
    }
  }, [open]);

  /* Close on backdrop click */
  const handleBackdropClick = (e: React.MouseEvent<HTMLDialogElement>) => {
    if (e.target === dialogRef.current) close();
  };

  /* Close on Escape (native <dialog> already fires this, but we sync state) */
  const handleClose = () => {
    setOpen(false);
    setStatus('idle');
    setMessage('');
    document.body.style.overflow = '';
  };

  const close = () => handleClose();

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setStatus('submitting');
    setMessage('');

    try {
      const response = await fetch(siteConfig.demoRequestEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: String(data.get('name') || ''),
          school: String(data.get('school') || ''),
          email: String(data.get('email') || ''),
          preferred_date: String(data.get('preferred_date') || '') || null,
        }),
      });

      if (!response.ok) {
        const detail = await extractErrorDetail(response);
        throw new Error(detail || `Demo request failed with status ${response.status}.`);
      }

      e.currentTarget.reset();
      setStatus('submitted');
    } catch (error) {
      setStatus('error');
      setMessage(buildSubmitErrorMessage(
        error,
        'Could not send your request right now. Please try again shortly or email admin@koderkids.pk.',
      ));
    }
  };

  return (
    <dialog
      ref={dialogRef}
      onCancel={handleClose}
      onClick={handleBackdropClick}
      className="bg-transparent p-0 max-w-none w-full h-full backdrop:bg-brand-dark/70 backdrop:backdrop-blur-sm"
      aria-labelledby="demo-dialog-title"
    >
      <div className="min-h-screen w-full flex items-center justify-center p-4">
        <div className="demo-dialog-panel relative w-full max-w-md">

          {/* Close button */}
          <button
            onClick={close}
            className="demo-dialog-close"
            aria-label="Close demo dialog"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>

          {status === 'submitted' ? (
            <div className="flex flex-col items-center gap-4 py-6 text-center">
              <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center">
                <svg className="w-7 h-7 text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M5 13l4 4L19 7"/>
                </svg>
              </div>
              <h3 className="font-display font-bold text-brand-dark text-lg">Request sent!</h3>
              <p className="text-brand-gray text-sm max-w-xs">
                Your request has been emailed to the Education AI team. We'll confirm your demo slot within 1 business day.
              </p>
              <button onClick={close} className="btn-primary mt-2">
                Close
              </button>
            </div>
          ) : (
            <>
              <div className="mb-6">
                <span className="section-label block mb-1">BOOK A DEMO</span>
                <h2 id="demo-dialog-title" className="font-display text-2xl font-bold text-brand-dark">
                  Schedule a personalised walkthrough
                </h2>
                <p className="text-sm text-brand-gray mt-1">
                  We'll show you exactly the modules that matter for your school — live, in your data.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="dd-name" className="text-xs font-medium text-brand-gray">Your Name</label>
                    <input
                      id="dd-name"
                      name="name"
                      type="text"
                      placeholder="Sarah Mitchell"
                      required
                      autoComplete="name"
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-brand-dark placeholder:text-gray-400 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="dd-school" className="text-xs font-medium text-brand-gray">School</label>
                    <input
                      id="dd-school"
                      name="school"
                      type="text"
                      placeholder="Oakridge Academy"
                      required
                      autoComplete="organization"
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-brand-dark placeholder:text-gray-400 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label htmlFor="dd-email" className="text-xs font-medium text-brand-gray">Work Email</label>
                  <input
                    id="dd-email"
                    name="email"
                    type="email"
                    placeholder="you@school.edu"
                    required
                    autoComplete="email"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-brand-dark placeholder:text-gray-400 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label htmlFor="dd-date" className="text-xs font-medium text-brand-gray">
                    Preferred Date <span className="text-gray-400">(optional)</span>
                  </label>
                  <input
                    id="dd-date"
                    name="preferred_date"
                    type="date"
                    min={new Date().toISOString().split('T')[0]}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-brand-dark focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  />
                </div>

                <button type="submit" disabled={status === 'submitting'} className="btn-primary w-full justify-center mt-1 disabled:opacity-70 disabled:cursor-not-allowed">
                  {status === 'submitting' ? 'Sending...' : 'Request Demo'}
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M5 12h14M12 5l7 7-7 7"/>
                  </svg>
                </button>

                {message && (
                  <p className="text-sm text-rose-600">{message}</p>
                )}
              </form>
            </>
          )}

        </div>
      </div>
    </dialog>
  );
}
