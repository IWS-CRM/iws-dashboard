import { isMissingSchema } from '@/lib/api/schema';
import { createSupabaseAdminClient } from '@/lib/providers/supabase/admin';
import {
  DEFAULT_PAY_RATES,
  ShiftLength,
  WORKER_POSITIONS,
  WorkerGender,
  isFemale12hWorker,
  isMaleWorker,
  maleDailyRate,
  roundMoney,
} from '@/types/database';

export const POSITIONS_MIGRATION_ERROR =
  "Baza yangilanmagan. Supabase SQL Editor'da 015_worker_positions.sql ni ishga tushiring yoki: npm run migrate";

export const POSITION_PAY_MIGRATION_ERROR =
  "Baza yangilanmagan. Supabase SQL Editor'da 016_position_base_pay.sql ni ishga tushiring yoki: npm run migrate";

export type WorkerPositionRow = {
  id: string;
  name: string;
  basePay: number | null;
};

const DEFAULT_POSITIONS: WorkerPositionRow[] = WORKER_POSITIONS.map((name) => ({
  id: '',
  name,
  basePay: null,
}));

type PositionWorker = {
  id: string;
  gender: WorkerGender | null;
  shift_length: ShiftLength | null;
  hourly_rate: number | null;
};

function rateWorker(worker: PositionWorker) {
  return {
    gender: worker.gender === 'male' || worker.gender === 'female' ? worker.gender : null,
    shift_length:
      worker.shift_length === 8 || worker.shift_length === 12 ? worker.shift_length : null,
  };
}

function normalizeName(raw: string) {
  return raw.trim().replace(/\s+/g, ' ');
}

function sameMoney(left: number, right: number) {
  return Math.abs(left - right) < 1;
}

function requirePay(raw: number) {
  const pay = roundMoney(Number(raw));
  if (!Number.isFinite(pay) || pay <= 0) {
    throw new Error('Boshlang‘ich stavka musbat son bo‘lishi kerak');
  }
  return pay;
}

function comparableRate(worker: PositionWorker) {
  const rated = rateWorker(worker);
  if (isFemale12hWorker(rated)) return null;
  if (isMaleWorker(rated)) return maleDailyRate(Number(worker.hourly_rate) || 0);
  return roundMoney(Number(worker.hourly_rate) || 0);
}

function shouldUpdateWorker(
  worker: PositionWorker,
  oldPay: number | null,
  newPay: number,
  standards: { male: number[]; female: number[] }
) {
  const current = comparableRate(worker);
  if (current == null) return false;
  if (oldPay != null) return sameMoney(current, oldPay);
  if (isMaleWorker(rateWorker(worker))) {
    return standards.male.some((rate) => sameMoney(current, rate)) && newPay >= current * 0.5;
  }
  return standards.female.some((rate) => sameMoney(current, rate)) && newPay <= Math.max(current, 1) * 3;
}

async function tariffStandards() {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from('pay_rate_schedules')
    .select('male_daily_pay, female_8h_hourly');
  if (error) {
    if (isMissingSchema(error)) {
      return {
        male: [DEFAULT_PAY_RATES.maleDailyPay],
        female: [DEFAULT_PAY_RATES.female8hHourly],
      };
    }
    throw error;
  }
  const rows = (data || []) as { male_daily_pay: number; female_8h_hourly: number }[];
  return {
    male: [DEFAULT_PAY_RATES.maleDailyPay, ...rows.map((row) => Number(row.male_daily_pay))],
    female: [DEFAULT_PAY_RATES.female8hHourly, ...rows.map((row) => Number(row.female_8h_hourly))],
  };
}

function mapPosition(row: { id: string; name: string; base_pay?: number | null }): WorkerPositionRow {
  const pay = row.base_pay == null ? null : roundMoney(Number(row.base_pay));
  return {
    id: row.id,
    name: row.name,
    basePay: pay != null && Number.isFinite(pay) ? pay : null,
  };
}

export async function listWorkerPositions(): Promise<{
  ready: boolean;
  payReady: boolean;
  positions: WorkerPositionRow[];
}> {
  const admin = createSupabaseAdminClient();
  const listed = await admin
    .from('worker_positions')
    .select('id, name, sort_order, base_pay')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });

  if (listed.error) {
    if (!isMissingSchema(listed.error)) throw listed.error;
    const fallback = await admin
      .from('worker_positions')
      .select('id, name, sort_order')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });
    if (fallback.error) {
      if (isMissingSchema(fallback.error)) {
        return { ready: false, payReady: false, positions: DEFAULT_POSITIONS };
      }
      throw fallback.error;
    }
    return {
      ready: true,
      payReady: false,
      positions: ((fallback.data || []) as { id: string; name: string }[]).map((row) => ({
        id: row.id,
        name: row.name,
        basePay: null,
      })),
    };
  }

  return {
    ready: true,
    payReady: true,
    positions: ((listed.data || []) as { id: string; name: string; base_pay: number | null }[]).map(
      mapPosition
    ),
  };
}

export async function listWorkerPositionNames() {
  const { positions } = await listWorkerPositions();
  return positions.map((position) => position.name);
}

export async function positionBasePay(name: string | null | undefined) {
  const key = name?.trim().toLowerCase();
  if (!key) return null;
  const { positions } = await listWorkerPositions();
  return positions.find((position) => position.name.trim().toLowerCase() === key)?.basePay ?? null;
}

async function workersOnPosition(name: string) {
  const admin = createSupabaseAdminClient();
  const rows: PositionWorker[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from('workers')
      .select('id, gender, shift_length, hourly_rate')
      .eq('position', name)
      .is('deleted_at', null)
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...((data || []) as PositionWorker[]));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

async function writeWorkerRates(ids: string[], pay: number) {
  if (ids.length === 0) return;
  const admin = createSupabaseAdminClient();
  const updatedAt = new Date().toISOString();
  for (let index = 0; index < ids.length; index += 100) {
    const slice = ids.slice(index, index + 100);
    const { error } = await admin
      .from('workers')
      .update({ hourly_rate: pay, updated_at: updatedAt })
      .in('id', slice);
    if (error) throw error;
  }
}

export async function syncPositionPay(name: string, oldPay: number | null, newPay: number) {
  const [workers, standards] = await Promise.all([
    workersOnPosition(name),
    tariffStandards(),
  ]);
  const ids = workers
    .filter((worker) => shouldUpdateWorker(worker, oldPay, newPay, standards))
    .map((worker) => worker.id);
  await writeWorkerRates(ids, newPay);
  const kept = workers.length - ids.length;
  const message =
    ids.length === 0
      ? `«${name}» boshlang‘ich stavkasi saqlandi. Stavkasi boshqacha bo‘lgan ishchilar o‘zgarmadi.`
      : `«${name}» stavkasi saqlandi. ${ids.length} ta ishchi yangilandi` +
        (kept > 0 ? `, ${kept} tasining stavkasi o‘zgarmadi.` : '.');
  return { updatedWorkers: ids.length, keptWorkers: kept, message };
}

export async function addWorkerPosition(raw: string, rawPay: number) {
  const name = normalizeName(raw);
  const basePay = requirePay(rawPay);
  if (name.length < 2 || name.length > 80) {
    throw new Error('Lavozim 2 dan 80 belgigacha bo‘lishi kerak');
  }

  const admin = createSupabaseAdminClient();
  const { data: existing, error: listError } = await admin
    .from('worker_positions')
    .select('id, name, sort_order');
  if (listError) {
    if (isMissingSchema(listError)) throw new Error(POSITIONS_MIGRATION_ERROR);
    throw listError;
  }

  const rows = (existing || []) as { name: string; sort_order: number }[];
  if (rows.some((row) => row.name.toLowerCase() === name.toLowerCase())) {
    throw new Error('Bu lavozim allaqachon bor');
  }

  const sortOrder = rows.reduce((max, row) => Math.max(max, row.sort_order || 0), 0) + 1;
  const { error } = await admin.from('worker_positions').insert({
    name,
    sort_order: sortOrder,
    base_pay: basePay,
  });
  if (error) {
    if (isMissingSchema(error)) {
      throw new Error(
        error.message?.includes('base_pay') ? POSITION_PAY_MIGRATION_ERROR : POSITIONS_MIGRATION_ERROR
      );
    }
    if (error.code === '23505') throw new Error('Bu lavozim allaqachon bor');
    throw error;
  }
  return name;
}

export async function updateWorkerPositionPay(id: string, rawPay: number) {
  const pay = requirePay(rawPay);
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from('worker_positions')
    .select('id, name, base_pay')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    if (isMissingSchema(error)) throw new Error(POSITION_PAY_MIGRATION_ERROR);
    throw error;
  }
  if (!data) throw new Error('Lavozim topilmadi');

  const oldPay = data.base_pay == null ? null : roundMoney(Number(data.base_pay));
  if (oldPay != null && sameMoney(oldPay, pay)) {
    return {
      name: data.name as string,
      previous: oldPay,
      next: pay,
      updatedWorkers: 0,
      message: `«${data.name}» stavkasi o‘zgarmadi.`,
    };
  }

  const { error: updateError } = await admin
    .from('worker_positions')
    .update({ base_pay: pay })
    .eq('id', id);
  if (updateError) {
    if (isMissingSchema(updateError)) throw new Error(POSITION_PAY_MIGRATION_ERROR);
    throw updateError;
  }

  const synced = await syncPositionPay(data.name as string, oldPay, pay);
  return {
    name: data.name as string,
    previous: oldPay,
    next: pay,
    updatedWorkers: synced.updatedWorkers,
    message: synced.message,
  };
}

export async function removeWorkerPosition(id: string) {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from('worker_positions')
    .select('id, name')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    if (isMissingSchema(error)) throw new Error(POSITIONS_MIGRATION_ERROR);
    throw error;
  }
  if (!data) throw new Error('Lavozim topilmadi');

  const { count, error: countError } = await admin
    .from('workers')
    .select('id', { count: 'exact', head: true })
    .eq('position', data.name)
    .is('deleted_at', null);
  if (countError) throw countError;
  if ((count ?? 0) > 0) {
    throw new Error(
      `Bu lavozimda ${count} ta ishchi bor. Avval ularning lavozimini o‘zgartiring.`
    );
  }

  const { error: deleteError } = await admin.from('worker_positions').delete().eq('id', id);
  if (deleteError) throw deleteError;
  return data.name as string;
}
