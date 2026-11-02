import { useState } from 'react';
import { shareReportFile } from '../services/reportShare';
import { useToast } from '../components/ui/Toast';

// Fetch a server-made PDF and open the phone's share sheet. Shows the reason on a failure.
export function usePdfShare() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const share = async (fetchBytes: () => Promise<{ data: ArrayBuffer }>, fileName: string) => {
    setBusy(true);
    try {
      await shareReportFile(fetchBytes, fileName, 'pdf');
    } catch (e) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      toast.error(status === 404 ? 'There is nothing to export yet.' : (e as Error)?.message || 'Could not make the PDF.');
    } finally {
      setBusy(false);
    }
  };

  return { busy, share };
}
