import React, { useMemo, useState } from 'react';
import { Image, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import Button from '../../ui/Button';
import PaperPhotoViewer from '../PaperPhotoViewer';
import { usePictureLookups } from '../../../hooks/useBlockPaper';
import { blockPictures, isQuestionBlock, type Block, type Registry } from '../../../services/shared/blockDocument';
import { describePicture } from '../../../services/shared/pictureRefs';
import { keptBlocks, marksCheck, scanCardLine, scanMarks, scanSummary, thumbUrl, type BlockScanResult } from '../../../services/blockPaper';
import type { PagePhoto } from '../../../services/paperPages';
import { Colors, FontSize, Spacing, BorderRadius } from '../../../constants/colors';

// What the photo scan read (Paper Builder v2), as on the web's blocks/BlockScanReview.jsx: one card per block with
// its kind, title, marks and pictures. The teacher unticks anything wrong and adds the rest; details are fixed in
// the editor afterwards, where the preview is.
export default function BlockScanReview({ result, photos, registry, busy, onAccept, onStartOver }: {
  result: BlockScanResult; photos: PagePhoto[]; registry: Registry | null; busy?: boolean;
  onAccept: (blocks: Block[]) => void; onStartOver: () => void;
}) {
  const lookups = usePictureLookups();
  const blocks = useMemo(() => result.blocks ?? [], [result]);
  const [skipped, setSkipped] = useState<number[]>([]);
  const [viewer, setViewer] = useState<number | null>(null);
  const kept = keptBlocks(blocks, skipped);
  const check = marksCheck(scanMarks(kept, registry), result.header?.total_marks);
  const notes = result.notes ?? [];
  let number = 0;
  return (
    <View style={styles.gap}>
      <Text style={styles.hint}>{scanSummary(result, photos.length)}</Text>
      {notes.length > 0 ? (
        <View style={styles.notes} accessibilityRole="summary">
          <Text style={styles.noteTitle}>Check these:</Text>
          {notes.map((n) => <Text key={n} style={styles.noteText}>• {n}</Text>)}
        </View>
      ) : null}
      {photos.length > 0 ? <Button title="View the photo" size="sm" variant="outline" onPress={() => setViewer(photos[0].page_number)} /> : null}
      {blocks.map((block, index) => {
        const isQuestion = isQuestionBlock(block, registry);
        if (isQuestion) number += 1;
        const included = !skipped.includes(index);
        const pictures = blockPictures(block).slice(0, 8).map((ref) => describePicture(ref, lookups));
        const line = scanCardLine(block, isQuestion ? number : null, registry, photos.length);
        return (
          <View key={`${block.id ?? 'b'}-${index}`} style={[styles.card, !included && styles.off]}>
            <View style={styles.row}>
              <View style={styles.flex}>
                <Text style={styles.sub}>{line}</Text>
                <Text style={styles.title}>{block.title || 'No instruction read'}</Text>
              </View>
              {isQuestion ? <Text style={styles.sub}>{block.marks ?? 0} mark{Number(block.marks) === 1 ? '' : 's'}</Text> : null}
              <Switch value={included} accessibilityLabel={`Add ${line} to the paper`}
                onValueChange={(on) => setSkipped((s) => (on ? s.filter((i) => i !== index) : [...s, index]))} />
            </View>
            {pictures.length > 0 ? (
              <View style={styles.thumbs}>
                {pictures.map((p, i) => {
                  const uri = thumbUrl(p?.image);
                  // eslint-disable-next-line react/no-array-index-key -- a block may use one picture twice
                  return uri ? <Image key={i} source={{ uri }} style={styles.thumb} resizeMode="contain" accessibilityLabel={p?.label} />
                    : <Text key={i} style={styles.missing}>{p?.label || 'picture'}</Text>;
                })}
              </View>
            ) : null}
            {block.page_number && photos.length > 0 ? (
              <TouchableOpacity accessibilityRole="button" onPress={() => setViewer(block.page_number as number)}>
                <Text style={styles.link}>See page {block.page_number}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        );
      })}
      {check ? <Text style={[styles.check, check.ok ? styles.ok : styles.warn]}>{check.text}</Text> : null}
      <Button title={`Add ${kept.length} to the paper`} onPress={() => onAccept(kept)} disabled={kept.length === 0 || busy} loading={busy} />
      <Button title="Start over" variant="ghost" size="sm" onPress={onStartOver} />
      <PaperPhotoViewer visible={viewer !== null} photos={photos} page={viewer ?? 1} box={null}
        onPageChange={(page) => setViewer(page)} onClose={() => setViewer(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { gap: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  flex: { flex: 1 },
  hint: { fontSize: FontSize.sm, color: Colors.textSecondary },
  sub: { fontSize: FontSize.xs, color: Colors.textSecondary },
  title: { fontSize: FontSize.md, color: Colors.text },
  card: { backgroundColor: Colors.surfaceSecondary, borderRadius: BorderRadius.sm, padding: Spacing.sm, gap: Spacing.xs },
  off: { opacity: 0.5 },
  thumbs: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  thumb: { width: 40, height: 40, backgroundColor: '#fff', borderRadius: 4, borderWidth: 1, borderColor: Colors.border },
  missing: { minWidth: 40, height: 40, paddingHorizontal: 4, fontSize: 10, color: Colors.textSecondary, borderWidth: 1, borderStyle: 'dashed', borderColor: Colors.textTertiary, borderRadius: 4, textAlignVertical: 'center' },
  link: { fontSize: FontSize.sm, color: Colors.primary },
  notes: { backgroundColor: Colors.warningLight, borderRadius: BorderRadius.sm, padding: Spacing.sm, gap: 2 },
  noteTitle: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.warningText },
  noteText: { fontSize: FontSize.sm, color: Colors.warningText },
  check: { fontSize: FontSize.sm, borderRadius: BorderRadius.sm, padding: Spacing.sm },
  ok: { backgroundColor: Colors.successLight, color: Colors.text },
  warn: { backgroundColor: Colors.warningLight, color: Colors.warningText },
});
