import React from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import Skeleton from './Skeleton';
import ErrorState from './ErrorState';
import EmptyState from './EmptyState';
import { queryViewState } from '../../services/queryRules';

interface QueryBoundaryProps<T> {
  query: Pick<UseQueryResult<T>, 'data' | 'isLoading' | 'isError' | 'refetch'> &
    Partial<Pick<UseQueryResult<T>, 'error' | 'fetchStatus'>>;
  // Decides what counts as "nothing to show"; defaults to an empty array.
  isEmpty?: (data: T) => boolean;
  emptyTitle?: string;
  emptyMessage?: string;
  children: (data: T) => React.ReactNode;
}

// One place for the loading / error / empty / content branches every data screen needs.
export default function QueryBoundary<T>({
  query,
  isEmpty = (d) => Array.isArray(d) && d.length === 0,
  emptyTitle = 'Nothing here yet',
  emptyMessage,
  children,
}: QueryBoundaryProps<T>) {
  const hasData = query.data !== undefined;
  const state = queryViewState({
    isLoading: query.isLoading,
    isError: query.isError,
    hasData,
    isEmpty: hasData ? isEmpty(query.data as T) : false,
    isPaused: query.fetchStatus === 'paused',
  });

  if (state === 'loading') return <Skeleton />;
  if (state === 'offline') return <ErrorState offline onRetry={() => query.refetch()} />;
  if (state === 'error') return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  if (state === 'empty') return <EmptyState title={emptyTitle} message={emptyMessage} />;
  return <>{children(query.data as T)}</>;
}
