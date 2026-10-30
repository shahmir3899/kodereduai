import { useMutation, useQueryClient } from '@tanstack/react-query';
import { academicsApi } from '../services/api';
import { listOf } from '../services/academicYear';
import type { Entry, Slot } from '../services/timetableEdit';
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
    clearSectionDay: useMutation({ mutationFn: (d: { session_class: number; day: string }) => academicsApi.clearSectionTimetableDay(d), onSuccess: done }),
    createSlot: useMutation({ mutationFn: (d: object) => academicsApi.createTimetableSlot(d), onSuccess: done }),
    updateSlot: useMutation({ mutationFn: ({ id, data }: { id: number; data: object }) => academicsApi.updateTimetableSlot(id, data), onSuccess: done }),
    deleteSlot: useMutation({ mutationFn: (id: number) => academicsApi.deleteTimetableSlot(id), onSuccess: done }),
  };
}
