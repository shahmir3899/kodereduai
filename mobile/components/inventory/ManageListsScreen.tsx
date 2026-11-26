import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, type RefreshControlProps } from 'react-native';
import { useCategories, useInventoryActions, useVendors } from '../../hooks/useInventory';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import {
  categoryDeleteMessage, categoryPayload, categoryToForm, inventoryErrorMessage, validateNamed, vendorPayload, vendorToForm,
  type Category, type CategoryForm, type Vendor, type VendorForm,
} from '../../services/inventory';
import SegmentedTabs from '../ui/SegmentedTabs';
import Input from '../ui/Input';
import Button from '../ui/Button';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import { useToast } from '../ui/Toast';
import { confirm } from '../ui/confirm';
import FormSheet from './FormSheet';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';
import AppList from '../ui/AppList';

type Tab = 'categories' | 'vendors';
const TABS: Array<{ value: Tab; label: string }> = [{ value: 'categories', label: 'Categories' }, { value: 'vendors', label: 'Vendors' }];

// The web Items page's "Categories" and "Vendors" panels: list, add, edit, delete. Admin and principal
// (the route sits in the admin stack). Deleting a category also deletes its items on the server, so the
// confirm says how many.
export default function ManageListsScreen() {
  const toast = useToast();
  const actions = useInventoryActions();
  const categories = useCategories();
  const vendors = useVendors();
  const [tab, setTab] = useState<Tab>('categories');
  const query = tab === 'categories' ? categories : vendors;
  const refreshControl = useRefreshControl(query.refetch) as React.ReactElement<RefreshControlProps>;

  const [catEdit, setCatEdit] = useState<Category | 'new' | null>(null);
  const [catForm, setCatForm] = useState<CategoryForm>(categoryToForm());
  const [venEdit, setVenEdit] = useState<Vendor | 'new' | null>(null);
  const [venForm, setVenForm] = useState<VendorForm>(vendorToForm());
  const [error, setError] = useState<string | null>(null);

  const openCategory = (c: Category | 'new') => { setError(null); setCatForm(categoryToForm(c === 'new' ? undefined : c)); setCatEdit(c); };
  const openVendor = (v: Vendor | 'new') => { setError(null); setVenForm(vendorToForm(v === 'new' ? undefined : v)); setVenEdit(v); };

  const saveCategory = async () => {
    const problem = validateNamed(catForm, 'category');
    if (problem) return setError(problem);
    try {
      if (catEdit === 'new') await actions.createCategory.mutateAsync({ ...categoryPayload(catForm), is_active: true });
      else await actions.updateCategory.mutateAsync({ id: (catEdit as Category).id, data: categoryPayload(catForm) });
      toast.success(catEdit === 'new' ? 'Category added.' : 'Category saved.');
      setCatEdit(null);
    } catch (e) { setError(inventoryErrorMessage(e)); }
  };
  const saveVendor = async () => {
    const problem = validateNamed(venForm, 'vendor');
    if (problem) return setError(problem);
    try {
      if (venEdit === 'new') await actions.createVendor.mutateAsync({ ...vendorPayload(venForm), is_active: true });
      else await actions.updateVendor.mutateAsync({ id: (venEdit as Vendor).id, data: vendorPayload(venForm) });
      toast.success(venEdit === 'new' ? 'Vendor added.' : 'Vendor saved.');
      setVenEdit(null);
    } catch (e) { setError(inventoryErrorMessage(e)); }
  };

  const deleteCategory = async (c: Category) => {
    if (!(await confirm({ title: 'Delete category', message: categoryDeleteMessage(c), confirmLabel: 'Delete', destructive: true }))) return;
    try {
      await actions.deleteCategory.mutateAsync(c.id);
      toast.success('Category deleted.');
      setCatEdit(null);
    } catch (e) { toast.error(inventoryErrorMessage(e, 'Could not delete the category.')); }
  };
  const deleteVendor = async (v: Vendor) => {
    if (!(await confirm({ title: 'Delete vendor', message: `Delete "${v.name}"? Purchases that named this vendor keep their record without it. This cannot be undone.`, confirmLabel: 'Delete', destructive: true }))) return;
    try {
      await actions.deleteVendor.mutateAsync(v.id);
      toast.success('Vendor deleted.');
      setVenEdit(null);
    } catch (e) { toast.error(inventoryErrorMessage(e, 'Could not delete the vendor.')); }
  };

  const header = (
    <View style={styles.header}>
      <SegmentedTabs tabs={TABS} value={tab} onChange={setTab} />
      <Button title={tab === 'categories' ? '+ Add category' : '+ Add vendor'} size="sm"
        onPress={() => (tab === 'categories' ? openCategory('new') : openVendor('new'))} />
    </View>
  );

  return (
    <View style={styles.container}>
      {query.isLoading ? <View style={styles.content}>{header}<Skeleton variant="list" /></View>
        : query.isError && !query.data ? <ErrorState error={query.error} onRetry={() => query.refetch()} />
        : (
          <AppList<Category | Vendor>
            contentContainerStyle={styles.content}
            data={(query.data ?? []) as Array<Category | Vendor>}
            keyExtractor={(r) => `${tab}-${r.id}`}
            refreshControl={refreshControl}
            ListHeaderComponent={header}
            ListEmptyComponent={<EmptyState title={tab === 'categories' ? 'No categories' : 'No vendors'} message="Add one with the button above." />}
            renderItem={({ item }) => {
              const isCat = tab === 'categories';
              const c = item as Category;
              const v = item as Vendor;
              const sub = isCat
                ? [c.description, `${c.items_count ?? 0} item${c.items_count === 1 ? '' : 's'}`].filter(Boolean).join('  ·  ')
                : [v.contact_person, v.phone, v.email].filter(Boolean).join('  ·  ') || 'No contact details';
              return (
                <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Edit ${item.name}`} style={styles.row}
                  onPress={() => (isCat ? openCategory(c) : openVendor(v))}>
                  <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
                  <Text style={styles.sub} numberOfLines={1}>{sub}</Text>
                </TouchableOpacity>
              );
            }}
          />
        )}

      <FormSheet visible={catEdit !== null} title={catEdit === 'new' ? 'Add category' : 'Edit category'} onClose={() => setCatEdit(null)}
        onSubmit={saveCategory} submitLabel={catEdit === 'new' ? 'Add category' : 'Save changes'} error={error}
        busy={actions.createCategory.isPending || actions.updateCategory.isPending || actions.deleteCategory.isPending}
        secondaryLabel={catEdit && catEdit !== 'new' ? 'Delete category' : undefined}
        onSecondary={catEdit && catEdit !== 'new' ? () => deleteCategory(catEdit) : undefined}>
        <Input label="Name" value={catForm.name} onChangeText={(t) => setCatForm((f) => ({ ...f, name: t }))} />
        <Input label="Description (optional)" value={catForm.description} multiline onChangeText={(t) => setCatForm((f) => ({ ...f, description: t }))} />
      </FormSheet>

      <FormSheet visible={venEdit !== null} title={venEdit === 'new' ? 'Add vendor' : 'Edit vendor'} onClose={() => setVenEdit(null)}
        onSubmit={saveVendor} submitLabel={venEdit === 'new' ? 'Add vendor' : 'Save changes'} error={error}
        busy={actions.createVendor.isPending || actions.updateVendor.isPending || actions.deleteVendor.isPending}
        secondaryLabel={venEdit && venEdit !== 'new' ? 'Delete vendor' : undefined}
        onSecondary={venEdit && venEdit !== 'new' ? () => deleteVendor(venEdit) : undefined}>
        <Input label="Name" value={venForm.name} onChangeText={(t) => setVenForm((f) => ({ ...f, name: t }))} />
        <Input label="Contact person (optional)" value={venForm.contactPerson} onChangeText={(t) => setVenForm((f) => ({ ...f, contactPerson: t }))} />
        <Input label="Phone (optional)" value={venForm.phone} keyboardType="phone-pad" onChangeText={(t) => setVenForm((f) => ({ ...f, phone: t }))} />
        <Input label="Email (optional)" value={venForm.email} keyboardType="email-address" autoCapitalize="none" onChangeText={(t) => setVenForm((f) => ({ ...f, email: t }))} />
        <Input label="Address (optional)" value={venForm.address} multiline onChangeText={(t) => setVenForm((f) => ({ ...f, address: t }))} />
      </FormSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl, gap: Spacing.sm },
  header: { gap: Spacing.sm, marginBottom: Spacing.sm },
  row: { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, minHeight: 56, justifyContent: 'center' },
  name: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
});
