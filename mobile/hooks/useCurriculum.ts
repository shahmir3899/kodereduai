import { useMutation, useQueryClient } from '@tanstack/react-query';
import { lmsApi } from '../services/api';
import { listOf } from '../services/academicYear';
import { searchHitsOf, type BlockRevision, type ContentBlock, type SearchHit, type SyllabusProgress } from '../services/curriculumContent';
import { useScopedQuery } from './useScopedQuery';

// Writes for the curriculum screens. A change to a book's chapters or topics refreshes the tree
// and the book lists; the lesson plan pickers read the same data.
export function useCurriculumActions() {
  const qc = useQueryClient();
  const refresh = () => ['bookTree', 'books', 'syllabus', 'contentBlocks', 'syllabusProgress'].forEach((root) => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === root }));
  return {
    createBook: useMutation({ mutationFn: (d: object) => lmsApi.createBook(d), onSuccess: refresh }),
    createChapter: useMutation({ mutationFn: (d: object) => lmsApi.createChapter(d), onSuccess: refresh }),
    updateChapter: useMutation({ mutationFn: ({ id, data }: { id: number; data: object }) => lmsApi.updateChapter(id, data), onSuccess: refresh }),
    deleteChapter: useMutation({ mutationFn: (id: number) => lmsApi.deleteChapter(id), onSuccess: refresh }),
    createTopic: useMutation({ mutationFn: (d: object) => lmsApi.createTopic(d), onSuccess: refresh }),
    updateTopic: useMutation({ mutationFn: ({ id, data }: { id: number; data: object }) => lmsApi.updateTopic(id, data), onSuccess: refresh }),
    deleteTopic: useMutation({ mutationFn: (id: number) => lmsApi.deleteTopic(id), onSuccess: refresh }),
    applyToc: useMutation({ mutationFn: ({ id, data }: { id: number; data: object }) => lmsApi.applyToc(id, data), onSuccess: refresh }),
    updateBook: useMutation({ mutationFn: ({ id, data }: { id: number; data: object }) => lmsApi.updateBook(id, data), onSuccess: refresh }),
    deleteBook: useMutation({ mutationFn: (id: number) => lmsApi.deleteBook(id), onSuccess: refresh }),
    updateSubtopic: useMutation({ mutationFn: ({ id, data }: { id: number; data: object }) => lmsApi.updateSubtopic(id, data), onSuccess: refresh }),
    createBlock: useMutation({ mutationFn: (d: object) => lmsApi.createContentBlock(d), onSuccess: refresh }),
    updateBlock: useMutation({ mutationFn: ({ id, data }: { id: number; data: object }) => lmsApi.updateContentBlock(id, data), onSuccess: refresh }),
    deleteBlock: useMutation({ mutationFn: (id: number) => lmsApi.deleteContentBlock(id), onSuccess: refresh }),
    restoreRevision: useMutation({ mutationFn: ({ id, revisionId }: { id: number; revisionId: number }) => lmsApi.restoreContentBlockRevision(id, revisionId), onSuccess: refresh }),
    tagBlock: useMutation({ mutationFn: ({ id, tagId, remove }: { id: number; tagId: number; remove?: boolean }) => lmsApi.addContentBlockTag(id, tagId, remove), onSuccess: refresh }),
  };
}

// A topic's content blocks, newest edits included (refreshed by every curriculum write above).
export function useContentBlocks(topicId: number | null) {
  return useScopedQuery('contentBlocks', [topicId], async () =>
    listOf<ContentBlock>((await lmsApi.getContentBlocks({ topic_id: topicId, is_active: true, page_size: 500 })).data), { enabled: topicId != null });
}

export function useBlockRevisions(blockId: number | null) {
  return useScopedQuery('contentBlocks', ['revisions', blockId], async () =>
    listOf<BlockRevision>((await lmsApi.getContentBlockRevisions(blockId as number)).data), { enabled: blockId != null });
}

export function useSubjectTags(subjectId: number | null | undefined) {
  return useScopedQuery('contentBlocks', ['tags', subjectId ?? null], async () =>
    listOf<{ id: number; name: string; tag_type?: string }>((await lmsApi.getTags({ ...(subjectId ? { subject_id: subjectId } : {}), page_size: 500 })).data), { enabled: !!subjectId });
}

// Semantic search runs on the server over the school's content blocks; the web waits 600 ms after typing.
export function useContentSearch(q: string, classId: number | null | undefined, subjectId: number | null | undefined) {
  return useScopedQuery<SearchHit[]>('contentBlocks', ['search', q, classId ?? null, subjectId ?? null], async () =>
    searchHitsOf((await lmsApi.semanticSearchContentBlocks({ q, limit: 15, ...(classId ? { class_id: classId } : {}), ...(subjectId ? { subject_id: subjectId } : {}) })).data),
  { enabled: q.trim().length > 0 && !!classId && !!subjectId });
}

export function useSyllabusProgress(classId: number | null | undefined, subjectId: number | null | undefined) {
  return useScopedQuery<SyllabusProgress>('syllabusProgress', [classId ?? null, subjectId ?? null], async () =>
    (await lmsApi.getSyllabusProgress({ class_id: classId, subject_id: subjectId })).data as SyllabusProgress, { enabled: !!classId && !!subjectId });
}
