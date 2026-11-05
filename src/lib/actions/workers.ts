'use server';

import {
  createWorker as apiCreateWorker,
  deleteWorker as apiDeleteWorker,
  getWorkerById as apiGetWorkerById,
  getWorkers as apiGetWorkers,
  updateWorker as apiUpdateWorker,
} from '@/lib/api/workers';
import { revokeUserSessions } from '@/lib/api/governance';
import {
  createWorkerAuthLogin,
  deleteWorkerAuthUser,
  provisionMissingWorkerLogins as apiProvisionMissingWorkerLogins,
  resetWorkerAuthPassword,
} from '@/lib/api/worker-login';
import { listWorkerPositionNames, positionBasePay } from '@/lib/api/positions';
import { recordAudit } from '@/lib/api/audit';
import { ADMIN_ROLES, ForbiddenError, requireRole } from '@/lib/auth/require-role';
import {
  defaultHourlyRate,
  ShiftLength,
  WorkerGender,
} from '@/types/database';
import { revalidatePath } from 'next/cache';

function parseGender(value: FormDataEntryValue | null): WorkerGender | null {
  return value === 'male' || value === 'female' ? value : null;
}

function parseShiftLength(
  gender: WorkerGender | null,
  value: FormDataEntryValue | null
): ShiftLength | null {
  if (gender !== 'female') return null;
  if (value === '8') return 8;
  if (value === '12') return 12;
  return null;
}

const WORKER_MIGRATION_ERROR =
  "Baza yangilanmagan. Supabase SQL Editor'da 007_female_shift_hours.sql yoki 008_worker_portal.sql migratsiyasini ishga tushiring yoki: npm run migrate";

function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null) {
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

function workerActionError(err: unknown): string {
  if (err instanceof ForbiddenError) {
    return err.message;
  }
  const message = errorText(err);
  if (message.includes('Lavozim')) return message;
  if (
    message.includes('gender') ||
    message.includes('shift_length') ||
    message.includes('login_code') ||
    message.includes('user_id') ||
    message.includes('PGRST204')
  ) {
    return WORKER_MIGRATION_ERROR;
  }
  return 'Xatolik yuz berdi';
}

async function applyPositionBase(
  position: string | null,
  gender: WorkerGender | null,
  shiftLength: ShiftLength | null,
  hourlyRate: number
) {
  if (!position || !gender || (gender === 'female' && shiftLength === 12)) return hourlyRate;
  const base = await positionBasePay(position);
  if (base == null) return hourlyRate;
  const fallback = gender ? defaultHourlyRate(gender, shiftLength) : 0;
  if (!hourlyRate || Math.abs(hourlyRate - fallback) < 1) return base;
  return hourlyRate;
}

async function resolvePosition(position: string | null, current?: string | null) {
  const trimmed = position?.trim() || null;
  if (!trimmed) return null;
  const names = await listWorkerPositionNames();
  const match = names.find((name) => name.toLowerCase() === trimmed.toLowerCase());
  if (match) return match;
  if (current && current.toLowerCase() === trimmed.toLowerCase()) return current;
  throw new Error('Lavozim ro‘yxatda yo‘q. Creator Nazorat sozlamalaridan qo‘shishi kerak.');
}

export async function getWorkers() {
  await requireRole(ADMIN_ROLES);
  return apiGetWorkers();
}

function workerPayload(formData: FormData) {
  const gender = parseGender(formData.get('gender'));
  const shift_length = parseShiftLength(gender, formData.get('shift_length'));
  const hourly_rate =
    parseFloat(formData.get('hourly_rate') as string) ||
    (gender ? defaultHourlyRate(gender, shift_length) : 0);

  return {
    full_name: formData.get('full_name') as string,
    position: (formData.get('position') as string) || null,
    phone: (formData.get('phone') as string) || null,
    gender,
    shift_length,
    hourly_rate,
  };
}

export async function createWorker(formData: FormData): Promise<{ error?: string }> {
  const actor = await requireRole(ADMIN_ROLES);
  const gender = parseGender(formData.get('gender'));
  const shift_length = parseShiftLength(gender, formData.get('shift_length'));
  if (gender === 'female' && shift_length === null) {
    return { error: 'Ayol ishchi uchun 8 yoki 12 soatlik rejimni tanlang' };
  }
  try {
    const payload = workerPayload(formData);
    payload.position = await resolvePosition(payload.position);
    payload.hourly_rate = await applyPositionBase(
      payload.position,
      gender,
      shift_length,
      payload.hourly_rate
    );
    const worker = await apiCreateWorker({
      ...payload,
      start_date:
        (formData.get('start_date') as string) ||
        new Date().toISOString().split('T')[0],
    });
    await recordAudit({
      actor,
      action: 'worker.create',
      entityType: 'worker',
      entityId: worker.id,
      entityName: worker.full_name,
      summary: `${actor.full_name} ${worker.full_name} ishchisini qo‘shdi`,
    });
    if (worker.login_code) {
      try {
        await createWorkerAuthLogin(worker.id);
      } catch (err) {
        revalidatePath('/workers');
        revalidatePath('/dashboard');
        revalidatePath('/attendance');
        revalidatePath('/payroll');
        return {
          error: `Ishchi saqlandi, lekin kirish yaratilmadi: ${
            err instanceof Error ? err.message : workerActionError(err)
          }`,
        };
      }
    }
  } catch (err) {
    return { error: workerActionError(err) };
  }

  revalidatePath('/workers');
  revalidatePath('/dashboard');
  revalidatePath('/attendance');
  revalidatePath('/payroll');
  return {};
}

export async function updateWorker(
  id: string,
  formData: FormData
): Promise<{ error?: string }> {
  const actor = await requireRole(ADMIN_ROLES);
  const gender = parseGender(formData.get('gender'));
  const shift_length = parseShiftLength(gender, formData.get('shift_length'));
  if (gender === 'female' && shift_length === null) {
    return { error: 'Ayol ishchi uchun 8 yoki 12 soatlik rejimni tanlang' };
  }
  try {
    const existing = await apiGetWorkerById(id);
    const payload = workerPayload(formData);
    payload.position = await resolvePosition(payload.position, existing?.position);
    await apiUpdateWorker(id, {
      ...payload,
      start_date: formData.get('start_date') as string,
      is_active: formData.get('is_active') === 'true',
    });
    await recordAudit({
      actor,
      action: 'worker.update',
      entityType: 'worker',
      entityId: id,
      entityName: payload.full_name,
      summary: `${actor.full_name} ${payload.full_name} ishchisini tahrirladi`,
    });
    if (
      existing?.user_id &&
      existing.full_name.trim() !== payload.full_name.trim()
    ) {
      await resetWorkerAuthPassword(id);
    }
  } catch (err) {
    return { error: workerActionError(err) };
  }

  revalidatePath('/workers');
  revalidatePath('/dashboard');
  revalidatePath('/attendance');
  revalidatePath('/payroll');
  return {};
}

export async function deleteWorker(id: string) {
  const actor = await requireRole(ADMIN_ROLES);
  const worker = await apiGetWorkerById(id);
  const softDeleted = await apiDeleteWorker(id);
  await recordAudit({
    actor,
    action: 'worker.delete',
    entityType: 'worker',
    entityId: id,
    entityName: worker?.full_name,
    summary: `${actor.full_name} ${worker?.full_name || 'ishchi'}ni o‘chirdi`,
  });
  if (worker?.user_id) {
    if (softDeleted) await revokeUserSessions(worker.user_id);
    else await deleteWorkerAuthUser(worker.user_id);
  }
  revalidatePath('/workers');
  revalidatePath('/dashboard');
  revalidatePath('/attendance');
  revalidatePath('/payroll');
  revalidatePath('/my');
}

export async function createWorkerLogin(
  workerId: string
): Promise<{ error?: string; loginCode?: string; password?: string }> {
  try {
    const actor = await requireRole(ADMIN_ROLES);
    const result = await createWorkerAuthLogin(workerId);
    const worker = await apiGetWorkerById(workerId);
    await recordAudit({
      actor,
      action: 'worker.login_create',
      entityType: 'worker',
      entityId: workerId,
      entityName: worker?.full_name,
      summary: `${actor.full_name} ${worker?.full_name || 'ishchi'} uchun kirish yaratdi`,
    });
    revalidatePath('/workers');
    return {
      loginCode: result.loginCode ?? undefined,
      password: result.password,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : workerActionError(err) };
  }
}

export async function resetWorkerLogin(
  workerId: string
): Promise<{ error?: string; loginCode?: string; password?: string }> {
  try {
    const actor = await requireRole(ADMIN_ROLES);
    const result = await resetWorkerAuthPassword(workerId);
    const worker = await apiGetWorkerById(workerId);
    await recordAudit({
      actor,
      action: 'worker.login_reset',
      entityType: 'worker',
      entityId: workerId,
      entityName: worker?.full_name,
      summary: `${actor.full_name} ${worker?.full_name || 'ishchi'} parolini yangiladi`,
    });
    revalidatePath('/workers');
    return {
      loginCode: result.loginCode ?? undefined,
      password: result.password,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : workerActionError(err) };
  }
}

export async function provisionMissingWorkerLogins(): Promise<{
  error?: string;
  created?: number;
  failed?: number;
  errors?: string[];
  passwords?: { fullName: string; loginCode: string; password: string }[];
}> {
  try {
    const actor = await requireRole(ADMIN_ROLES);
    const result = await apiProvisionMissingWorkerLogins();
    await recordAudit({
      actor,
      action: 'worker.login_provision',
      entityType: 'worker',
      summary: `${actor.full_name} ${result.created} ta kirish yaratdi`,
      metadata: { created: result.created, failed: result.failed },
    });
    revalidatePath('/workers');
    return result;
  } catch (err) {
    return { error: err instanceof Error ? err.message : workerActionError(err) };
  }
}
