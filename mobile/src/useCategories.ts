import {useCallback, useEffect, useRef, useState} from 'react';
import type {DepartmentChoice, IssueCategory} from '../shared/domain';
import {reportUnauthorized, type Connection} from './api';

/**
 * The reporting catalogue: issue categories (each may name its department) and the departments that have at least one enabled category.
 * Nothing is cached: the catalogue is fetched fresh every time the report flow opens (and again on `refreshToken` / `refresh()`),
 * so the app always matches what the admin portal currently offers.
 */
export function useCategories(connection: Connection, refreshToken = 0) {
  const [categories, setCategories] = useState<IssueCategory[]>([]);
  const [departments, setDepartments] = useState<DepartmentChoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setLoading(true);
    setError('');
    try {
      const response = await fetch(connection.url.replace(/\/$/, '') + '/api/categories', {
        headers: connection.token ? {Authorization: `Bearer ${connection.token}`} : {},
        cache: 'no-store',
        signal: current.signal,
      });
      if (response.status === 401) reportUnauthorized(connection.token);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to load issue categories.');
      if (!Array.isArray(result.categories)) throw new Error('Invalid category response. Please try again.');
      if (!current.signal.aborted) {
        setCategories(result.categories);
        // An older server sends no departments: every category then falls under "Other".
        setDepartments(Array.isArray(result.departments) ? result.departments : []);
      }
    } catch (e) {
      if (!current.signal.aborted) setError((e as Error).message);
    } finally {
      if (!current.signal.aborted) setLoading(false);
    }
  }, [connection.url, connection.token]);
  // This effect starts an external catalog request; loading is its request status.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    return () => controller.current?.abort();
  }, [refresh, refreshToken]);
  return {categories, departments, loading, error, refresh};
}
