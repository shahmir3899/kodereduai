import { useRef, useState } from 'react';
import { siteConfig } from '../../content/landing';

type FormState = {
  fullName: string;
  email: string;
  phone: string;
  role: string;
  coverLetter: string;
  cv: File | null;
};

const INITIAL: FormState = {
  fullName: '',
  email: '',
  phone: '',
  role: '',
  coverLetter: '',
  cv: null,
};

export default function CareersForm() {
  const [form, setForm] = useState<FormState>(INITIAL);
  const [status, setStatus] = useState<'idle' | 'submitting' | 'submitted' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const setField = (key: keyof FormState, value: string | File | null) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const submitViaEndpoint = async () => {
    const payload = new FormData();
    payload.append('full_name', form.fullName);
    payload.append('email', form.email);
    payload.append('phone', form.phone);
    payload.append('role_applied', form.role);
    payload.append('cover_letter', form.coverLetter);
    if (form.cv) payload.append('cv_file', form.cv);

    const res = await fetch(siteConfig.careersEndpoint, {
      method: 'POST',
      body: payload,
    });

    if (!res.ok) {
      throw new Error('Career form submission failed');
    }
  };

  const fallbackToEmail = () => {
    const subject = `Career Application – ${form.role || 'General'}`;
    const body = [
      'Career application from Education AI website:',
      '',
      `Name: ${form.fullName || '-'}`,
      `Email: ${form.email || '-'}`,
      `Phone: ${form.phone || '-'}`,
      `Role: ${form.role || '-'}`,
      `Cover Letter: ${form.coverLetter || '-'}`,
      '',
      'Please attach your CV manually before sending this email.',
    ].join('\n');

    window.location.href = `mailto:${siteConfig.salesEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus('submitting');
    setMessage('');

    try {
      if (siteConfig.careersEndpoint) {
        await submitViaEndpoint();
        setStatus('submitted');
        setMessage('Application submitted successfully. We received your CV and will contact you within 1 business day.');
      } else {
        fallbackToEmail();
        setStatus('submitted');
        setMessage('Your email client has opened. Please attach your CV and send your application.');
      }
      setForm(INITIAL);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch {
      setStatus('error');
      setMessage('Could not submit right now. Please try again or email admin@koderkids.pk.');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white border border-gray-200 rounded-2xl p-6 sm:p-8 flex flex-col gap-4">
      <h2 className="font-display text-2xl font-bold text-brand-dark">Career Application</h2>
      <p className="text-sm text-brand-gray">
        Submit your details and CV. Accepted formats: PDF, DOC, DOCX. Max size: 5 MB.
      </p>

      <div className="grid sm:grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="career-name" className="text-xs font-medium text-gray-500">Full Name</label>
          <input
            id="career-name"
            type="text"
            required
            value={form.fullName}
            onChange={(e) => setField('fullName', e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="career-email" className="text-xs font-medium text-gray-500">Email</label>
          <input
            id="career-email"
            type="email"
            required
            value={form.email}
            onChange={(e) => setField('email', e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm"
          />
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="career-phone" className="text-xs font-medium text-gray-500">Phone</label>
          <input
            id="career-phone"
            type="tel"
            required
            value={form.phone}
            onChange={(e) => setField('phone', e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="career-role" className="text-xs font-medium text-gray-500">Role Applied For</label>
          <input
            id="career-role"
            type="text"
            required
            value={form.role}
            onChange={(e) => setField('role', e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="career-cv" className="text-xs font-medium text-gray-500">Upload CV</label>
        <input
          ref={fileInputRef}
          id="career-cv"
          type="file"
          required
          accept=".pdf,.doc,.docx"
          onChange={(e) => {
            const file = e.target.files?.[0] ?? null;
            setField('cv', file);
          }}
          className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="career-cover" className="text-xs font-medium text-gray-500">Cover Letter</label>
        <textarea
          id="career-cover"
          rows={4}
          required
          value={form.coverLetter}
          onChange={(e) => setField('coverLetter', e.target.value)}
          className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm resize-none"
        />
      </div>

      <button type="submit" disabled={status === 'submitting'} className="btn-primary justify-center mt-1 disabled:opacity-70 disabled:cursor-not-allowed">
        {status === 'submitting' ? 'Submitting...' : 'Submit Application'}
      </button>

      {message && (
        <p className={`text-sm ${status === 'error' ? 'text-rose-600' : 'text-emerald-700'}`}>
          {message}
        </p>
      )}

      {!siteConfig.careersEndpoint && (
        <p className="text-xs text-brand-gray">
          Tip: Configure PUBLIC_CAREERS_FORM_ENDPOINT in your environment to receive direct CV uploads.
        </p>
      )}
    </form>
  );
}
