// Capturing a printed paper from photos with the page count declared up front: every page is uploaded and read at
// the same time, straight into blocks (upload-image with mode=blocks), the server joins them (GET
// paper-uploads/group-status/) and the person checks the blocks beside the photos (BlockScanReview).
// Port of frontend/src/pages/examinations/paperCaptureLogic.js. The old questions/sections review was removed in
// Paper Builder v2 Phase 7.

import type { BlockScanResult } from './blockPaper';

export const MAX_PAGES = 30;
export const UPLOAD_CONCURRENCY = 3;
export const POLL_MS = 2500;

export interface ServerPage { page_number: number; upload_id: number | null; status: string; error_message: string; image_url?: string | null }

/** An area on a page photo, as 0-1 fractions of the image. */
export interface PhotoBox { x0: number; y0: number; x1: number; y1: number }
export interface PagePhoto { page_number: number; image_url: string }

export interface GroupStatus { complete: boolean; pages: ServerPage[]; failed_pages: number[]; result: BlockScanResult | null }

// The joined blocks, kept as the server sent them.
export interface BlockReviewSession { result: BlockScanResult; uploadIds: number[]; photos: PagePhoto[] }

export interface PagesSession { groupId: string | null; totalPages: number | null; blockReview?: BlockReviewSession | null }

/** group-status of a finished block scan -> what the block review shows; null while reading. */
export function blockReviewFrom(status: { complete?: boolean; pages?: ServerPage[]; result?: unknown } | null | undefined): BlockReviewSession | null {
  const result = status?.result as BlockScanResult | null | undefined;
  if (!status?.complete || !result || result.scan_mode !== 'blocks') return null;
  const pages = status.pages ?? [];
  return {
    result,
    uploadIds: pages.map((p) => p.upload_id).filter((x): x is number => !!x),
    photos: pages.filter((p) => !!p.image_url).map((p) => ({ page_number: p.page_number, image_url: p.image_url as string })),
  };
}

/** Every page read but no blocks: the pages were read by the old scanner before the update; scan them again. */
export const staleCapture = (status: { complete?: boolean; pages?: ServerPage[]; result?: unknown } | null | undefined): boolean =>
  !!status?.complete && blockReviewFrom(status) === null;

export const emptyPagesSession = (): PagesSession => ({ groupId: null, totalPages: null });

export function newGroupId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export const clampPages = (input: string): number => Math.max(1, Math.min(MAX_PAGES, parseInt(input, 10) || 1));

export type SlotState = 'empty' | 'queued' | 'uploading' | 'processing' | 'extracted' | 'failed';

export function slotState(local: 'queued' | 'uploading' | 'failed' | undefined, server: ServerPage | undefined): SlotState {
  if (local === 'queued' || local === 'uploading') return local;
  if (!server || server.status === 'MISSING') return local === 'failed' ? 'failed' : 'empty';
  if (server.status === 'EXTRACTED') return 'extracted';
  if (server.status === 'FAILED') return 'failed';
  return 'processing';
}

export const SLOT_LABEL: Record<SlotState, string> = {
  empty: 'No photo yet', queued: 'Waiting to upload…', uploading: 'Uploading…', processing: 'Reading the page…', extracted: 'Read', failed: 'Failed',
};
