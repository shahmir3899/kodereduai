// Pure logic for the Inventory screens; port of frontend/src/pages/inventory (Items, Transactions,
// Assignments, Reorder Prediction) and the rules in backend/inventory/serializers.py. The server
// re-checks everything; these checks only save a round trip and say what is wrong in plain words.

const num = (v: number | string | null | undefined) => Number(v ?? 0) || 0;

export const UNITS = [
  { value: 'PCS', label: 'Pieces' }, { value: 'PKT', label: 'Packets' }, { value: 'BOX', label: 'Boxes' },
  { value: 'KG', label: 'Kilograms' }, { value: 'LTR', label: 'Litres' }, { value: 'SET', label: 'Sets' },
  { value: 'REAM', label: 'Reams' }, { value: 'DZN', label: 'Dozens' }, { value: 'MTR', label: 'Meters' },
] as const;

export const CONDITIONS = [
  { value: 'NEW', label: 'New' }, { value: 'GOOD', label: 'Good' }, { value: 'FAIR', label: 'Fair' }, { value: 'POOR', label: 'Poor' },
] as const;

export interface Item {
  id: number;
  name: string;
  sku?: string;
  category: number | null;
  category_name?: string | null;
  unit: string;
  unit_display?: string;
  current_stock: number;
  minimum_stock: number;
  unit_price: number | string;
  stock_value?: number | string;
  location?: string;
  is_active: boolean;
  active_assignments_count?: number;
}

export interface Category { id: number; name: string; description?: string; is_active?: boolean }
export interface Vendor { id: number; name: string; contact_person?: string; phone?: string; is_active?: boolean }

export interface Movement {
  id: number;
  item: number;
  item_name: string;
  item_unit?: string;
  transaction_type: string;
  transaction_type_display?: string;
  quantity: number;
  unit_price?: number | string;
  total_amount?: number | string;
  vendor_name?: string | null;
  reference_number?: string;
  remarks?: string;
  date: string;
  recorded_by_name?: string | null;
}

export interface Assignment {
  id: number;
  item: number;
  item_name: string;
  item_unit?: string;
  assigned_to: number;
  assigned_to_name?: string;
  assigned_to_full_name?: string;
  quantity: number;
  assigned_date: string;
  returned_date?: string | null;
  condition_on_assign_display?: string;
  condition_on_return_display?: string;
  notes?: string;
  is_active: boolean;
}

export interface Dashboard {
  total_items: number;
  total_value: number;
  low_stock_count: number;
  active_assignments: number;
  total_categories: number;
  total_vendors: number;
  recent_transactions: Movement[];
  low_stock_items: Item[];
}

export interface ReorderItem {
  item_id: number;
  item_name: string;
  category_name?: string;
  current_stock: number;
  minimum_stock: number;
  avg_weekly_consumption: number | null;
  consumption_trend?: string;
  days_until_stockout: number | null;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  suggested_action?: string;
}

export interface ReorderResult {
  total_items: number;
  at_risk_count: number;
  risk_levels?: Record<string, number>;
  items: ReorderItem[];
}

// ─── Stock status (same thresholds as the web badge and the server's stock_status filter) ─────

export type StockStatus = 'out' | 'low' | 'ok';

export function stockStatus(item: Pick<Item, 'current_stock' | 'minimum_stock'>): StockStatus {
  if (item.current_stock <= 0) return 'out';
  return item.current_stock <= item.minimum_stock ? 'low' : 'ok';
}

export const STOCK_LABEL: Record<StockStatus, string> = { out: 'Out of stock', low: 'Low stock', ok: 'In stock' };
export const STOCK_TONE: Record<StockStatus, 'error' | 'warning' | 'success'> = { out: 'error', low: 'warning', ok: 'success' };

// ─── Movements ─────────────────────────────────────────────────────────────────────────────

// Issue and Return are written by assignments, so they are not offered here (as on the web).
export const MOVEMENT_TYPES = [
  { value: 'PURCHASE', label: 'Purchase', hint: 'Stock coming in from a vendor' },
  { value: 'ADJUSTMENT', label: 'Adjustment', hint: 'Correct the stock count' },
  { value: 'DISPOSAL', label: 'Disposal', hint: 'Damaged or expired items' },
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number]['value'];

export const ALL_TYPE_FILTERS = [
  { value: '', label: 'All' }, { value: 'PURCHASE', label: 'Purchase' }, { value: 'ISSUE', label: 'Issue' },
  { value: 'RETURN', label: 'Return' }, { value: 'ADJUSTMENT', label: 'Adjust' }, { value: 'DISPOSAL', label: 'Disposal' },
] as const;

export function movementTone(type: string): 'success' | 'error' | 'info' | 'neutral' | 'warning' {
  return type === 'PURCHASE' ? 'success' : type === 'ISSUE' ? 'error' : type === 'RETURN' ? 'info' : type === 'DISPOSAL' ? 'warning' : 'neutral';
}

export interface MovementForm {
  item: number | null;
  type: MovementType;
  // What the person typed. For an adjustment it is signed (+ in, - out); the others are positive.
  quantity: string;
  unitPrice: string;
  vendor: number | null;
  reference: string;
  remarks: string;
  date: string;
}

export const emptyMovementForm = (today: string): MovementForm => ({
  item: null, type: 'PURCHASE', quantity: '', unitPrice: '', vendor: null, reference: '', remarks: '', date: today,
});

// Disposals leave stock; purchases enter; an adjustment keeps the sign it was typed with.
export function signedQuantity(type: MovementType, typed: number): number {
  if (type === 'ADJUSTMENT') return typed;
  return type === 'DISPOSAL' ? -Math.abs(typed) : Math.abs(typed);
}

export const isWholeNumber = (text: string) => /^-?\d+$/.test(text.trim());

export function validateMovement(form: MovementForm, item: Pick<Item, 'current_stock'> | null): string | null {
  if (!form.item) return 'Choose an item.';
  if (!isWholeNumber(form.quantity)) return 'Enter the quantity as a whole number.';
  const typed = Number(form.quantity);
  if (typed === 0) return 'Quantity cannot be zero.';
  if (form.type !== 'ADJUSTMENT' && typed < 0) return 'Enter the quantity without a minus sign.';
  const qty = signedQuantity(form.type, typed);
  if (qty < 0 && item && Math.abs(qty) > item.current_stock) return `Not enough stock. Available: ${item.current_stock}.`;
  if (form.unitPrice.trim() && !(Number(form.unitPrice) >= 0)) return 'Unit price must be a number, zero or more.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.date)) return 'Choose a date.';
  return null;
}

export function buildMovementPayload(form: MovementForm, fallbackPrice: number | string = 0) {
  return {
    item: form.item,
    transaction_type: form.type,
    quantity: signedQuantity(form.type, Number(form.quantity)),
    unit_price: form.unitPrice.trim() ? Number(form.unitPrice) : num(fallbackPrice),
    // A vendor only means something on a purchase; the server drops it otherwise.
    vendor: form.type === 'PURCHASE' ? form.vendor : null,
    reference_number: form.reference.trim(),
    remarks: form.remarks.trim(),
    date: form.date,
  };
}

// ─── Items ─────────────────────────────────────────────────────────────────────────────────

export interface ItemForm {
  name: string;
  category: number | null;
  sku: string;
  unit: string;
  // Opening stock: only set when creating. Later changes go through movements so the ledger adds up.
  openingStock: string;
  minimumStock: string;
  unitPrice: string;
  location: string;
  isActive: boolean;
}

export const emptyItemForm = (): ItemForm => ({
  name: '', category: null, sku: '', unit: 'PCS', openingStock: '0', minimumStock: '5', unitPrice: '0', location: '', isActive: true,
});

export const itemToForm = (i: Item): ItemForm => ({
  name: i.name, category: i.category, sku: i.sku ?? '', unit: i.unit, openingStock: String(i.current_stock),
  minimumStock: String(i.minimum_stock), unitPrice: String(num(i.unit_price)), location: i.location ?? '', isActive: i.is_active,
});

export function validateItem(form: ItemForm, creating: boolean): string | null {
  if (!form.name.trim()) return 'Enter the item name.';
  if (creating && !/^\d+$/.test(form.openingStock.trim())) return 'Opening stock must be a whole number, zero or more.';
  if (!/^\d+$/.test(form.minimumStock.trim())) return 'Minimum stock must be a whole number, zero or more.';
  if (!(Number(form.unitPrice) >= 0) || form.unitPrice.trim() === '') return 'Unit price must be a number, zero or more.';
  return null;
}

export function buildItemPayload(form: ItemForm, creating: boolean) {
  return {
    name: form.name.trim(),
    category: form.category,
    sku: form.sku.trim(),
    unit: form.unit,
    minimum_stock: Number(form.minimumStock),
    unit_price: Number(form.unitPrice),
    location: form.location.trim(),
    is_active: form.isActive,
    ...(creating ? { current_stock: Number(form.openingStock) } : {}),
  };
}

export const itemLabel = (i: Pick<Item, 'name' | 'current_stock' | 'unit_display' | 'unit'>) =>
  `${i.name} (${i.current_stock} ${i.unit_display ?? i.unit})`;

// ─── Assignments ───────────────────────────────────────────────────────────────────────────

export interface AssignForm {
  item: number | null;
  user: number | null;
  quantity: string;
  condition: string;
  notes: string;
  date: string;
}

export const emptyAssignForm = (today: string): AssignForm => ({ item: null, user: null, quantity: '1', condition: 'GOOD', notes: '', date: today });

export function validateAssignment(form: AssignForm, item: Pick<Item, 'current_stock' | 'unit_display' | 'unit'> | null): string | null {
  if (!form.item) return 'Choose an item.';
  if (!form.user) return 'Choose who it is assigned to.';
  if (!/^\d+$/.test(form.quantity.trim()) || Number(form.quantity) < 1) return 'Quantity must be 1 or more.';
  if (item && Number(form.quantity) > item.current_stock) return `Not enough stock. Available: ${item.current_stock}.`;
  return null;
}

export const buildAssignmentPayload = (form: AssignForm) => ({
  item: form.item,
  assigned_to: form.user,
  quantity: Number(form.quantity),
  assigned_date: form.date,
  condition_on_assign: form.condition,
  notes: form.notes.trim(),
});

// Portal accounts and deactivated users cannot hold store items (same filter as the web picker).
export function assignableUsers<U extends { is_active: boolean; role?: string }>(users: U[]): U[] {
  return users.filter((u) => u.is_active && u.role !== 'STUDENT' && u.role !== 'PARENT');
}

export const personName = (u: { first_name?: string; last_name?: string; username: string }) =>
  [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username;

// Items still with the person come first, newest first within each group.
export const sortAssignmentsList = <T extends { is_active: boolean; assigned_date?: string | null }>(list: T[]): T[] =>
  [...list].sort((a, b) =>
    Number(!!b.is_active) - Number(!!a.is_active) || String(b.assigned_date ?? '').localeCompare(String(a.assigned_date ?? '')));

export const canReturn = (a: Pick<Assignment, 'is_active'>) => a.is_active;

// ─── Reorder prediction ────────────────────────────────────────────────────────────────────

export const SEVERITY_TONE: Record<ReorderItem['severity'], 'error' | 'warning' | 'info'> = { HIGH: 'error', MEDIUM: 'warning', LOW: 'info' };

export function stockoutText(days: number | null): string {
  if (days == null) return 'No recent usage';
  if (days <= 0) return 'Out now';
  return days === 1 ? 'About 1 day left' : `About ${days} days left`;
}

// ─── Server errors ─────────────────────────────────────────────────────────────────────────

// DRF answers { field: ["message"] } or { detail }; say the first message, with the field when it helps.
export function inventoryErrorMessage(error: unknown, fallback = 'Could not save. Try again.'): string {
  const e = error as { response?: { status?: number; data?: unknown } } | null;
  if (!e?.response) return 'No connection. Connect to the internet and try again.';
  if (e.response.status === 403) return 'Your role cannot do this.';
  const data = e.response.data;
  if (typeof data === 'string') return data.length < 200 && !data.trim().startsWith('<') ? data : fallback;
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    if (typeof obj.detail === 'string') return obj.detail;
    for (const value of Object.values(obj)) {
      const first = Array.isArray(value) ? value[0] : value;
      if (typeof first === 'string') return first;
    }
  }
  return fallback;
}
