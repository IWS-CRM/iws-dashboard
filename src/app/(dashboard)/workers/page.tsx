import { getWorkers } from '@/lib/actions/workers';
import { getPayContext } from '@/lib/api/pay-rates';
import { listWorkerPositions } from '@/lib/api/positions';
import { WorkersTable } from '@/components/workers/workers-table';
import { PageHeader } from '@/components/layout/page-header';
import { ADMIN_ROLES, requirePageRole } from '@/lib/auth/require-role';
import { todayInTashkent } from '@/lib/utils/payroll';
import { WORKER_POSITIONS } from '@/types/database';

export default async function WorkersPage() {
  await requirePageRole(ADMIN_ROLES);
  const month = todayInTashkent().slice(0, 7);
  const [workers, payContext, positions] = await Promise.all([
    getWorkers(),
    getPayContext(month),
    listWorkerPositions().catch(() => ({
      ready: false,
      payReady: false,
      positions: WORKER_POSITIONS.map((name) => ({ id: '', name, basePay: null })),
    })),
  ]);

  return (
    <div>
      <PageHeader title="Ishchilar" description="Zavod ishchilarini boshqarish" />
      <WorkersTable
        initialWorkers={workers}
        rates={payContext.rates}
        positions={positions.positions.map((position) => ({
          name: position.name,
          basePay: position.basePay,
        }))}
      />
    </div>
  );
}
