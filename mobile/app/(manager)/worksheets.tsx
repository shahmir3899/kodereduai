import React from 'react';
import ContentListScreen from '../../components/content/ContentListScreen';
import { worksheetRow, type WorksheetDto } from '../../services/manager';
import { worksheetsFetcher } from '../../hooks/useManager';

export default function Screen() {
  return <ContentListScreen<WorksheetDto> root="worksheets" fetcher={worksheetsFetcher} toRow={worksheetRow} searchPlaceholder="Search worksheets..." emptyTitle="No worksheets" />;
}
