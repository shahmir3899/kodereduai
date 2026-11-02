import { useMutation, useQueryClient } from '@tanstack/react-query';
import { academicsApi } from '../services/api';
import { listOf } from '../services/academicYear';
import type { Entry, Slot } from '../services/timetableEdit';
import type { QualityData } from '../services/timetableWeek';
import { useScopedQuery } from './useScopedQuery';

// The timetable is read all over the app (class views, teacher schedules, exam planning), so a save
// refreshes those roots too. The editor itself always reads fresh: it is about to overwrite a day.
const ROOTS = ['timetableEdit', 'timetableSlots', 'timetable', 'myTimetable', 'teacherSchedule'];
const refresh = (qc: ReturnType<typeof useQueryClient>) => ROOTS.forEach((r) => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === r }));

export function useTimetableSlots() {
  return useScopedQuery('timetableSlots', ['list'], async () => listOf<Slot>((await academicsApi.getTimetableSlots({ page_size: 9999 })).data), { staleTime: 0 });
}

export function useEditableTimetable(classObj: number | null, sessionClass: number | null) {
  return useScopedQuery('timetableEdit', [classObj, sessionClass], async () => {
    const data = (await academicsApi.getTimetableByClass(classObj as number, sessionClass)).data as { entries?: Entry[] } | Entry[];
    return (Array.isArray(data) ? data : data.entries ?? []) as Entry[];
  }, { enabled: classObj != null, staleTime: 0 });
}

export function useTimetableActions() {
  const qc = useQueryClient();
  const done = () => refresh(qc);
  return {
    saveDay: useMutation({ mutationFn: (d: object) => academicsApi.bulkSaveTimetable(d), onSuccess: done }),
    split: useMutation({ mutationFn: (d: { class_obj: number }) => academicsApi.splitTimetableForSections(d), onSuccess: done }),
    clearSectionDay: useMutation({ mutationFn: (d: { session_class: number; day: string }) => academicsApi.clearSectionTimetableDay(d), onSuccess: done }),
    createSlot: useMutation({ mutationFn: (d: object) => academicsApi.createTimetableSlot(d), onSuccess: done }),
    updateSlot: useMutation({ mutationFn: ({ id, data }: { id: number; data: object }) => academicsApi.updateTimetableSlot(id, data), onSuccess: done }),
    deleteSlot: useMutation({ mutationFn: (id: number) => academicsApi.deleteTimetableSlot(id), onSuccess: done }),
  };
}

// The score follows the saved timetable of the master class; the web asks only when the class has entries and nothing is unsaved.
export function useQualityScore(classObj: number | null, enabled: boolean) {
  return useScopedQuery<QualityData>('timetableEdit', ['quality', classObj], async () => (await academicsApi.getTimetableQualityScore(classObj as number)).data as QualityData,
    { enabled: enabled && classObj != null, staleTime: 0 });
}
