import React from 'react';
import RecordCard from './ui/RecordCard';

interface StudentCardProps {
  id: number;
  name: string;
  class_name: string;
  roll_number: string;
  profile_photo_url?: string | null;
  onPress?: (id: number) => void;
}

export default function StudentCard({ id, name, class_name, roll_number, profile_photo_url, onPress }: StudentCardProps) {
  return (
    <RecordCard title={name} subtitle={`${class_name} | Roll #${roll_number}`} avatarName={name} avatarUri={profile_photo_url}
      onPress={() => onPress?.(id)} />
  );
}
