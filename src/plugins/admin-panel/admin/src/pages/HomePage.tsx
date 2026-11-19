import { useState, useEffect } from 'react';
import {
  Box,
  Flex,
  Typography,
  TextInput,
  SingleSelect,
  SingleSelectOption,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  Badge,
  Loader,
  IconButton,
} from '@strapi/design-system';
import { ArrowLeft, ArrowRight, ArrowClockwise } from '@strapi/icons';
import { useUsers, useStats } from '../hooks/useUsers';

function getStatusInfo(lastActiveAt: string | null, lastLoginAt: string | null) {
  if (!lastLoginAt && !lastActiveAt) {
    return { label: 'Nunca conectado', color: 'neutral' as const };
  }
  if (!lastActiveAt) {
    return { label: 'Desconectado', color: 'danger' as const };
  }
  const now = new Date();
  const lastActive = new Date(lastActiveAt);
  const diffMs = now.getTime() - lastActive.getTime();
  const diffMin = diffMs / 60000;

  if (diffMin < 5) return { label: 'En línea', color: 'success' as const };
  if (diffMin < 30) return { label: 'Inactivo', color: 'warning' as const };
  return { label: 'Desconectado', color: 'danger' as const };
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return '—';
  const date = new Date(dateStr);
  return date.toLocaleDateString('es-EC', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function timeAgo(dateStr: string | null) {
  if (!dateStr) return 'Nunca';
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHrs = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHrs / 24);

  if (diffMin < 1) return 'Ahora mismo';
  if (diffMin < 60) return `Hace ${diffMin} min`;
  if (diffHrs < 24) return `Hace ${diffHrs}h`;
  if (diffDays < 7) return `Hace ${diffDays}d`;
  return formatDate(dateStr);
}

const StatCard = ({ label, value, color }: { label: string; value: number; color?: string }) => (
  <Box
    padding={4}
    background="neutral0"
    shadow="filterShadow"
    hasRadius
    style={{ flex: '1 1 0', minWidth: 140 }}
  >
    <Typography variant="pi" textColor="neutral600" style={{ display: 'block', marginBottom: 4 }}>
      {label}
    </Typography>
    <Typography
      variant="alpha"
      textColor={color || 'neutral800'}
      style={{ display: 'block', fontSize: 28, fontWeight: 700 }}
    >
      {value}
    </Typography>
  </Box>
);

const HomePage = () => {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(timer);
  }, [search]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, status]);

  const { users, meta, loading, refetch } = useUsers({
    page,
    pageSize: 20,
    search: debouncedSearch,
    status,
    sortBy: 'lastActiveAt',
    sortOrder: 'desc',
  });

  const { stats, loading: statsLoading, refetch: refetchStats } = useStats();

  const handleRefresh = () => {
    refetch();
    refetchStats();
  };

  return (
    <Box padding={8} background="neutral100">
      {/* Header */}
      <Flex justifyContent="space-between" alignItems="center" paddingBottom={6}>
        <Box>
          <Typography variant="alpha" textColor="neutral800">
            Panel de Usuarios
          </Typography>
          <Typography variant="epsilon" textColor="neutral600" style={{ display: 'block', marginTop: 4 }}>
            Monitoreo de conexiones y actividad de usuarios registrados
          </Typography>
        </Box>
        <IconButton label="Actualizar" onClick={handleRefresh}>
          <ArrowClockwise />
        </IconButton>
      </Flex>

      {/* Stats */}
      {stats && (
        <Flex gap={4} paddingBottom={6} wrap="wrap">
          <StatCard label="Total Usuarios" value={stats.total} />
          <StatCard label="En Línea" value={stats.online} color="success600" />
          <StatCard label="Nunca Conectados" value={stats.neverConnected} color="warning600" />
          <StatCard label="Perfil Completo" value={stats.profileComplete} color="primary600" />
          <StatCard label="Premium" value={stats.premium} color="secondary600" />
          <StatCard label="Registrados Hoy" value={stats.registeredToday} />
        </Flex>
      )}
      {statsLoading && (
        <Flex justifyContent="center" paddingBottom={6}>
          <Loader small>Cargando estadísticas...</Loader>
        </Flex>
      )}

      {/* Filters */}
      <Flex gap={4} paddingBottom={4}>
        <Box style={{ flex: '1 1 300px' }}>
          <TextInput
            placeholder="Buscar por nombre o email..."
            value={search}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
            aria-label="Buscar usuarios"
          />
        </Box>
        <Box style={{ minWidth: 200 }}>
          <SingleSelect
            placeholder="Filtrar por estado"
            value={status}
            onChange={(val: string | number) => setStatus(String(val ?? ''))}
          >
            <SingleSelectOption value="">Todos</SingleSelectOption>
            <SingleSelectOption value="online">En línea</SingleSelectOption>
            <SingleSelectOption value="inactive">Inactivos</SingleSelectOption>
            <SingleSelectOption value="offline">Desconectados</SingleSelectOption>
            <SingleSelectOption value="never">Nunca conectados</SingleSelectOption>
          </SingleSelect>
        </Box>
      </Flex>

      {/* Users Table */}
      <Box background="neutral0" shadow="filterShadow" hasRadius>
        {loading ? (
          <Flex justifyContent="center" padding={8}>
            <Loader>Cargando usuarios...</Loader>
          </Flex>
        ) : (
          <>
            <Table colCount={7} rowCount={users.length}>
              <Thead>
                <Tr>
                  <Th><Typography variant="sigma">Usuario</Typography></Th>
                  <Th><Typography variant="sigma">Email</Typography></Th>
                  <Th><Typography variant="sigma">Estado</Typography></Th>
                  <Th><Typography variant="sigma">Último Login</Typography></Th>
                  <Th><Typography variant="sigma">Última Actividad</Typography></Th>
                  <Th><Typography variant="sigma">Logins</Typography></Th>
                  <Th><Typography variant="sigma">Perfil</Typography></Th>
                </Tr>
              </Thead>
              <Tbody>
                {users.length === 0 ? (
                  <Tr>
                    <Td colSpan={7}>
                      <Flex justifyContent="center" padding={6}>
                        <Typography textColor="neutral600">
                          No se encontraron usuarios
                        </Typography>
                      </Flex>
                    </Td>
                  </Tr>
                ) : (
                  users.map((user) => {
                    const statusInfo = getStatusInfo(user.lastActiveAt, user.lastLoginAt);
                    return (
                      <Tr key={user.id}>
                        <Td>
                          <Typography textColor="neutral800" fontWeight="semiBold">
                            {user.username}
                          </Typography>
                        </Td>
                        <Td>
                          <Typography textColor="neutral600">{user.email}</Typography>
                        </Td>
                        <Td>
                          <Badge
                            backgroundColor={
                              statusInfo.color === 'success' ? 'success100' :
                              statusInfo.color === 'warning' ? 'warning100' :
                              statusInfo.color === 'danger' ? 'danger100' : 'neutral150'
                            }
                            textColor={
                              statusInfo.color === 'success' ? 'success700' :
                              statusInfo.color === 'warning' ? 'warning700' :
                              statusInfo.color === 'danger' ? 'danger700' : 'neutral700'
                            }
                          >
                            {statusInfo.label}
                          </Badge>
                        </Td>
                        <Td>
                          <Typography textColor="neutral600">
                            {formatDate(user.lastLoginAt)}
                          </Typography>
                        </Td>
                        <Td>
                          <Typography textColor="neutral600">
                            {timeAgo(user.lastActiveAt)}
                          </Typography>
                        </Td>
                        <Td>
                          <Typography textColor="neutral800" fontWeight="semiBold">
                            {user.loginCount || 0}
                          </Typography>
                        </Td>
                        <Td>
                          <Badge
                            backgroundColor={user.isProfileComplete ? 'success100' : 'warning100'}
                            textColor={user.isProfileComplete ? 'success700' : 'warning700'}
                          >
                            {user.isProfileComplete ? 'Completo' : 'Incompleto'}
                          </Badge>
                        </Td>
                      </Tr>
                    );
                  })
                )}
              </Tbody>
            </Table>

            {/* Pagination */}
            {meta.pageCount > 1 && (
              <Flex justifyContent="space-between" alignItems="center" padding={4}>
                <Typography textColor="neutral600" variant="pi">
                  Mostrando {((meta.page - 1) * meta.pageSize) + 1}-{Math.min(meta.page * meta.pageSize, meta.total)} de {meta.total} usuarios
                </Typography>
                <Flex gap={2}>
                  <IconButton
                    label="Anterior"
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page <= 1}
                  >
                    <ArrowLeft />
                  </IconButton>
                  <Typography textColor="neutral800" variant="pi" fontWeight="bold">
                    {meta.page} / {meta.pageCount}
                  </Typography>
                  <IconButton
                    label="Siguiente"
                    onClick={() => setPage(p => Math.min(meta.pageCount, p + 1))}
                    disabled={page >= meta.pageCount}
                  >
                    <ArrowRight />
                  </IconButton>
                </Flex>
              </Flex>
            )}
          </>
        )}
      </Box>
    </Box>
  );
};

export default HomePage;
