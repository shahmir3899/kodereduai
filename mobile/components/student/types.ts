// The slice of a React Query result the shared student/parent views need, so one view can show
// either the student's own data or a parent's child.
export interface Q<T> {
  data: T | undefined;
  isLoading: boolean;
  isError: boolean;
  error?: unknown;
  refetch: () => Promise<unknown>;
}
