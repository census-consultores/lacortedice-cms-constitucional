import { useState, useEffect, useCallback } from 'react';
import { useFetchClient } from '@strapi/strapi/admin';

interface User {
  id: number;
  username: string;
  email: string;
  provider: string;
  confirmed: boolean;
  blocked: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
  lastActiveAt: string | null;
  loginCount: number;
  isProfileComplete: boolean;
  userRole: string;
  university: string | null;
  profession: string | null;
  city: string | null;
  country: string | null;
  subscriptionTier: string;
}

interface Meta {
  page: number;
  pageSize: number;
  pageCount: number;
  total: number;
}

interface Stats {
  total: number;
  online: number;
  neverConnected: number;
  profileComplete: number;
  premium: number;
  registeredToday: number;
  registeredThisWeek: number;
  registeredThisMonth: number;
  blocked: number;
}

export function useUsers(params: {
  page: number;
  pageSize: number;
  search: string;
  status: string;
  sortBy: string;
  sortOrder: string;
}) {
  const [users, setUsers] = useState<User[]>([]);
  const [meta, setMeta] = useState<Meta>({ page: 1, pageSize: 25, pageCount: 1, total: 0 });
  const [loading, setLoading] = useState(true);
  const { get } = useFetchClient();

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const queryParams = new URLSearchParams({
        page: String(params.page),
        pageSize: String(params.pageSize),
        sortBy: params.sortBy,
        sortOrder: params.sortOrder,
      });
      if (params.search) queryParams.set('search', params.search);
      if (params.status) queryParams.set('status', params.status);

      const { data } = await get(`/admin-panel/users?${queryParams.toString()}`);
      setUsers(data.data || []);
      setMeta(data.meta || { page: 1, pageSize: 25, pageCount: 1, total: 0 });
    } catch (err) {
      console.error('[admin-panel] Error fetching users:', err);
    } finally {
      setLoading(false);
    }
  }, [get, params.page, params.pageSize, params.search, params.status, params.sortBy, params.sortOrder]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  return { users, meta, loading, refetch: fetchUsers };
}

export function useStats() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const { get } = useFetchClient();

  const fetchStats = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await get('/admin-panel/stats');
      setStats(data);
    } catch (err) {
      console.error('[admin-panel] Error fetching stats:', err);
    } finally {
      setLoading(false);
    }
  }, [get]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  return { stats, loading, refetch: fetchStats };
}
