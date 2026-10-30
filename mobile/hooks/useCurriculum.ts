import { useMutation, useQueryClient } from '@tanstack/react-query';
import { lmsApi } from '../services/api';

// Writes for the curriculum screens. A change to a book's chapters or topics refreshes the tree
// and the book lists; the lesson plan pickers read the same data.
export function useCurriculumActions() {
  const qc = useQueryClient();
  const refresh = () => ['bookTree', 'books', 'syllabus'].forEach((root) => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === root }));
  return {
    createBook: useMutation({ mutationFn: (d: object) => lmsApi.createBook(d), onSuccess: refresh }),
    createChapter: useMutation({ mutationFn: (d: object) => lmsApi.createChapter(d), onSuccess: refresh }),
    updateChapter: useMutation({ mutationFn: ({ id, data }: { id: number; data: object }) => lmsApi.updateChapter(id, data), onSuccess: refresh }),
    deleteChapter: useMutation({ mutationFn: (id: number) => lmsApi.deleteChapter(id), onSuccess: refresh }),
    createTopic: useMutation({ mutationFn: (d: object) => lmsApi.createTopic(d), onSuccess: refresh }),
    updateTopic: useMutation({ mutationFn: ({ id, data }: { id: number; data: object }) => lmsApi.updateTopic(id, data), onSuccess: refresh }),
    deleteTopic: useMutation({ mutationFn: (id: number) => lmsApi.deleteTopic(id), onSuccess: refresh }),
    applyToc: useMutation({ mutationFn: ({ id, data }: { id: number; data: object }) => lmsApi.applyToc(id, data), onSuccess: refresh }),
  };
}
