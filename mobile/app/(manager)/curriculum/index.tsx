import React from 'react';
import { useRouter, type Href } from 'expo-router';
import ContentListScreen from '../../../components/content/ContentListScreen';
import { bookRow, type BookDto } from '../../../services/manager';
import { booksFetcher } from '../../../hooks/useManager';

export default function Screen() {
  const router = useRouter();
  return (
    <ContentListScreen<BookDto> root="books" fetcher={booksFetcher} toRow={bookRow}
      searchPlaceholder="Search books..." emptyTitle="No books"
      onPressRow={(r) => router.push({ pathname: '/(manager)/curriculum/book', params: { id: r.id } } as Href)} />
  );
}
