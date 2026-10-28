import React from 'react';
import ContentListScreen from '../../components/content/ContentListScreen';
import { paperRow, type PaperDto } from '../../services/manager';
import { papersFetcher } from '../../hooks/useManager';

export default function Screen() {
  return <ContentListScreen<PaperDto> root="examPapers" fetcher={papersFetcher} toRow={paperRow} searchPlaceholder="Search papers..." emptyTitle="No question papers" />;
}
