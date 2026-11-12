import React, { useEffect, useState } from 'react';
import { View, Text, Switch, StyleSheet } from 'react-native';
import { useTransportActions } from '../../hooks/useTransport';
import {
  buildRoutePayload, deleteRouteText, emptyRouteForm, pinText, routeToForm, validateRoute, type RouteForm, type RouteRow,
} from '../../services/routeMap';
import { inventoryErrorMessage } from '../../services/inventory';
import Input from '../ui/Input';
import Button from '../ui/Button';
import { useToast } from '../ui/Toast';
import { confirm } from '../ui/confirm';
import FormSheet from '../inventory/FormSheet';
import LocationPickerSheet from '../map/LocationPickerSheet';
import { Colors, FontSize, Spacing } from '../../constants/colors';

interface Props { visible: boolean; route: RouteRow | null; onClose: () => void; onDeleted?: () => void }

// Add or edit a route: name, where it starts and ends (with a map pin each), distance and trip time.
// Admin and principal only. The server refuses deleting a route that has students on it.
export default function RouteFormSheet({ visible, route, onClose, onDeleted }: Props) {
  const toast = useToast();
  const actions = useTransportActions();
  const [form, setForm] = useState<RouteForm>(emptyRouteForm());
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState<'start' | 'end' | null>(null);
  const set = <K extends keyof RouteForm>(k: K, v: RouteForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => { if (visible) { setForm(route ? routeToForm(route) : emptyRouteForm()); setError(null); } }, [visible, route]);

  const save = async () => {
    const problem = validateRoute(form);
    if (problem) return setError(problem);
    setError(null);
    try {
      if (route) await actions.updateRoute.mutateAsync({ id: route.id, data: buildRoutePayload(form) });
      else await actions.createRoute.mutateAsync(buildRoutePayload(form));
      toast.success(route ? 'Route saved.' : 'Route added.');
      onClose();
    } catch (e) { setError(inventoryErrorMessage(e)); }
  };

  const remove = async () => {
    if (!route) return;
    if (!(await confirm({ title: 'Delete this route?', message: deleteRouteText(route), confirmLabel: 'Delete', destructive: true }))) return;
    try { await actions.deleteRoute.mutateAsync(route.id); toast.success('Route deleted.'); onClose(); onDeleted?.(); }
    catch (e) { setError(inventoryErrorMessage(e, 'Could not delete the route.')); }
  };

  return (
    <>
      <FormSheet visible={visible && picking === null} title={route ? 'Edit route' : 'Add a route'} onClose={onClose} onSubmit={save} submitLabel="Save"
        busy={actions.createRoute.isPending || actions.updateRoute.isPending} error={error}>
        <Input label="Route name" value={form.name} onChangeText={(v) => set('name', v)} />
        <Input label="Description (optional)" value={form.description} onChangeText={(v) => set('description', v)} multiline />
        <Input label="Starts at" value={form.startLocation} onChangeText={(v) => set('startLocation', v)} />
        <View style={styles.pinRow}><Text style={styles.pin}>{pinText(form.startPin)}</Text><Button title="Set on map" size="sm" variant="outline" onPress={() => setPicking('start')} /></View>
        <Input label="Ends at" value={form.endLocation} onChangeText={(v) => set('endLocation', v)} />
        <View style={styles.pinRow}><Text style={styles.pin}>{pinText(form.endPin)}</Text><Button title="Set on map" size="sm" variant="outline" onPress={() => setPicking('end')} /></View>
        <Input label="Distance (km)" value={form.distance} onChangeText={(v) => set('distance', v)} keyboardType="decimal-pad" />
        <Input label="Trip time (minutes)" value={form.duration} onChangeText={(v) => set('duration', v)} keyboardType="number-pad" />
        <View style={styles.pinRow}><Text style={styles.label}>Active</Text><Switch value={form.active} onValueChange={(v) => set('active', v)} accessibilityLabel="Active" /></View>
        {route ? <Button title="Delete route" variant="danger" size="sm" onPress={remove} loading={actions.deleteRoute.isPending} /> : null}
      </FormSheet>

      <LocationPickerSheet visible={visible && picking !== null} title={picking === 'end' ? 'Where the route ends' : 'Where the route starts'}
        initial={picking === 'end' ? form.endPin : form.startPin} onClose={() => setPicking(null)}
        onUse={(p) => { if (picking === 'end') set('endPin', p); else set('startPin', p); setPicking(null); }} />
    </>
  );
}

const styles = StyleSheet.create({
  pinRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  pin: { flex: 1, fontSize: FontSize.sm, color: Colors.textSecondary },
  label: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
});
