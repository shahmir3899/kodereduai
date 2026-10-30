import React from 'react';
import RecordCard from './ui/RecordCard';

interface StaffCardProps {
  id: number;
  name: string;
  department?: string;
  designation?: string;
  phone?: string;
  profile_photo_url?: string | null;
  onPress?: (id: number) => void;
}

export default function StaffCard({ id, name, department, designation, phone, profile_photo_url, onPress }: StaffCardProps) {
  return (
    <RecordCard title={name} subtitle={designation} meta={department} avatarName={name} avatarUri={profile_photo_url}
      trailing={phone} onPress={() => onPress?.(id)} />
  );
}
