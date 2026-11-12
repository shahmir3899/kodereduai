import React, { useState } from 'react';
import { Image, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import Button from '../ui/Button';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';
import type { PagePhoto, PhotoBox } from '../../services/paperPages';

const ZOOMS = [1, 1.5, 2, 3];

interface Props {
  visible: boolean;
  photos: PagePhoto[];
  page: number;
  box?: PhotoBox | null;
  onPageChange: (page: number) => void;
  onClose: () => void;
}

/**
 * The scanned page photo, full screen, for checking what was read against the handwriting. A phone is too
 * narrow to put it beside the question list, so it opens from a question's "View photo" button. The image is
 * panned by scrolling and enlarged with the +/- buttons; the question's area (when the server found one) is
 * drawn over it as a box.
 */
export default function PaperPhotoViewer({ visible, photos, page, box, onPageChange, onClose }: Props) {
  const { width } = useWindowDimensions();
  const [zoomIndex, setZoomIndex] = useState(0);
  const [aspect, setAspect] = useState(1.3); // height / width, replaced once the image reports its size
  const current = photos.find((p) => p.page_number === page) ?? photos[0];
  if (!current) return null;
  const imageWidth = (width - Spacing.md * 2) * ZOOMS[zoomIndex];
  const imageHeight = imageWidth * aspect;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.screen}>
        <View style={styles.bar}>
          {photos.map((p) => (
            <TouchableOpacity key={p.page_number} onPress={() => onPageChange(p.page_number)} accessibilityRole="button"
              style={[styles.tab, p.page_number === current.page_number && styles.tabOn]}>
              <Text style={[styles.tabText, p.page_number === current.page_number && styles.tabTextOn]}>Page {p.page_number}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <ScrollView style={styles.flex} contentContainerStyle={{ padding: Spacing.md }}>
          <ScrollView horizontal>
            <View style={{ width: imageWidth, height: imageHeight }}>
              <Image
                source={{ uri: current.image_url }} style={{ width: imageWidth, height: imageHeight }} resizeMode="contain"
                accessibilityLabel={`Page ${current.page_number} of the paper`}
                onLoad={(e) => { const s = e.nativeEvent?.source; if (s?.width && s?.height) setAspect(s.height / s.width); }}
              />
              {box ? (
                <View pointerEvents="none" style={[styles.box, {
                  left: box.x0 * imageWidth, top: box.y0 * imageHeight,
                  width: (box.x1 - box.x0) * imageWidth, height: (box.y1 - box.y0) * imageHeight,
                }]} />
              ) : null}
            </View>
          </ScrollView>
        </ScrollView>
        <View style={styles.actions}>
          <Button title="−" variant="outline" size="sm" disabled={zoomIndex === 0} onPress={() => setZoomIndex((i) => Math.max(0, i - 1))} />
          <Text style={styles.zoom}>{Math.round(ZOOMS[zoomIndex] * 100)}%</Text>
          <Button title="+" variant="outline" size="sm" disabled={zoomIndex === ZOOMS.length - 1} onPress={() => setZoomIndex((i) => Math.min(ZOOMS.length - 1, i + 1))} />
          <View style={styles.flex} />
          <Button title="Close" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  bar: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs, padding: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.border },
  tab: { paddingHorizontal: Spacing.sm, paddingVertical: Spacing.xs, borderRadius: BorderRadius.sm, borderWidth: 1, borderColor: Colors.border },
  tabOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  tabText: { fontSize: FontSize.sm, color: Colors.text },
  tabTextOn: { color: '#fff' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.border },
  zoom: { fontSize: FontSize.sm, color: Colors.textSecondary, minWidth: 44, textAlign: 'center' },
  box: { position: 'absolute', borderWidth: 2, borderColor: Colors.warningText ?? '#d97706', backgroundColor: 'rgba(251,191,36,0.25)' },
});
