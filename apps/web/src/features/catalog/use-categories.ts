import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/api/endpoints';
import { keys } from '@/shared/api/keys';

export function useCategories() {
  return useQuery({ queryKey: keys.categories, queryFn: api.categories, staleTime: 60_000 });
}
