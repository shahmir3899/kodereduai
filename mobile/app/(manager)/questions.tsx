import React from 'react';
import ContentListScreen from '../../components/content/ContentListScreen';
import { questionRow, type QuestionDto } from '../../services/manager';
import { questionsFetcher } from '../../hooks/useManager';

export default function Screen() {
  return <ContentListScreen<QuestionDto> root="questionBank" fetcher={questionsFetcher} toRow={questionRow} searchPlaceholder="Search questions..." emptyTitle="No questions" />;
}
