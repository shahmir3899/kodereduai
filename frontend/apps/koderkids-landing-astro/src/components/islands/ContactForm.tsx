import { useState } from 'react';
import { siteConfig } from '../../content/landing';

type FormState = {
  name: string;
  school: string;
  email: string;
  phone: string;
  message: string;
};

const INITIAL: FormState = { name: '', school: '', email: '', phone: '', message: '' };

export default function ContactForm() {
  const [form, setForm] = useState<FormState>(INITIAL);
  const [status, setStatus] = useState<'idle' | 'submitting' | 'submitted' | 'error'>('idle');
  const [message, setMessage] = useState('');

  const set = (field: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('submitting');
    setMessage('');

    try {
      const response = await fetch(siteConfig.contactEnquiryEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: form.name,
          school: form.school,
          email: form.email,
          phone: form.phone,
          message: form.message,
        }),
      });

      if (!response.ok) {
        throw new Error('Contact form submission failed');
      }

      setStatus('submitted');
      setForm(INITIAL);
    } catch {
      setStatus('error');
      setMessage('Could not send your message right now. Please try again shortly or email admin@koderkids.pk.');
    }
  };

  if (status === 'submitted') {
    return (
      <div className="bg-white/5 border border-white/10 rounded-2xl p-8 flex flex-col items-center justify-center gap-4 min-h-[24rem]">
        <div className="w-14 h-14 rounded-full bg-emerald-500/15 flex items-center justify-center">
          <svg className="w-7 h-7 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 13l4 4L19 7"/>
          </svg>
        </div>
        <h3 className="font-display font-semibold text-white text-lg">Message sent</h3>
        <p className="text-brand-gray text-sm text-center max-w-xs">
          Your enquiry has been emailed to the Education AI team. We'll reply within 1 business day.
        </p>
        <button
          onClick={() => {
            setStatus('idle');
            setMessage('');
          }}
          className="text-sm text-primary-300 underline underline-offset-2 mt-2"
        >
          Send another message
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white/5 border border-white/10 rounded-2xl p-8">
      <h3 className="font-display font-semibold text-white mb-6">Send us a message</h3>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="cf-name" className="text-xs font-medium text-gray-400">Your Name</label>
            <input
              id="cf-name"
              type="text"
              value={form.name}
              onChange={set('name')}
              placeholder="Sarah Mitchell"
              required
              autoComplete="name"
              className="input-dark"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="cf-school" className="text-xs font-medium text-gray-400">School / Organization</label>
            <input
              id="cf-school"
              type="text"
              value={form.school}
              onChange={set('school')}
              placeholder="Oakridge Academy"
              required
              autoComplete="organization"
              className="input-dark"
            />
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="cf-email" className="text-xs font-medium text-gray-400">Work Email</label>
            <input
              id="cf-email"
              type="email"
              value={form.email}
              onChange={set('email')}
              placeholder="you@school.edu"
              required
              autoComplete="email"
              className="input-dark"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="cf-phone" className="text-xs font-medium text-gray-400">Phone (optional)</label>
            <input
              id="cf-phone"
              type="tel"
              value={form.phone}
              onChange={set('phone')}
              placeholder="+92 300 0000000"
              autoComplete="tel"
              className="input-dark"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="cf-message" className="text-xs font-medium text-gray-400">Message</label>
          <textarea
            id="cf-message"
            value={form.message}
            onChange={set('message')}
            rows={4}
            placeholder="We're interested in a demo for 800 students across 2 branches..."
            className="input-dark resize-none"
          />
        </div>

        <button
          type="submit"
          disabled={status === 'submitting'}
          className="btn-primary w-full justify-center mt-1 disabled:opacity-70 disabled:cursor-not-allowed"
        >
          {status === 'submitting' ? 'Sending...' : 'Send Message'}
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12h14M12 5l7 7-7 7"/>
          </svg>
        </button>

        {message && (
          <p className="text-sm text-rose-300 text-center">{message}</p>
        )}

        <p className="text-xs text-brand-gray/60 text-center">
          We respond within 1 business day. No spam — ever.
        </p>
      </form>
    </div>
  );
}
