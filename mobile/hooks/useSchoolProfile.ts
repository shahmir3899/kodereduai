import { useMutation, useQueryClient } from '@tanstack/react-query';
import { schoolsApi } from '../services/api';
import type { SchoolProfile } from '../services/schoolProfile';
import { useScopedQuery } from './useScopedQuery';

export function useSchoolProfile() {
  return useScopedQuery('schoolProfile', ['current'], async () => (await schoolsApi.getMySchool()).data as SchoolProfile);
}

export function useSchoolProfileActions() {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'schoolProfile' });
  return {
    upload: useMutation({ mutationFn: (form: FormData) => schoolsApi.uploadAsset(form), onSuccess: done }),
    remove: useMutation({ mutationFn: (assetType: string) => schoolsApi.deleteAsset(assetType), onSuccess: done }),
    timeZone: useMutation({ mutationFn: (zone: string) => schoolsApi.updateTimeZone(zone), onSuccess: done }),
    exam: useMutation({ mutationFn: (d: object) => schoolsApi.updateExamConfig(d), onSuccess: done }),
    attendance: useMutation({ mutationFn: (d: object) => schoolsApi.updateAttendanceConfig(d), onSuccess: done }),
  };
}

// Whether the school appears in the app's school search (off until an admin turns it on).
export function useAppListing() {
  const qc = useQueryClient();
  const query = useScopedQuery('schoolProfile', ['listing'], async () => Boolean((await schoolsApi.getAppListing()).data?.listed_in_app));
  const set = useMutation({
    mutationFn: (listed: boolean) => schoolsApi.setAppListing(listed),
    onSuccess: () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'schoolProfile' }),
  });
  return { query, set };
}
