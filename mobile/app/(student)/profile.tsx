import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../contexts/AuthContext';
import { studentPortalApi } from '../../services/api';
import Card from '../../components/ui/Card';
import Spinner from '../../components/ui/Spinner';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

interface ProfileData {
  name: string;
  username: string;
  email: string;
  phone?: string;
  class_name: string;
  roll_number: string;
  section?: string;
  guardian_name?: string;
  guardian_phone?: string;
  address?: string;
  date_of_birth?: string;
  blood_group?: string;
  admission_date?: string;
}

export default function MyProfile() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchProfile = async () => {
    try {
      const response = await studentPortalApi.getProfile();
      setProfile(response.data);
    } catch (error) {
      console.error('Failed to fetch profile:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchProfile();
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    fetchProfile();
  };

  if (loading) return <Spinner fullScreen message="Loading profile..." />;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
      {/* Profile Header */}
      <View style={styles.profileHeader}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {(profile?.name || user?.username || '?').charAt(0).toUpperCase()}
          </Text>
        </View>
        <Text style={styles.name}>{profile?.name || user?.username}</Text>
        <Text style={styles.classText}>
          {profile?.class_name || ''} {profile?.section ? `(${profile.section})` : ''} | Roll #{profile?.roll_number || ''}
        </Text>
      </View>

      {/* Personal Info */}
      <Card style={styles.section}>
        <Text style={styles.sectionTitle}>Personal Information</Text>
        <InfoRow label="Username" value={profile?.username} />
        <InfoRow label="Email" value={profile?.email} />
        <InfoRow label="Phone" value={profile?.phone} />
        <InfoRow label="Date of Birth" value={profile?.date_of_birth} />
        <InfoRow label="Blood Group" value={profile?.blood_group} />
        <InfoRow label="Address" value={profile?.address} />
      </Card>

      {/* Guardian Info */}
      <Card style={styles.section}>
        <Text style={styles.sectionTitle}>Guardian Information</Text>
        <InfoRow label="Guardian Name" value={profile?.guardian_name} />
        <InfoRow label="Guardian Phone" value={profile?.guardian_phone} />
      </Card>

      {/* Academic Info */}
      <Card style={styles.section}>
        <Text style={styles.sectionTitle}>Academic Information</Text>
        <InfoRow label="Class" value={profile?.class_name} />
        <InfoRow label="Roll Number" value={profile?.roll_number} />
        <InfoRow label="Admission Date" value={profile?.admission_date} />
      </Card>

      {/* Navigation Links */}
      <View style={styles.linksSection}>
        <TouchableOpacity
          style={styles.linkItem}
          onPress={() => router.push('/(student)/inbox')}
        >
          <Text style={styles.linkText}>Notifications</Text>
          <Text style={styles.linkArrow}>›</Text>
        </TouchableOpacity>
      </View>

      {/* Logout */}
      <TouchableOpacity style={styles.logoutButton} onPress={logout}>
        <Text style={styles.logoutText}>Logout</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg },
  profileHeader: {
    alignItems: 'center',
    marginBottom: Spacing.xxl,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.md,
  },
  avatarText: {
    fontSize: FontSize.xxxl,
    fontWeight: '700',
    color: Colors.textInverse,
  },
  name: {
    fontSize: FontSize.xl,
    fontWeight: '700',
    color: Colors.text,
  },
  classText: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginTop: 4,
  },
  section: {
    marginBottom: Spacing.lg,
  },
  sectionTitle: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.text,
    marginBottom: Spacing.md,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  infoLabel: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
  },
  infoValue: {
    fontSize: FontSize.sm,
    fontWeight: '500',
    color: Colors.text,
    flex: 1,
    textAlign: 'right',
  },
  linksSection: {
    marginBottom: Spacing.lg,
  },
  linkItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  linkText: {
    fontSize: FontSize.md,
    fontWeight: '500',
    color: Colors.text,
  },
  linkArrow: {
    fontSize: 20,
    color: Colors.textTertiary,
  },
  logoutButton: {
    backgroundColor: Colors.errorLight,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    alignItems: 'center',
    marginBottom: Spacing.xxxl,
  },
  logoutText: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.error,
  },
});
