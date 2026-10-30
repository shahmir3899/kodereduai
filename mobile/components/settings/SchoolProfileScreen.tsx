import React, { useState } from 'react';
import { View, Text, ScrollView, Image, Switch, Share, StyleSheet } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '../../contexts/AuthContext';
import { useAppListing, useSchoolProfile, useSchoolProfileActions } from '../../hooks/useSchoolProfile';
import { schoolLink } from '../../services/schoolFinder';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import {
  assetProblem, ASSET_LABEL, COMMENT_LENGTHS, COMMENT_PHRASES_MAX, COMMENT_TONES, commentChanged, commentSettingsOf, contactLines, DEFAULT_TIME_ZONE,
  riskThresholdOf, timeZoneOptions, validateComment, validateRiskThreshold, type AssetType, type CommentSettings, type SchoolProfile,
} from '../../services/schoolProfile';
import { inventoryErrorMessage } from '../../services/inventory';
import Input from '../ui/Input';
import Select from '../ui/Select';
import Button from '../ui/Button';
import Card from '../ui/Card';
import QueryBoundary from '../ui/QueryBoundary';
import { useToast } from '../ui/Toast';
import { confirm } from '../ui/confirm';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

// The school's logo and letterhead (printed on reports, receipts and report cards), its time zone,
// the exam settings and the attendance risk threshold. Admin and principal only; name, subdomain and
// contact details are read-only here and on the web.
export default function SchoolProfileScreen() {
  const q = useSchoolProfile();
  const refreshControl = useRefreshControl(q.refetch);
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} refreshControl={refreshControl} keyboardShouldPersistTaps="handled">
      <QueryBoundary query={q} isEmpty={(s) => !s}>{(school) => <Body school={school} />}</QueryBoundary>
    </ScrollView>
  );
}

function Body({ school }: { school: SchoolProfile }) {
  const toast = useToast();
  const { refreshUser } = useAuth();
  const actions = useSchoolProfileActions();
  const saved = commentSettingsOf(school);
  const [draft, setDraft] = useState<CommentSettings | null>(null);
  const comment = draft ?? saved;
  const [risk, setRisk] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<AssetType | null>(null);
  const listing = useAppListing();

  const fail = (e: unknown, fallback: string) => toast.error(inventoryErrorMessage(e, fallback));

  const upload = async (type: AssetType) => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return toast.error('Allow photo access in your phone settings.');
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9 });
    if (result.canceled || !result.assets?.[0]) return;
    const a = result.assets[0];
    const bad = assetProblem(a.mimeType ?? 'image/jpeg', a.fileSize);
    if (bad) return toast.error(bad);
    setUploading(type);
    try {
      const form = new FormData();
      form.append('file', { uri: a.uri, name: a.fileName ?? `${type}.jpg`, type: a.mimeType ?? 'image/jpeg' } as unknown as Blob);
      form.append('asset_type', type);
      await actions.upload.mutateAsync(form);
      toast.success(`The ${ASSET_LABEL[type]} was updated.`);
    } catch (e) { fail(e, `Could not upload the ${ASSET_LABEL[type]}.`); } finally { setUploading(null); }
  };

  const removeAsset = async (type: AssetType) => {
    if (!(await confirm({ title: `Remove the ${ASSET_LABEL[type]}?`, message: 'It disappears from new reports and documents.', confirmLabel: 'Remove', destructive: true }))) return;
    try { await actions.remove.mutateAsync(type); toast.success(`The ${ASSET_LABEL[type]} was removed.`); } catch (e) { fail(e, `Could not remove the ${ASSET_LABEL[type]}.`); }
  };

  const changeZone = async (zone: string) => {
    try {
      await actions.timeZone.mutateAsync(zone);
      await refreshUser();
      toast.success('Time zone updated.');
    } catch (e) { fail(e, 'Could not change the time zone.'); }
  };

  const toggleWeighted = async (on: boolean) => {
    try { await actions.exam.mutateAsync({ weighted_average_enabled: on }); toast.success(on ? 'Weighted average turned on.' : 'Weighted average turned off.'); } catch (e) { fail(e, 'Could not save the exam setting.'); }
  };

  const saveComments = async () => {
    const problem = validateComment(comment);
    if (problem) return setError(problem);
    setError(null);
    try {
      await actions.exam.mutateAsync({ comment_tone: comment.comment_tone, comment_length: comment.comment_length, comment_phrases: comment.comment_phrases.trim() });
      setDraft(null);
      toast.success('Comment settings saved.');
    } catch (e) { setError(inventoryErrorMessage(e, 'Could not save the comment settings.')); }
  };

  const riskText = risk ?? riskThresholdOf(school);
  const saveRisk = async () => {
    const problem = validateRiskThreshold(riskText);
    if (problem) return toast.error(problem);
    try { await actions.attendance.mutateAsync({ risk_threshold: Number(riskText) }); setRisk(null); toast.success('Risk threshold saved.'); } catch (e) { fail(e, 'Could not save the threshold.'); }
  };

  const toggleListing = async (on: boolean) => {
    try {
      await listing.set.mutateAsync(on);
      toast.success(on ? 'Your school now appears in the app search.' : 'Your school is hidden from the app search.');
    } catch (e) { fail(e, 'Could not change the setting.'); }
  };

  const shareLink = async () => {
    if (!school.subdomain) return;
    try {
      await Share.share({ message: `Open the Education AI app and choose ${school.name}, or use the school code: ${school.subdomain}\n${schoolLink(school.subdomain)}` });
    } catch { /* The share sheet was closed. */ }
  };

  const asset = (type: AssetType, url: string | null | undefined, title: string, hint: string) => (
    <Card style={styles.card}>
      <Text style={styles.section}>{title}</Text>
      <Text style={styles.hint}>{hint}</Text>
      {url ? <Image source={{ uri: url }} style={type === 'logo' ? styles.logo : styles.letterhead} resizeMode="contain" accessibilityLabel={`School ${ASSET_LABEL[type]}`} /> : <Text style={styles.empty}>{`No ${ASSET_LABEL[type]} uploaded`}</Text>}
      <View style={styles.pair}>
        <Button title={url ? 'Replace' : 'Upload'} size="sm" style={styles.half} onPress={() => upload(type)} loading={uploading === type} disabled={uploading !== null} />
        {url ? <Button title="Remove" size="sm" variant="danger" style={styles.half} onPress={() => removeAsset(type)} disabled={uploading !== null || actions.remove.isPending} /> : null}
      </View>
      <Text style={styles.hint}>JPG, PNG or WebP, up to 5 MB. SVG files are added on the web.</Text>
    </Card>
  );

  return (
    <>
      <Card style={styles.card}>
        <Text style={styles.section}>School information</Text>
        {contactLines(school).map((l) => <View key={l.label} style={styles.line}><Text style={styles.label}>{l.label}</Text><Text style={styles.value}>{l.value}</Text></View>)}
        <Select label="Time zone" value={school.timezone || DEFAULT_TIME_ZONE} onChange={(z) => changeZone(String(z))} options={timeZoneOptions(school.timezone).map((z) => ({ value: z, label: z }))} disabled={actions.timeZone.isPending} />
        <Text style={styles.hint}>Dates such as "today" follow this clock.</Text>
      </Card>

      <Card style={styles.card}>
        <Text style={styles.section}>School in the app</Text>
        <Text style={styles.hint}>Parents and staff pick this school when they first open the app. Anyone can use the code or QR code below; the search list is optional.</Text>
        {school.subdomain ? (
          <>
            <View style={styles.line}><Text style={styles.label}>School code</Text><Text style={styles.value} selectable>{school.subdomain}</Text></View>
            <View style={styles.qr} accessible accessibilityLabel={`QR code for the school code ${school.subdomain}`}>
              <QRCode value={schoolLink(school.subdomain)} size={176} />
            </View>
            <Button title="Share the school link" variant="outline" size="sm" onPress={shareLink} />
          </>
        ) : <Text style={styles.hint}>This school has no code yet. Ask the platform admin to set one.</Text>}
        <View style={styles.toggle}>
          <View style={styles.flex}>
            <Text style={styles.value}>Show in the app's school search</Text>
            <Text style={styles.hint}>Off keeps the school private: people need the code or QR code.</Text>
          </View>
          <Switch value={listing.query.data === true} onValueChange={toggleListing} disabled={listing.query.isLoading || listing.set.isPending} accessibilityLabel="Show in the app's school search" />
        </View>
      </Card>

      {asset('logo', school.logo, 'School logo', 'Used on reports, receipts and the school header. A square image, at least 200 by 200.')}
      {asset('letterhead', school.letterhead_url, 'Letterhead', 'Used as the header on official documents and report cards. A wide image, for example 800 by 150.')}

      <Card style={styles.card}>
        <Text style={styles.section}>Examination settings</Text>
        <View style={styles.toggle}>
          <View style={styles.flex}>
            <Text style={styles.value}>Weighted average</Text>
            <Text style={styles.hint}>Each exam type counts by its weight (for example Mid-term 30%, Final 70%). Off means a simple average.</Text>
          </View>
          <Switch value={!!school.exam_config?.weighted_average_enabled} onValueChange={toggleWeighted} disabled={actions.exam.isPending} accessibilityLabel="Weighted average" />
        </View>
        <Text style={[styles.section, styles.gap]}>Report card comments (AI)</Text>
        <Text style={styles.hint}>How automatic comments are written. Comments already made are not changed.</Text>
        <Select label="Tone" value={comment.comment_tone} onChange={(v) => setDraft({ ...comment, comment_tone: String(v) })} options={COMMENT_TONES} />
        <Select label="Length (per subject)" value={comment.comment_length} onChange={(v) => setDraft({ ...comment, comment_length: String(v) })} options={COMMENT_LENGTHS} />
        <Input label="School guidance (optional)" value={comment.comment_phrases} onChangeText={(v) => setDraft({ ...comment, comment_phrases: v })} multiline maxLength={COMMENT_PHRASES_MAX}
          placeholder="e.g. Use British spelling. End with a wish for the next term." />
        <Text style={styles.hint}>{`${comment.comment_phrases.length}/${COMMENT_PHRASES_MAX} characters`}</Text>
        {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
        <Button title="Save comment settings" onPress={saveComments} loading={actions.exam.isPending} disabled={!commentChanged(comment, saved) || actions.exam.isPending} />
      </Card>

      <Card style={styles.card}>
        <Text style={styles.section}>Attendance risk predictor</Text>
        <Text style={styles.hint}>Students at or below this attendance percentage are flagged as at risk on the dashboard.</Text>
        <Input label="Threshold (%)" value={riskText} onChangeText={setRisk} keyboardType="decimal-pad" />
        <Button title="Save threshold" onPress={saveRisk} loading={actions.attendance.isPending} disabled={risk === null || actions.attendance.isPending} />
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl, gap: Spacing.md },
  card: { gap: Spacing.md },
  section: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  gap: { marginTop: Spacing.sm },
  hint: { fontSize: FontSize.sm, color: Colors.textSecondary },
  empty: { fontSize: FontSize.sm, color: Colors.textTertiary, paddingVertical: Spacing.md },
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md },
  label: { fontSize: FontSize.sm, color: Colors.textSecondary },
  value: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text, flexShrink: 1, textAlign: 'right' },
  logo: { width: 128, height: 128, alignSelf: 'flex-start', borderRadius: BorderRadius.md, backgroundColor: Colors.surfaceSecondary },
  letterhead: { width: '100%', height: 90, borderRadius: BorderRadius.md, backgroundColor: Colors.surfaceSecondary },
  qr: { alignItems: 'center', padding: Spacing.md, backgroundColor: '#ffffff', borderRadius: BorderRadius.md, alignSelf: 'center' },
  pair: { flexDirection: 'row', gap: Spacing.sm },
  half: { flex: 1 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  flex: { flex: 1 },
  error: { color: Colors.error, fontSize: FontSize.sm },
});
