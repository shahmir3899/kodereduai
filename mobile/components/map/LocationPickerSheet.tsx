import React, { useEffect, useMemo, useState } from 'react';
import { Text, StyleSheet } from 'react-native';
import RouteMap from './RouteMap';
import { mapHtml, parsePinText, pinText, type MapMarker, type MapMessage, type Pin } from '../../services/routeMap';
import { getCurrentLocation, requestLocationPermissions } from '../../services/location';
import Button from '../ui/Button';
import Input from '../ui/Input';
import FormSheet from '../inventory/FormSheet';
import { Colors, FontSize } from '../../constants/colors';

interface Props {
  visible: boolean;
  title: string;
  initial: Pin | null;
  // Other places to show for context (the route's other stops), without a pin of their own.
  context?: MapMarker[];
  onClose: () => void;
  onUse: (pin: Pin | null) => void;
}

// Choose a place on the map: tap to drop a pin, use the phone's current position, or type the
// coordinates. The same choice the web makes with its location picker. Nothing is saved here: the pin goes
// back to the form that opened this.
export default function LocationPickerSheet({ visible, title, initial, context = [], onClose, onUse }: Props) {
  const [pin, setPin] = useState<Pin | null>(initial);
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setPin(initial); setLat(initial ? String(initial.lat) : ''); setLng(initial ? String(initial.lng) : ''); setError(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // The page is rebuilt only when the sheet opens, so tapping does not reload the map under the finger.
  const html = useMemo(() => mapHtml({ markers: context, pick: initial, picking: true }), [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (p: Pin) => { setPin(p); setLat(p.lat.toFixed(6)); setLng(p.lng.toFixed(6)); setError(null); };
  const onMessage = (m: MapMessage) => { if (m.type === 'pick') set({ lat: m.lat, lng: m.lng }); };

  const here = async () => {
    setLocating(true); setError(null);
    try {
      if (!(await requestLocationPermissions())) return setError('Allow location in your phone settings to use your current position.');
      const loc = await getCurrentLocation();
      if (!loc) return setError('Could not read your position. Try again outside, or tap the map.');
      set({ lat: loc.coords.latitude, lng: loc.coords.longitude });
    } finally { setLocating(false); }
  };

  const typed = () => {
    const r = parsePinText(lat, lng);
    if (r.error) return setError(r.error);
    setPin(r.pin); setError(null);
    onUse(r.pin);
  };

  return (
    <FormSheet visible={visible} title={title} onClose={onClose} onSubmit={typed} submitLabel="Use this location" error={error}>
      <Text style={styles.hint}>Tap the map to drop a pin. The map needs an internet connection.</Text>
      <RouteMap html={html} height={300} onMessage={onMessage} />
      <Text style={styles.pin}>{pinText(pin)}</Text>
      <Button title="Use my current position" size="sm" variant="outline" loading={locating} disabled={locating} onPress={here} />
      <Input label="Latitude" value={lat} onChangeText={setLat} keyboardType="numbers-and-punctuation" autoCapitalize="none" />
      <Input label="Longitude" value={lng} onChangeText={setLng} keyboardType="numbers-and-punctuation" autoCapitalize="none" />
      <Button title="Clear the location" size="sm" variant="ghost" onPress={() => { setPin(null); setLat(''); setLng(''); onUse(null); }} />
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  hint: { fontSize: FontSize.sm, color: Colors.textSecondary },
  pin: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text },
});
