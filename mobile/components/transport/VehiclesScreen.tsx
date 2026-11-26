import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useAuth } from '../../contexts/AuthContext';
import { useRoutes, useTransportActions, useVehicles } from '../../hooks/useTransport';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import {
  VEHICLE_TYPES, driverLine, validateVehicle, vehicleErrorMessage, vehicleLine, vehiclePayload, vehicleToForm, type VehicleForm, type VehicleRow,
} from '../../services/transportAdmin';
import { inventoryErrorMessage } from '../../services/inventory';
import Button from '../ui/Button';
import Card from '../ui/Card';
import Input from '../ui/Input';
import Select from '../ui/Select';
import QueryBoundary from '../ui/QueryBoundary';
import StatusPill from '../ui/StatusPill';
import { useToast } from '../ui/Toast';
import { confirm } from '../ui/confirm';
import FormSheet from '../inventory/FormSheet';
import { Colors, FontSize, Spacing } from '../../constants/colors';

const NO_ROUTE = 0;

// The school's vehicles and their drivers (web VehiclesPage). Admin and principal add, edit and
// delete; a teacher sees the list read-only (the server refuses their writes anyway).
export default function VehiclesScreen() {
  const { isSchoolAdminNav: canManage } = useAuth();
  const toast = useToast();
  const vehicles = useVehicles();
  const routes = useRoutes();
  const actions = useTransportActions();
  const refreshControl = useRefreshControl(vehicles.refetch);
  const [editing, setEditing] = useState<VehicleRow | 'new' | null>(null);
  const [form, setForm] = useState<VehicleForm>(vehicleToForm());
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof VehicleForm>(k: K, v: VehicleForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  const open = (v: VehicleRow | 'new') => {
    if (!canManage) return;
    setError(null);
    setForm(vehicleToForm(v === 'new' ? undefined : v));
    setEditing(v);
  };

  const save = async () => {
    const problem = validateVehicle(form);
    if (problem) return setError(problem);
    try {
      if (editing === 'new') await actions.createVehicle.mutateAsync(vehiclePayload(form));
      else await actions.updateVehicle.mutateAsync({ id: (editing as VehicleRow).id, data: vehiclePayload(form) });
      toast.success(editing === 'new' ? 'Vehicle added.' : 'Vehicle saved.');
      setEditing(null);
    } catch (e) { setError(vehicleErrorMessage(e) ?? inventoryErrorMessage(e)); }
  };

  const remove = async (v: VehicleRow) => {
    if (!(await confirm({ title: 'Delete vehicle', message: `Delete ${v.vehicle_number}? Students assigned to it keep their route and stop without a vehicle. This cannot be undone.`, confirmLabel: 'Delete', destructive: true }))) return;
    try {
      await actions.deleteVehicle.mutateAsync(v.id);
      toast.success('Vehicle deleted.');
      setEditing(null);
    } catch (e) { setError(inventoryErrorMessage(e, 'Could not delete the vehicle.')); }
  };

  const busy = actions.createVehicle.isPending || actions.updateVehicle.isPending || actions.deleteVehicle.isPending;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} refreshControl={refreshControl} keyboardShouldPersistTaps="handled">
      {canManage ? <Button title="+ Add vehicle" size="sm" onPress={() => open('new')} /> : null}
      <QueryBoundary query={vehicles} emptyTitle="No vehicles" emptyMessage={canManage ? 'Add the first vehicle and its driver.' : 'No vehicles yet.'}>
        {(list) => list.map((v) => (
          <TouchableOpacity key={v.id} accessibilityRole="button" accessibilityLabel={canManage ? `Edit ${v.vehicle_number}` : v.vehicle_number}
            disabled={!canManage} onPress={() => open(v)}>
            <Card style={styles.card}>
              <View style={styles.head}>
                <Text style={styles.name}>{v.vehicle_number}</Text>
                <StatusPill label={v.route_name || 'No route'} tone={v.route_name ? 'info' : 'neutral'} />
              </View>
              <Text style={styles.sub}>{vehicleLine(v)}</Text>
              <Text style={styles.sub}>{driverLine(v)}{v.driver_license ? `  ·  Licence ${v.driver_license}` : ''}</Text>
            </Card>
          </TouchableOpacity>
        ))}
      </QueryBoundary>

      <FormSheet visible={editing !== null} title={editing === 'new' ? 'Add vehicle' : 'Edit vehicle'} onClose={() => setEditing(null)}
        onSubmit={save} submitLabel={editing === 'new' ? 'Add vehicle' : 'Save changes'} busy={busy} error={error}
        secondaryLabel={editing && editing !== 'new' ? 'Delete vehicle' : undefined}
        onSecondary={editing && editing !== 'new' ? () => remove(editing) : undefined}>
        <Input label="Vehicle number" value={form.number} autoCapitalize="characters" placeholder="e.g. ABC-1234" onChangeText={(t) => set('number', t)} />
        <Select label="Type" value={form.type} options={VEHICLE_TYPES.map((t) => ({ value: t.value, label: t.label }))} onChange={(v) => set('type', String(v))} />
        <Input label="Capacity (seats)" value={form.capacity} keyboardType="number-pad" placeholder="e.g. 40" onChangeText={(t) => set('capacity', t)} />
        <Input label="Make / model (optional)" value={form.makeModel} placeholder="e.g. Toyota Coaster" onChangeText={(t) => set('makeModel', t)} />
        <Select label="Assigned route" value={form.route ?? NO_ROUTE}
          options={[{ value: NO_ROUTE, label: 'No route' }, ...(routes.data ?? []).map((r) => ({ value: r.id, label: r.name }))]}
          onChange={(v) => set('route', v === NO_ROUTE ? null : Number(v))} />
        <Input label="Driver name" value={form.driverName} placeholder="Full name" onChangeText={(t) => set('driverName', t)} />
        <Input label="Driver phone" value={form.driverPhone} keyboardType="phone-pad" placeholder="0300-1234567" onChangeText={(t) => set('driverPhone', t)} />
        <Input label="Driver licence number (optional)" value={form.driverLicense} onChangeText={(t) => set('driverLicense', t)} />
      </FormSheet>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl, gap: Spacing.sm },
  card: { gap: 2 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  name: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text, flexShrink: 1 },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary },
});
