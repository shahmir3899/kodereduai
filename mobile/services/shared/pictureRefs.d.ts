// Types for pictureRefs.js, a generated copy of the web's frontend/src/pages/examinations/blocks/pictureRefs.js.
import type { PictureRef } from './blockDocument';

export interface CatalogEntry { name: string; en: string; ur?: string; url: string; category?: string }
export interface UploadEntry { id: number; label: string; image_url: string }
export interface MakerField { type: string; optional?: boolean; choices?: string[]; min?: number; max?: number; example?: string }
export interface Maker { kind: string; label: string; fields: Record<string, MakerField> }

export function describePicture(
  ref: PictureRef | null | undefined,
  lookups?: { catalog?: CatalogEntry[]; uploads?: UploadEntry[] },
): { label: string; image: string | null } | null;
export function makerDefaults(maker: Maker | null | undefined): Record<string, unknown>;
export function setMakerValue(values: Record<string, unknown>, name: string, value: unknown): Record<string, unknown>;
/** Library pictures from typed names ("butterfly 3, flower 2"): exact names only; the rest come back in ``unknown``. */
export function picturesFromNames(text: unknown, catalog?: Array<{ name: string; en?: string; ur?: string }>): {
  found: Array<{ picture: string; count?: number }>;
  unknown: string[];
};
