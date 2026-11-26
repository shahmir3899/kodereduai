import React, { useEffect, useRef, useState } from 'react';
import { FlatList, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import BottomSheet from '../../ui/BottomSheet';
import SegmentedTabs from '../../ui/SegmentedTabs';
import SearchBar from '../../ui/SearchBar';
import Input from '../../ui/Input';
import Select from '../../ui/Select';
import Button from '../../ui/Button';
import { useToast } from '../../ui/Toast';
import { confirm } from '../../ui/confirm';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { usePaperPictureActions, usePaperPictures, usePictureCatalog } from '../../../hooks/useBlockPaper';
import { describePicture, makerDefaults, setMakerValue, type Maker } from '../../../services/shared/pictureRefs';
import type { PictureRef } from '../../../services/shared/blockDocument';
import { pictureFileProblem, thumbUrl } from '../../../services/blockPaper';
import { appendFile } from '../../../services/formFile';
import { inventoryErrorMessage } from '../../../services/inventory';
import { Colors, FontSize, Spacing, BorderRadius } from '../../../constants/colors';

type Tab = 'library' | 'uploads' | 'create';

// The picture chooser, as on the web (blocks/PicturePicker.jsx): the library (search in English or Urdu), the
// school's own pictures (take or choose a photo, crop it with the phone's crop step, upload), or a picture drawn by
// the server's code. Picking hands back the reference the paper stores.
export default function PicturePickerSheet({ visible, onClose, onPick, allowCreate = true }: {
  visible: boolean; onClose: () => void; onPick: (ref: PictureRef) => void; allowCreate?: boolean;
}) {
  const [tab, setTab] = useState<Tab>('library');
  const pick = (ref: PictureRef) => { onPick(ref); onClose(); };
  const tabs: Array<{ value: Tab; label: string }> = [
    { value: 'library', label: 'Library' }, { value: 'uploads', label: 'My pictures' },
    ...(allowCreate ? [{ value: 'create' as Tab, label: 'Create' }] : []),
  ];
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Choose a picture">
      <View style={styles.body}>
        <SegmentedTabs tabs={tabs} value={tab} onChange={setTab} />
        {tab === 'library' ? <LibraryTab onPick={pick} /> : null}
        {tab === 'uploads' ? <UploadsTab onPick={pick} /> : null}
        {tab === 'create' ? <CreateTab onPick={pick} /> : null}
      </View>
    </BottomSheet>
  );
}

function Tile({ uri, label, sub, onPress, onLongPress, a11y }: { uri: string | null; label: string; sub?: string; onPress: () => void; onLongPress?: () => void; a11y: string }) {
  return (
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={a11y} style={styles.tile} onPress={onPress} onLongPress={onLongPress}>
      {uri ? <Image source={{ uri }} style={styles.thumb} contentFit="contain" /> : <View style={styles.thumb} />}
      <Text style={styles.tileText} numberOfLines={1}>{label}</Text>
      {sub ? <Text style={styles.tileSub} numberOfLines={1}>{sub}</Text> : null}
    </TouchableOpacity>
  );
}

function LibraryTab({ onPick }: { onPick: (ref: PictureRef) => void }) {
  const [search, setSearch] = useState('');
  const term = useDebouncedValue(search.trim(), 300);
  const query = usePictureCatalog(term);
  const pictures = query.data?.library ?? [];
  // The keyboard's search key picks the picture asked for (exact name first), as Enter does on the web (demo findings B3).
  // A search key pressed before the results caught up is remembered and done when they arrive.
  const pendingEnter = useRef(false);
  const pickBest = () => {
    const wanted = search.trim().toLowerCase();
    if (!wanted) return;
    if (term !== search.trim() || query.isFetching) { pendingEnter.current = true; return; }
    pendingEnter.current = false;
    if (!pictures.length) return;
    const exact = pictures.find((p) => String(p.en || '').toLowerCase() === wanted || p.ur === search.trim());
    onPick((exact ?? pictures[0]).name);
  };
  useEffect(() => {
    if (pendingEnter.current && term === search.trim() && !query.isFetching) pickBest();
  });
  return (
    <View style={styles.gap}>
      <SearchBar value={search} onChangeText={setSearch} onSubmitEditing={pickBest} placeholder="Search in English or Urdu, e.g. apple, سیب" />
      <FlatList
        data={pictures} keyExtractor={(p) => p.name} numColumns={3} style={styles.grid} keyboardShouldPersistTaps="handled"
        initialNumToRender={18} windowSize={5}
        ListEmptyComponent={<Text style={styles.hint}>{query.isLoading ? 'Loading pictures…' : `No picture matches “${term}”. Try another word, or upload your own.`}</Text>}
        renderItem={({ item }) => <Tile uri={thumbUrl(item.url)} label={item.en} sub={item.ur} a11y={`Use ${item.en}`} onPress={() => onPick(item.name)} />}
      />
    </View>
  );
}

function UploadsTab({ onPick }: { onPick: (ref: PictureRef) => void }) {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const term = useDebouncedValue(search.trim(), 300);
  const query = usePaperPictures(term);
  const actions = usePaperPictureActions();
  const [source, setSource] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [label, setLabel] = useState('');
  const [clean, setClean] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const choose = async (camera: boolean) => {
    setError(null);
    const perm = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return setError(camera ? 'Allow the camera in your phone settings.' : 'Allow photo access in your phone settings.');
    // allowsEditing gives the phone's own crop step before anything is uploaded (the web shows its crop box).
    const options = { mediaTypes: ['images'] as ImagePicker.MediaType[], allowsEditing: true, quality: 0.85 };
    const result = camera ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    const problem = pictureFileProblem(asset.mimeType, asset.fileSize);
    if (problem) return setError(problem);
    setSource(asset);
    setLabel((asset.fileName ?? '').replace(/\.[^.]+$/, '') || 'picture');
  };

  const upload = async () => {
    if (!source) return;
    try {
      const form = new FormData();
      const type = source.mimeType ?? 'image/jpeg';
      await appendFile(form, 'file', { uri: source.uri, name: source.fileName ?? `picture.${type.includes('png') ? 'png' : 'jpg'}`, type });
      form.append('label', label.trim());
      if (!clean) form.append('clean', 'false');
      const res = await actions.upload.mutateAsync(form);
      toast.success('Picture saved to your school’s pictures.');
      setSource(null);
      onPick({ upload: (res.data as { id: number }).id });
    } catch (e) {
      setError(inventoryErrorMessage(e, 'The picture could not be uploaded.'));
    }
  };

  const remove = async (id: number, name: string) => {
    if (!(await confirm({ title: 'Delete this picture?', message: `“${name}” is removed from your school’s pictures. Papers that use it show an empty box instead.`, confirmLabel: 'Delete', destructive: true }))) return;
    try { await actions.remove.mutateAsync(id); } catch (e) { toast.error(inventoryErrorMessage(e, 'The picture could not be deleted.')); }
  };

  if (source) {
    return (
      <View style={styles.gap}>
        <Image source={{ uri: source.uri }} style={styles.preview} contentFit="contain" accessibilityLabel="The chosen picture" />
        <Input label="What it shows" value={label} onChangeText={setLabel} />
        <View style={styles.row}>
          <Text style={[styles.hint, styles.flex]}>Clean up a photo of a drawing (white paper, black lines). Turn off for a coloured picture.</Text>
          <Switch value={clean} onValueChange={setClean} accessibilityLabel="Clean up the photo" />
        </View>
        {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
        <Button title="Upload and use" onPress={upload} loading={actions.upload.isPending} disabled={!label.trim() || actions.upload.isPending} />
        <Button title="Cancel" variant="outline" onPress={() => setSource(null)} />
      </View>
    );
  }

  const uploads = query.data ?? [];
  return (
    <View style={styles.gap}>
      <View style={styles.row}>
        <View style={styles.flex}><Button title="Take a photo" size="sm" onPress={() => choose(true)} /></View>
        <View style={styles.flex}><Button title="Choose a photo" size="sm" variant="outline" onPress={() => choose(false)} /></View>
      </View>
      <SearchBar value={search} onChangeText={setSearch} placeholder="Search your school’s pictures" />
      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
      <FlatList
        data={uploads} keyExtractor={(p) => String(p.id)} numColumns={3} style={styles.grid} keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<Text style={styles.hint}>{query.isLoading ? 'Loading…' : 'No pictures yet. Take or choose a photo; you can crop it first.'}</Text>}
        renderItem={({ item }) => (
          <Tile uri={item.image_url} label={item.label} a11y={`Use ${item.label}. Long press to delete.`}
            onPress={() => onPick({ upload: item.id })} onLongPress={() => remove(item.id, item.label)} />
        )}
      />
      {uploads.length > 0 ? <Text style={styles.hint}>Long press a picture to delete it.</Text> : null}
    </View>
  );
}

function CreateTab({ onPick }: { onPick: (ref: PictureRef) => void }) {
  const catalog = usePictureCatalog('');
  const makers: Maker[] = catalog.data?.makers ?? [];
  const [kind, setKind] = useState('');
  const maker = makers.find((m) => m.kind === kind) ?? null;
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [inner, setInner] = useState(false);
  useEffect(() => {
    if (!kind && makers[0]) { setKind(makers[0].kind); setValues(makerDefaults(makers[0])); }
  }, [kind, makers]);
  if (!maker) return <Text style={styles.hint}>Loading…</Text>;
  const set = (name: string, value: unknown) => setValues((prev) => setMakerValue(prev, name, value));
  return (
    <View style={styles.gap}>
      <Select label="Kind of picture" value={kind} onChange={(k) => { setKind(k); setValues(makerDefaults(makers.find((m) => m.kind === k))); }}
        options={makers.map((m) => ({ value: m.kind, label: m.label }))} />
      {Object.entries(maker.fields ?? {}).map(([name, field]) => {
        const label = `${name.replace(/_/g, ' ')}${field.optional ? ' (optional)' : ''}`;
        const value = values[name];
        if (field.type === 'choice') {
          return <Select key={name} label={label} value={(value as string) ?? ''} onChange={(v) => set(name, v)}
            options={[...(field.optional ? [{ value: '', label: '—' }] : []), ...(field.choices ?? []).map((c) => ({ value: c, label: c }))]} />;
        }
        if (field.type === 'bool') {
          return <Select key={name} label={label} value={value === undefined ? '' : value ? 'yes' : 'no'} onChange={(v) => set(name, v === '' ? undefined : v === 'yes')}
            options={[{ value: '', label: 'Default' }, { value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} />;
        }
        if (field.type === 'int' || field.type === 'number') {
          return <Input key={name} label={label} value={value === undefined ? '' : String(value)} keyboardType="numeric"
            onChangeText={(t) => set(name, t.trim() === '' ? undefined : Number(t))} />;
        }
        if (field.type === 'numbers') {
          return <Input key={name} label={label} value={Array.isArray(value) ? value.join(', ') : ''} placeholder="e.g. 15, 30"
            onChangeText={(t) => set(name, t.split(',').map((v) => v.trim()).filter(Boolean).map(Number).filter((n) => !Number.isNaN(n)))} />;
        }
        if (field.type === 'picture') {
          return (
            <View key={name} style={styles.row}>
              <Text style={[styles.tileText, styles.flex]}>{label}: {describePicture(value as PictureRef, { catalog: catalog.data?.library ?? [] })?.label || 'None'}</Text>
              <Button title="Choose" size="sm" variant="outline" onPress={() => setInner(true)} />
            </View>
          );
        }
        return <Input key={name} label={label} value={(value as string) ?? ''} placeholder={field.example || ''} onChangeText={(t) => set(name, t)} />;
      })}
      <Button title="Use this picture" onPress={() => onPick({ make: kind, ...values })} />
      <PicturePickerSheet visible={inner} allowCreate={false} onClose={() => setInner(false)} onPick={(ref) => set('picture', ref)} />
    </View>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.lg, gap: Spacing.sm, maxHeight: 640 },
  gap: { gap: Spacing.sm },
  grid: { maxHeight: 420 },
  tile: { flex: 1 / 3, margin: 3, padding: Spacing.xs, alignItems: 'center', borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.sm, backgroundColor: Colors.surface, minHeight: 44 },
  thumb: { width: '100%', height: 64, backgroundColor: Colors.surface },
  tileText: { fontSize: FontSize.xs, color: Colors.text },
  tileSub: { fontSize: FontSize.xs, color: Colors.textSecondary, writingDirection: 'rtl' },
  preview: { width: '100%', height: 220, backgroundColor: Colors.surfaceSecondary, borderRadius: BorderRadius.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  flex: { flex: 1 },
  hint: { fontSize: FontSize.sm, color: Colors.textSecondary },
  error: { fontSize: FontSize.sm, color: Colors.error },
});
