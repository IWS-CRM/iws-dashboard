'use server';

import {
  getAttendanceByMonth as apiGetAttendanceByMonth,
  getAttendanceHistory as apiGetAttendanceHistory,
  getDashboardStats as apiGetDashboardStats,
  markAttendanceBatch as apiMarkAttendanceBatch,
} from '@/lib/api/attendance';
import { recordAudit } from '@/lib/api/audit';
import { brigadeMonthScope, dashboardStatsForLocation } from '@/lib/api/brigade';
import { assertMonthEditable, isMonthLocked } from '@/lib/api/governance';
import { getPayContext } from '@/lib/api/pay-rates';
import { getWorkersIncludingDeleted } from '@/lib/api/workers';
import { STAFF_ROLES, requireRole } from '@/lib/auth/require-role';
import {
  AttendanceShift,
  AttendanceStatus,
  MALE_SHIFT_HOURS,
  PayRates,
  isFemale12hWorker,
  isMaleStavka,
  isMaleWorker,
  roundMoney,
} from '@/types/database';
import { formatMonthLabel } from '@/lib/utils/payroll';
import { revalidatePath } from 'next/cache';

export async function getAttendanceByMonth(month: string): Promise<{
  workers: Awaited<ReturnType<typeof apiGetAttendanceByMonth>>['workers'];
  attendance: Awaited<ReturnType<typeof apiGetAttendanceByMonth>>['attendance'];
  scopeNote: string | null;
  locked: boolean;
  rates: PayRates;
  editableKeys: string[] | null;
}> {
  const profile = await requireRole(STAFF_ROLES);
  const [data, payContext, locked] = await Promise.all([
    apiGetAttendanceByMonth(month),
    getPayContext(month),
    isMonthLocked(month),
  ]);

  if (profile.role !== 'brigadier') {
    return { ...data, scopeNote: null, locked, rates: payContext.rates, editableKeys: null };
  }
  if (!profile.assigned_location_id) {
    return {
      workers: [],
      attendance: [],
      scopeNote: 'Sizga blok biriktirilmagan. Creator blok biriktirgach davomat ochiladi.',
      locked,
      rates: payContext.rates,
      editableKeys: [],
    };
  }
  const scope = await brigadeMonthScope(profile.assigned_location_id, month);
  return {
    workers: data.workers.filter((worker) => scope.workerIds.has(worker.id)),
    attendance: data.attendance.filter((row) =>
      scope.editableKeys.has(`${row.worker_id}:${row.date}`)
    ),
    scopeNote:
      scope.workerIds.size === 0
        ? 'Bu blokda biriktirilgan ishchi yo‘q.'
        : null,
    locked,
    rates: payContext.rates,
    editableKeys: [...scope.editableKeys],
  };
}

function recordMonth(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('Sana noto‘g‘ri');
  }
  return date.slice(0, 7);
}

function acceptableMaleHours(hours: number) {
  if (isMaleStavka(hours)) return true;
  if (hours > 2 && isMaleStavka(roundMoney(hours / MALE_SHIFT_HOURS))) return true;
  return false;
}

export async function saveAttendanceBatch(
  records: {
    workerId: string;
    date: string;
    status: AttendanceStatus;
    hoursWorked?: number;
    shift?: AttendanceShift | null;
    notes?: string;
  }[]
) {
  const actor = await requireRole(STAFF_ROLES);
  try {
    const months = [...new Set(records.map((record) => recordMonth(record.date)))];
    const month = months[0];
    if (actor.role === 'brigadier') {
      if (!actor.assigned_location_id) {
        throw new Error('Sizga blok biriktirilmagan.');
      }
      for (const scopeMonth of months) {
        const scope = await brigadeMonthScope(actor.assigned_location_id, scopeMonth);
        const outside = records.some(
          (record) =>
            recordMonth(record.date) === scopeMonth &&
            !scope.editableKeys.has(`${record.workerId}:${record.date}`)
        );
        if (outside) throw new Error('Bu ishchi bu kunda sizning blokingizda emas.');
      }
    }
    for (const scopeMonth of months) {
      await assertMonthEditable(scopeMonth, actor.role);
    }

    const workers = await getWorkersIncludingDeleted();
    const workerById = new Map(workers.map((worker) => [worker.id, worker]));
    for (const record of records) {
      const worker = workerById.get(record.workerId);
      if (!worker) throw new Error('Ishchi topilmadi');
      const paid = record.status === 'present' || record.status === 'late';
      if (!paid) continue;
      if (isFemale12hWorker(worker) && record.shift !== 'day' && record.shift !== 'night') {
        throw new Error('12 soatlik ayol uchun kunduzgi yoki kechki smena kerak');
      }
      if (isMaleWorker(worker) && !acceptableMaleHours(Number(record.hoursWorked ?? 0))) {
        throw new Error('Erkak stavkasi 0.5, 1, 1.5 yoki 2 bo‘lishi kerak');
      }
    }

    const before = month ? await apiGetAttendanceByMonth(month) : null;
    const previous = new Map(
      (before?.attendance || []).map((row) => [`${row.worker_id}:${row.date}`, row])
    );
    const names = new Map((before?.workers || []).map((worker) => [worker.id, worker.full_name]));
    const changes = records.flatMap((record) => {
      const prev = previous.get(`${record.workerId}:${record.date}`);
      const same =
        prev &&
        prev.status === record.status &&
        Number(prev.hours_worked) === Number(record.hoursWorked ?? 0) &&
        (prev.notes || '') === (record.notes || '') &&
        (prev.shift || null) === (record.shift || null);
      if (same || (!prev && record.status === 'absent' && !record.hoursWorked && !record.notes)) {
        return [];
      }
      return [
        {
          worker: names.get(record.workerId) || 'Ishchi',
          date: record.date,
          from: prev ? `${prev.status} ${prev.hours_worked}` : '—',
          to: `${record.status} ${record.hoursWorked ?? 0}`,
        },
      ];
    });

    await apiMarkAttendanceBatch(records);
    const monthLabel = month ? formatMonthLabel(month) : '';
    await recordAudit({
      actor,
      action: 'attendance.save',
      entityType: 'attendance',
      entityName: month,
      summary: `${actor.full_name} davomatni${monthLabel ? ` ${monthLabel} oyida` : ''} ${changes.length} qator tahrirladi`,
      metadata: {
        count: changes.length,
        month,
        changes: changes.slice(0, 40),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('hours_worked')) {
      throw new Error(
        "Baza yangilanmagan. Supabase SQL Editor'da 004_hourly_salary_and_advances.sql migratsiyasini ishga tushiring yoki: npm run migrate"
      );
    }
    if (
      message.includes('shift') ||
      message.includes('attendance_shift') ||
      message.includes('PGRST204')
    ) {
      throw new Error(
        "Baza yangilanmagan. Supabase SQL Editor'da 007_female_shift_hours.sql migratsiyasini ishga tushiring yoki: npm run migrate"
      );
    }
    throw err;
  }
  revalidatePath('/attendance');
  revalidatePath('/dashboard');
  revalidatePath('/payroll');
  revalidatePath('/my');
}

export async function getAttendanceHistory(workerId: string, month: string) {
  const actor = await requireRole(STAFF_ROLES);
  const rows = await apiGetAttendanceHistory(workerId, month);
  if (actor.role !== 'brigadier') return rows;
  if (!actor.assigned_location_id) {
    throw new Error('Sizga blok biriktirilmagan.');
  }
  const scope = await brigadeMonthScope(actor.assigned_location_id, month);
  if (!scope.workerIds.has(workerId)) {
    throw new Error('Bu ishchi sizning blokingizda emas.');
  }
  return rows.filter((row) => scope.editableKeys.has(`${row.worker_id}:${row.date}`));
}

export async function getDashboardStats() {
  const profile = await requireRole(STAFF_ROLES);
  if (profile.role !== 'brigadier') return apiGetDashboardStats();
  if (!profile.assigned_location_id) {
    return { totalWorkers: 0, todayPresent: 0, todayAbsent: 0, todayLate: 0 };
  }
  return dashboardStatsForLocation(profile.assigned_location_id);
}
