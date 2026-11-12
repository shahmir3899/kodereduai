import React, { useState } from 'react';
import { View, Text, ScrollView, Switch, TouchableOpacity, StyleSheet } from 'react-native';
import { useHostelActions, useHostels, useRooms } from '../../hooks/useHostel';
import { useStaffPicker } from '../../hooks/useHrAdmin';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import {
  HOSTEL_TYPES, ROOM_TYPES, buildHostelPayload, buildRoomPayload, deleteHostelText, deleteRoomText, emptyHostelForm, emptyRoomForm, hostelLine, hostelToForm,
  roomLine, roomToForm, validateHostel, validateRoom, type HostelForm, type HostelRow, type RoomForm, type RoomRow,
} from '../../services/hostel';
import { inventoryErrorMessage } from '../../services/inventory';
import Select from '../ui/Select';
import Input from '../ui/Input';
import Button from '../ui/Button';
import Card from '../ui/Card';
import QueryBoundary from '../ui/QueryBoundary';
import StatusPill from '../ui/StatusPill';
import { useToast } from '../ui/Toast';
import { confirm } from '../ui/confirm';
import FormSheet from '../inventory/FormSheet';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

// Hostels and their rooms: add, edit and delete each. Admin and principal only. The server refuses a
// room smaller than its occupants, a duplicate room number and deleting a hostel or room in use.
export default function HostelsRoomsScreen() {
  const toast = useToast();
  const actions = useHostelActions();
  const hostels = useHostels();
  const staff = useStaffPicker();
  const refreshControl = useRefreshControl(hostels.refetch);
  const [open, setOpen] = useState<number | null>(null);

  const [hostel, setHostel] = useState<HostelRow | 'new' | null>(null);
  const [hForm, setHForm] = useState<HostelForm>(emptyHostelForm());
  const [hError, setHError] = useState<string | null>(null);
  const setH = <K extends keyof HostelForm>(k: K, v: HostelForm[K]) => setHForm((f) => ({ ...f, [k]: v }));

  const [room, setRoom] = useState<{ hostel: number; room: RoomRow | null } | null>(null);
  const [rForm, setRForm] = useState<RoomForm>(emptyRoomForm());
  const [rError, setRError] = useState<string | null>(null);
  const setR = <K extends keyof RoomForm>(k: K, v: RoomForm[K]) => setRForm((f) => ({ ...f, [k]: v }));

  const openHostel = (h: HostelRow | 'new') => { setHError(null); setHForm(h === 'new' ? emptyHostelForm() : hostelToForm(h)); setHostel(h); };
  const hostelExisting = hostel && hostel !== 'new' ? hostel : null;

  const saveHostel = async () => {
    const problem = validateHostel(hForm);
    if (problem) return setHError(problem);
    setHError(null);
    try {
      if (hostelExisting) await actions.updateHostel.mutateAsync({ id: hostelExisting.id, data: buildHostelPayload(hForm) });
      else await actions.createHostel.mutateAsync(buildHostelPayload(hForm));
      toast.success(hostelExisting ? 'Hostel saved.' : 'Hostel added.');
      setHostel(null);
    } catch (e) { setHError(inventoryErrorMessage(e)); }
  };

  const removeHostel = async () => {
    if (!hostelExisting) return;
    if (!(await confirm({ title: 'Delete this hostel?', message: deleteHostelText(hostelExisting), confirmLabel: 'Delete', destructive: true }))) return;
    try { await actions.deleteHostel.mutateAsync(hostelExisting.id); toast.success('Hostel deleted.'); setHostel(null); }
    catch (e) { setHError(inventoryErrorMessage(e, 'Could not delete the hostel.')); }
  };

  const openRoom = (hostelId: number, r: RoomRow | null) => { setRError(null); setRForm(r ? roomToForm(r) : emptyRoomForm()); setRoom({ hostel: hostelId, room: r }); };

  const saveRoom = async () => {
    if (!room) return;
    const problem = validateRoom(rForm, room.room);
    if (problem) return setRError(problem);
    setRError(null);
    try {
      if (room.room) await actions.updateRoom.mutateAsync({ id: room.room.id, data: buildRoomPayload(room.hostel, rForm) });
      else await actions.createRoom.mutateAsync(buildRoomPayload(room.hostel, rForm));
      toast.success(room.room ? 'Room saved.' : 'Room added.');
      setRoom(null);
    } catch (e) { setRError(inventoryErrorMessage(e)); }
  };

  const removeRoom = async () => {
    if (!room?.room) return;
    if (!(await confirm({ title: 'Delete this room?', message: deleteRoomText(room.room), confirmLabel: 'Delete', destructive: true }))) return;
    try { await actions.deleteRoom.mutateAsync(room.room.id); toast.success('Room deleted.'); setRoom(null); }
    catch (e) { setRError(inventoryErrorMessage(e, 'Could not delete the room.')); }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} refreshControl={refreshControl} keyboardShouldPersistTaps="handled">
      <Button title="+ Add a hostel" size="sm" onPress={() => openHostel('new')} />
      <QueryBoundary query={hostels} emptyTitle="No hostels" emptyMessage="Add the first hostel, then its rooms.">
        {(list) => list.map((h) => (
          <Card key={h.id} style={styles.card}>
            <TouchableOpacity accessibilityRole="button" onPress={() => openHostel(h)}>
              <View style={styles.head}>
                <Text style={styles.name}>{h.name}</Text>
                {!h.is_active ? <StatusPill label="Inactive" tone="neutral" /> : null}
              </View>
              <Text style={styles.sub}>{hostelLine(h)}</Text>
            </TouchableOpacity>
            <Button title={open === h.id ? 'Hide rooms' : `Rooms (${h.rooms_count ?? 0})`} size="sm" variant="outline" onPress={() => setOpen(open === h.id ? null : h.id)} />
            {open === h.id ? <Rooms hostel={h.id} onOpen={openRoom} /> : null}
          </Card>
        ))}
      </QueryBoundary>

      <FormSheet visible={hostel !== null} title={hostelExisting ? 'Edit hostel' : 'Add a hostel'} onClose={() => setHostel(null)} onSubmit={saveHostel} submitLabel="Save"
        busy={actions.createHostel.isPending || actions.updateHostel.isPending} error={hError}>
        <Input label="Name" value={hForm.name} onChangeText={(v) => setH('name', v)} />
        <Select label="Type" value={hForm.type} onChange={(v) => setH('type', String(v))} options={HOSTEL_TYPES} />
        <Input label="Capacity (beds)" value={hForm.capacity} onChangeText={(v) => setH('capacity', v)} keyboardType="number-pad" />
        <Select<number | ''> label="Warden" searchable value={hForm.warden ?? ''} onChange={(v) => setH('warden', v === '' ? null : Number(v))} placeholder="No warden"
          options={[{ value: '', label: 'No warden' }, ...(staff.data ?? []).map((s) => ({ value: s.id, label: s.full_name }))]} />
        <Input label="Address (optional)" value={hForm.address} onChangeText={(v) => setH('address', v)} multiline />
        <Input label="Contact number (optional)" value={hForm.contact} onChangeText={(v) => setH('contact', v)} keyboardType="phone-pad" />
        <View style={styles.toggle}><Text style={styles.label}>Active</Text><Switch value={hForm.active} onValueChange={(v) => setH('active', v)} accessibilityLabel="Active" /></View>
        {hostelExisting ? <Button title="Delete hostel" variant="danger" size="sm" onPress={removeHostel} loading={actions.deleteHostel.isPending} /> : null}
      </FormSheet>

      <FormSheet visible={room !== null} title={room?.room ? 'Edit room' : 'Add a room'} onClose={() => setRoom(null)} onSubmit={saveRoom} submitLabel="Save"
        busy={actions.createRoom.isPending || actions.updateRoom.isPending} error={rError}>
        <Input label="Room number" value={rForm.number} onChangeText={(v) => setR('number', v)} autoCapitalize="characters" />
        <Input label="Floor (0 = ground)" value={rForm.floor} onChangeText={(v) => setR('floor', v)} keyboardType="number-pad" />
        <Select label="Type" value={rForm.type} onChange={(v) => setR('type', String(v))} options={ROOM_TYPES} />
        <Input label="Capacity (beds)" value={rForm.capacity} onChangeText={(v) => setR('capacity', v)} keyboardType="number-pad" />
        <View style={styles.toggle}><Text style={styles.label}>Available for allocation</Text><Switch value={rForm.available} onValueChange={(v) => setR('available', v)} accessibilityLabel="Available for allocation" /></View>
        {room?.room ? <Button title="Delete room" variant="danger" size="sm" onPress={removeRoom} loading={actions.deleteRoom.isPending} /> : null}
      </FormSheet>
    </ScrollView>
  );
}

function Rooms({ hostel, onOpen }: { hostel: number; onOpen: (hostel: number, r: RoomRow | null) => void }) {
  const q = useRooms(hostel);
  return (
    <View style={styles.rooms}>
      {q.isLoading ? <Text style={styles.sub}>Loading rooms...</Text> : null}
      {q.isError ? <Text style={styles.sub}>Could not load the rooms.</Text> : null}
      {(q.data ?? []).map((r) => (
        <TouchableOpacity key={r.id} accessibilityRole="button" style={styles.room} onPress={() => onOpen(hostel, r)}>
          <View style={styles.flex}><Text style={styles.label}>{`Room ${r.room_number}`}</Text><Text style={styles.sub}>{roomLine(r)}</Text></View>
          {r.is_full ? <StatusPill label="Full" tone="warning" /> : !r.is_available ? <StatusPill label="Not available" tone="neutral" /> : null}
        </TouchableOpacity>
      ))}
      {q.data && q.data.length === 0 ? <Text style={styles.sub}>No rooms yet.</Text> : null}
      <Button title="+ Add a room" size="sm" variant="ghost" onPress={() => onOpen(hostel, null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl, gap: Spacing.md },
  card: { gap: Spacing.sm },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  name: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  label: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  flex: { flex: 1 },
  rooms: { gap: Spacing.xs },
  room: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.md, padding: Spacing.md },
  toggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
