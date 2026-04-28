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
  const [submitted, setSubmitted] = useState(false);

  const set = (field: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const subject = `New Landing Enquiry – ${form.school || 'School Not Provided'}`;
    const body = [
      'New enquiry from the Education AI landing page:',
      '',
      `Name: ${form.name || '-'}`,
      `School: ${form.school || '-'}`,
      `Email: ${form.email || '-'}`,
      `Phone: ${form.phone || '-'}`,
      `Message: ${form.message || '-'}`,
    ].join('\n');
    window.location.href = `mailto:${siteConfig.salesEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    setSubmitted(true);
    setForm(INITIAL);
  };

  if (submitted) {
    return (
      <div className="bg-white/5 border border-white/10 rounded-2xl p-8 flex flex-col items-center justify-center gap-4 min-h-[24rem]">
        <div className="w-14 h-14 rounded-full bg-emerald-500/15 flex items-center justify-center">
          <svg className="w-7 h-7 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 13l4 4L19 7"/>
          </svg>
        </div>
        <h3 className="font-display font-semibold text-white text-lg">Opening your email app…</h3>
        <p className="text-brand-gray text-sm text-center max-w-xs">
          Your message has been composed. Send it in the email app that just opened. We'll reply within 1 business day.
        </p>
        <button
          onClick={() => setSubmitted(false)}
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
          className="btn-primary w-full justify-center mt-1"
        >
          Send Message
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12h14M12 5l7 7-7 7"/>
          </svg>
        </button>

        <p className="text-xs text-brand-gray/60 text-center">
          We respond within 1 business day. No spam — ever.
        </p>
      </form>
    </div>
  );
}
