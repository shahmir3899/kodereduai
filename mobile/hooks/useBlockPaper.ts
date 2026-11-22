import { useMutation, useQueryClient } from '@tanstack/react-query';
import { examinationsApi } from '../services/api';
import type { DocKind } from '../services/blockPaper';
import type { BlockDocument, Registry } from '../services/shared/blockDocument';
import type { CatalogEntry, Maker, UploadEntry } from '../services/shared/pictureRefs';
import { useScopedQuery } from './useScopedQuery';

// Block paper builder (Paper Builder v2) data: the server's block types and fields, a paper as blocks, the picture
// library and the school's own pictures. Same endpoints as the web editor.

export function useBlockRegistry() {
  return useScopedQuery<Registry & { makers?: Maker[] }>('paperBlockTypes', [], async () => (await examinationsApi.getPaperBlockTypes()).data, { staleTime: 60 * 60 * 1000 });
}

export interface PaperDocumentResponse { document: BlockDocument; converted: boolean; header?: Record<string, unknown> }

/** A paper's or a worksheet's blocks (the same server path, paper_document.py). */
export function usePaperDocument(paperId: number | null, kind: DocKind = 'paper') {
  return useScopedQuery<PaperDocumentResponse>('paperDocument', [kind, paperId], async () => (
    await (kind === 'worksheet' ? examinationsApi.getWorksheetDocument(paperId as number) : examinationsApi.getPaperDocument(paperId as number))
  ).data, { enabled: !!paperId, staleTime: 0 });
}

export function usePictureCatalog(search: string) {
  return useScopedQuery<{ library: CatalogEntry[]; makers: Maker[] }>('paperPictureCatalog', [search], async () => {
    const data = (await examinationsApi.getPictureCatalog(search)).data as { library?: CatalogEntry[]; makers?: Maker[] };
    return { library: data.library ?? [], makers: data.makers ?? [] };
  }, { staleTime: 10 * 60 * 1000 });
}

export function usePaperPictures(search: string) {
  return useScopedQuery<UploadEntry[]>('paperPictures', [search], async () => {
    const data = (await examinationsApi.getPaperPictures({ page_size: 200, ...(search ? { search } : {}) })).data as { results?: UploadEntry[] } | UploadEntry[];
    return Array.isArray(data) ? data : data.results ?? [];
  }, { staleTime: 60 * 1000 });
}

/** The full catalog and the school's pictures, for naming and showing a picture a block already uses. */
export function usePictureLookups() {
  const catalog = usePictureCatalog('');
  const uploads = usePaperPictures('');
  return { catalog: catalog.data?.library ?? [], makers: catalog.data?.makers ?? [], uploads: uploads.data ?? [] };
}

export function usePaperPictureActions() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'paperPictures' });
  return {
    upload: useMutation({ mutationFn: (form: FormData) => examinationsApi.uploadPaperPicture(form), onSuccess: refresh }),
    remove: useMutation({ mutationFn: (id: number) => examinationsApi.deletePaperPicture(id), onSuccess: refresh }),
  };
}
