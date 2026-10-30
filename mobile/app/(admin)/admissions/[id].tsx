import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import EnquiryDetailScreen from '../../../components/admissions/EnquiryDetailScreen';
import ErrorState from '../../../components/ui/ErrorState';

export default function Screen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const enquiryId = Number(id);
  if (!Number.isInteger(enquiryId) || enquiryId <= 0) return <ErrorState error={new Error('Enquiry not found.')} />;
  return <EnquiryDetailScreen id={enquiryId} />;
}
