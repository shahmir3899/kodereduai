import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View, StyleSheet } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useQuery } from '@tanstack/react-query';
import { examinationsApi } from '../../services/api';
// JPEG, PNG or WebP, up to 10 MB: the same limits as the web dropzone.
import { tocImageProblem as captureImageProblem } from '../../services/curriculum';
import {
  blockReviewFrom, clampPages, emptyPagesSession, newGroupId, POLL_MS, slotState, SLOT_LABEL, staleCapture,
  UPLOAD_CONCURRENCY, MAX_PAGES, type GroupStatus, type PagesSession,
} from '../../services/paperPages';
import { appendFile } from '../../services/formFile';
import { inventoryErrorMessage } from '../../services/inventory';
import Button from '../ui/Button';
import Input from '../ui/Input';
import StatusPill from '../ui/StatusPill';
import { confirm } from '../ui/confirm';
import FormSheet from '../inventory/FormSheet';
import BlockScanReview from './blocks/BlockScanReview';
import type { Block, Registry } from '../../services/shared/blockDocument';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

type LocalState = 'queued' | 'uploading' | 'failed';

interface Props {
  visible: boolean;
  onClose: () => void;
  classId: number | null;
  subjectId: number | null;
  // Lives in the builder so closing the sheet keeps the capture until it is accepted or started over.
  session: PagesSession;
  setSession: React.Dispatch<React.SetStateAction<PagesSession>>;
  registry?: Registry | null;
  // Hand the kept blocks to the editor. The paper already exists, so class and subject are only hints for the server.
  onAcceptBlocks?: (p: { blocks: Block[]; direction: string; uploadIds: number[] }) => Promise<void> | void;
}

// Photograph a printed paper (block editor, papers and worksheets): say how many pages it has, add every page (they are
// read at the same time, straight into blocks), then check the blocks beside the photos. The old questions/sections
// review was removed in Paper Builder v2 Phase 7.
export default function PaperPagesSheet({ visible, onClose, classId, subjectId, session, setSession, registry, onAcceptBlocks }: Props) {
  const [countInput, setCountInput] = useState('1');
  const [locals, setLocals] = useState<Record<number, { state: LocalState; error?: string }>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const queue = useRef<Array<{ page: number; asset: ImagePicker.ImagePickerAsset }>>([]);
  const active = useRef(0);
  const groupRef = useRef<string | null>(session.groupId);
  groupRef.current = session.groupId;

  const { groupId, totalPages } = session;
  const blockReview = session.blockReview ?? null;
  const inFlightLocally = Object.values(locals).some((l) => l.state === 'queued' || l.state === 'uploading');

  const status = useQuery({
    queryKey: ['paper-group-status', groupId, totalPages],
    enabled: !!groupId && !!totalPages && !blockReview,
    queryFn: async () => (await examinationsApi.getPaperGroupStatus(groupId as string, totalPages as number)).data as GroupStatus,
    refetchInterval: (q) => ((q.state.data?.pages ?? []).some((p) => p.status === 'PENDING' || p.status === 'PROCESSING') || inFlightLocally ? POLL_MS : false),
  });
  const serverPages = status.data?.pages ?? [];

  // Every declared page is read: the joined blocks become the review (once).
  useEffect(() => {
    if (blockReview) return;
    const blocksRead = blockReviewFrom(status.data);
    if (blocksRead) setSession((s) => (s.blockReview ? s : { ...s, blockReview: blocksRead }));
  }, [status.data, blockReview, setSession]);

  const setLocal = useCallback((page: number, v: { state: LocalState; error?: string } | null) => {
    setLocals((prev) => {
      const next = { ...prev };
      if (v) next[page] = v; else delete next[page];
      return next;
    });
  }, []);

  const pump = useCallback(() => {
    while (active.current < UPLOAD_CONCURRENCY && queue.current.length > 0) {
      const { page, asset } = queue.current.shift() as { page: number; asset: ImagePicker.ImagePickerAsset };
      active.current += 1;
      setLocal(page, { state: 'uploading' });
      (async () => {
        try {
          const form = new FormData();
          await appendFile(form, 'image', { uri: asset.uri, name: asset.fileName ?? `page-${page}.jpg`, type: asset.mimeType ?? 'image/jpeg' });
          if (classId) form.append('class_obj', String(classId));
          if (subjectId) form.append('subject', String(subjectId));
          form.append('group_id', groupRef.current as string);
          form.append('page_number', String(page));
          form.append('mode', 'blocks');
          await examinationsApi.uploadPaperImage(form);
          setLocal(page, null);
          status.refetch();
        } catch (e) {
          setLocal(page, { state: 'failed', error: (e as { response?: unknown }).response ? inventoryErrorMessage(e, 'Could not upload the photo.') : (e as Error).message });
        } finally {
          active.current -= 1;
          pump();
        }
      })();
    }
  }, [classId, subjectId, setLocal, status]);

  const pick = async (page: number, camera: boolean) => {
    setError(null);
    const perm = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return setError(camera ? 'Allow the camera in your phone settings to photograph the page.' : 'Allow photo access in your phone settings.');
    const result = camera ? await ImagePicker.launchCameraAsync({ quality: 0.7 }) : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    const problem = captureImageProblem(asset.mimeType ?? 'image/jpeg', asset.fileSize);
    if (problem) return setError(problem);
    setLocal(page, { state: 'queued' });
    queue.current.push({ page, asset });
    pump();
  };

  const start = () => {
    const count = clampPages(countInput);
    setSession({ groupId: newGroupId(), totalPages: count });
  };

  const startOver = async () => {
    if (!(await confirm({ title: 'Start over?', message: 'The pages and everything you edited here are discarded.', confirmLabel: 'Start over', destructive: true }))) return;
    queue.current = [];
    setLocals({});
    setSession(emptyPagesSession());
    setError(null);
  };

  // ─── 1. how many pages ───
  if (!totalPages) {
    return (
      <FormSheet visible={visible} title="Capture the paper from photos" onClose={onClose} onSubmit={start} submitLabel="Continue" error={error}>
        <Text style={styles.hint}>How many pages does the printed paper have? Say it now so we know when the whole paper has been read. You can then add all the pages together.</Text>
        <Input label={`Total pages (1 to ${MAX_PAGES})`} value={countInput} onChangeText={setCountInput} keyboardType="number-pad" />
      </FormSheet>
    );
  }

  // ─── 3. block scan review ───
  if (blockReview) {
    const acceptBlocks = async (blocks: Block[]) => {
      setBusy(true);
      setError(null);
      try {
        await onAcceptBlocks?.({ blocks, direction: blockReview.result.direction || 'ltr', uploadIds: blockReview.uploadIds });
        setSession(emptyPagesSession());
        onClose();
      } catch (e) {
        setError((e as Error).message || 'Could not add this to the paper.');
      } finally {
        setBusy(false);
      }
    };
    return (
      <FormSheet visible={visible} title="Check what was read" onClose={onClose} onSubmit={onClose} submitLabel="Close" error={error}>
        <BlockScanReview result={blockReview.result} photos={blockReview.photos} registry={registry ?? null} busy={busy}
          onAccept={acceptBlocks} onStartOver={startOver} />
      </FormSheet>
    );
  }

  // Pages read by the old scanner before the update give no blocks: they must be scanned again.
  if (staleCapture(status.data)) {
    return (
      <FormSheet visible={visible} title="Scan the pages again" onClose={onClose} onSubmit={onClose} submitLabel="Close" error={error}>
        <Text style={styles.hint}>These pages were read by the old scanner, which has been replaced. Please start over and add them again.</Text>
        <Button title="Start over" variant="outline" size="sm" onPress={startOver} />
      </FormSheet>
    );
  }

  // ─── 2. add the pages ───
  const pages = Array.from({ length: totalPages }, (_, i) => i + 1);
  const read = pages.filter((n) => slotState(locals[n]?.state, serverPages.find((p) => p.page_number === n)) === 'extracted').length;
  return (
    <FormSheet visible={visible} title={`Add the ${totalPages} page${totalPages === 1 ? '' : 's'}`} onClose={onClose} onSubmit={onClose} submitLabel="Close" error={error}>
      <Text style={styles.hint}>{read} of {totalPages} page{totalPages === 1 ? '' : 's'} read. Pages are read at the same time, so you can add the next while the others are being read. The review opens when all are done.</Text>
      {pages.map((n) => {
        const server = serverPages.find((p) => p.page_number === n);
        const state = slotState(locals[n]?.state, server);
        const busyPage = state === 'queued' || state === 'uploading' || state === 'processing';
        const problem = state === 'failed' ? (locals[n]?.error || server?.error_message || 'Please try again with a clearer photo.') : '';
        return (
          <View key={n} style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.name}>Page {n}</Text>
              <StatusPill label={SLOT_LABEL[state]} tone={state === 'failed' ? 'error' : state === 'extracted' ? 'success' : busyPage ? 'info' : 'neutral'} />
            </View>
            {problem ? <Text style={styles.problem}>{problem}</Text> : null}
            {!busyPage && state !== 'extracted' ? (
              <View style={styles.row}>
                <View style={styles.col}><Button title={state === 'failed' ? 'Retry (photo)' : 'Take a photo'} size="sm" onPress={() => pick(n, true)} /></View>
                <View style={styles.col}><Button title="Choose from photos" size="sm" variant="outline" onPress={() => pick(n, false)} /></View>
              </View>
            ) : null}
          </View>
        );
      })}
      <Button title="Start over" variant="ghost" size="sm" onPress={startOver} />
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  hint: { fontSize: FontSize.sm, color: Colors.textSecondary },
  problem: { fontSize: FontSize.sm, color: Colors.errorText },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flexWrap: 'wrap' },
  col: { flex: 1, minWidth: 120 },
  name: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  card: { backgroundColor: Colors.surfaceSecondary, borderRadius: BorderRadius.sm, padding: Spacing.sm, gap: Spacing.xs },
});
