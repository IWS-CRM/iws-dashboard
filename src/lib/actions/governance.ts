'use server';

import { recordAudit } from '@/lib/api/audit';
import {
  addCreatorEmail as apiAddCreatorEmail,
  beginMfaEnrollment,
  confirmMfaEnrollment,
  createStaffAccount as apiCreateStaffAccount,
  getMfaState,
  getPendingAdvanceRequest,
  listCreatorEmails,
  listDeletedWorkers,
  listMonthLocks,
  listPendingAdvances,
  listStaffAccounts,
  removeCreatorEmail as apiRemoveCreatorEmail,
  resetStaffPassword as apiResetStaffPassword,
  resolveAdvanceRequest,
  restoreDeletedWorker,
  savePaySchedule as apiSavePaySchedule,
  setMonthLocked,
  updateStaffAccount as apiUpdateStaffAccount,
} from '@/lib/api/governance';
import { updateAdvance as apiUpdateAdvance } from '@/lib/api/payroll';
import { listPaySchedules, getPayContext } from '@/lib/api/pay-rates';
import {
  addWorkerPosition as apiAddWorkerPosition,
  listWorkerPositions,
  removeWorkerPosition as apiRemoveWorkerPosition,
  updateWorkerPositionPay as apiUpdateWorkerPositionPay,
} from '@/lib/api/positions';
import { totpAuthUrl } from '@/lib/auth/totp';
import { getSessionUser } from '@/lib/auth/auth.service';
import { requireRole } from '@/lib/auth/require-role';
import { formatCurrency } from '@/lib/utils';
import { currentMonthInTashkent, formatMonthLabel } from '@/lib/utils/payroll';
import { PayRates } from '@/types/database';
import { revalidatePath } from 'next/cache';

function actionError(err: unknown) {
  return err instanceof Error ? err.message : 'Xatolik yuz berdi';
}

function revalidateWork() {
  revalidatePath('/control');
  revalidatePath('/attendance');
  revalidatePath('/payroll');
  revalidatePath('/workers');
  revalidatePath('/users');
  revalidatePath('/dashboard');
  revalidatePath('/my');
}

export async function getCreatorSettings() {
  const actor = await requireRole(['creator']);
  const month = currentMonthInTashkent();
  const [schedules, locks, requests, deletedWorkers, creators, mfa, current, positions] =
    await Promise.all([
      listPaySchedules(),
      listMonthLocks(),
      listPendingAdvances(),
      listDeletedWorkers(),
      listCreatorEmails(),
      getMfaState(actor.id),
      getPayContext(month),
      listWorkerPositions(),
    ]);
  return {
    rates: current.rates,
    schedules,
    locks,
    requests,
    deletedWorkers,
    creators,
    mfaEnabled: mfa.enabled,
    positions: positions.positions,
    positionsReady: positions.ready,
    positionPayReady: positions.payReady,
  };
}

export async function getStaffDirectory() {
  await requireRole(['creator']);
  return listStaffAccounts();
}

export async function createStaffAccount(formData: FormData) {
  try {
    const actor = await requireRole(['creator']);
    const created = await apiCreateStaffAccount({
      fullName: String(formData.get('full_name') ?? ''),
      email: String(formData.get('email') ?? ''),
      password: String(formData.get('password') ?? ''),
      role: String(formData.get('role') ?? ''),
      locationId: String(formData.get('location_id') ?? '') || null,
    });
    await recordAudit({
      actor,
      action: 'staff.create',
      entityType: 'profile',
      entityId: created.id,
      entityName: created.fullName,
      summary: `${actor.full_name} ${created.fullName} hisobini yaratdi`,
      metadata: { email: created.email, role: created.role },
    });
    revalidateWork();
    return {};
  } catch (err) {
    return { error: actionError(err) };
  }
}

export async function updateStaffAccount(formData: FormData) {
  try {
    const actor = await requireRole(['creator']);
    const userId = String(formData.get('user_id') ?? '');
    const role = String(formData.get('role') ?? '');
    await apiUpdateStaffAccount({
      userId,
      role,
      locationId: String(formData.get('location_id') ?? '') || null,
    });
    await recordAudit({
      actor,
      action: 'staff.update',
      entityType: 'profile',
      entityId: userId,
      summary: `${actor.full_name} xodim roli va blokini yangiladi`,
      metadata: { role },
    });
    revalidateWork();
    return {};
  } catch (err) {
    return { error: actionError(err) };
  }
}

export async function resetStaffPassword(formData: FormData) {
  try {
    const actor = await requireRole(['creator']);
    const userId = String(formData.get('user_id') ?? '');
    await apiResetStaffPassword(userId, String(formData.get('password') ?? ''));
    await recordAudit({
      actor,
      action: 'staff.password_reset',
      entityType: 'profile',
      entityId: userId,
      summary: `${actor.full_name} xodim parolini yangiladi`,
    });
    revalidatePath('/control');
    revalidatePath('/users');
    return {};
  } catch (err) {
    return { error: actionError(err) };
  }
}

export async function lockMonth(month: string) {
  const actor = await requireRole(['creator']);
  const value = await setMonthLocked(month, true, actor.id);
  await recordAudit({
    actor,
    action: 'month.lock',
    entityType: 'month',
    entityName: value,
    summary: `${actor.full_name} ${formatMonthLabel(value)} oyini yopdi`,
    metadata: { month: value },
  });
  revalidateWork();
}

export async function unlockMonth(month: string) {
  const actor = await requireRole(['creator']);
  const value = await setMonthLocked(month, false, actor.id);
  await recordAudit({
    actor,
    action: 'month.unlock',
    entityType: 'month',
    entityName: value,
    summary: `${actor.full_name} ${formatMonthLabel(value)} oyini ochdi`,
    metadata: { month: value },
  });
  revalidateWork();
}

export async function savePaySchedule(formData: FormData) {
  try {
    const actor = await requireRole(['creator']);
    const rates: PayRates = {
      maleDailyPay: Number(formData.get('male_daily_pay')),
      maleExtraWorkPay: Number(formData.get('male_extra_work_pay')),
      female8hHourly: Number(formData.get('female_8h_hourly')),
      female12hDayPay: Number(formData.get('female_12h_day_pay')),
      female12hNightPay: Number(formData.get('female_12h_night_pay')),
      largeAdvanceLimit: Number(formData.get('large_advance_limit')),
    };
    const month = await apiSavePaySchedule(String(formData.get('effective_month') ?? ''), rates);
    await recordAudit({
      actor,
      action: 'pay.schedule',
      entityType: 'pay_rate',
      entityName: month,
      summary: `${actor.full_name} ${formatMonthLabel(month)} dan boshlab stavkalarni yangiladi`,
      metadata: { month, ...rates },
    });
    revalidateWork();
    return {};
  } catch (err) {
    return { error: actionError(err) };
  }
}

export async function approveAdvance(requestId: string) {
  const actor = await requireRole(['creator']);
  const request = await getPendingAdvanceRequest(requestId);
  await apiUpdateAdvance(request.worker_id, request.month, Number(request.amount));
  await resolveAdvanceRequest(requestId, 'approved', actor.id);
  await recordAudit({
    actor,
    action: 'payroll.advance_approve',
    entityType: 'advance',
    entityId: request.worker_id,
    entityName: request.workerName,
    summary: `${actor.full_name} ${request.workerName || 'ishchi'} avansini tasdiqladi: ${formatCurrency(Number(request.amount))}`,
    metadata: { month: request.month, amount: Number(request.amount) },
  });
  revalidateWork();
}

export async function rejectAdvance(requestId: string) {
  const actor = await requireRole(['creator']);
  const request = await resolveAdvanceRequest(requestId, 'rejected', actor.id);
  await recordAudit({
    actor,
    action: 'payroll.advance_reject',
    entityType: 'advance',
    entityId: request.worker_id,
    entityName: request.workerName,
    summary: `${actor.full_name} ${request.workerName || 'ishchi'} avans so‘rovini rad etdi`,
    metadata: { month: request.month, amount: Number(request.amount) },
  });
  revalidateWork();
}

export async function restoreWorker(workerId: string) {
  const actor = await requireRole(['creator']);
  const worker = await restoreDeletedWorker(workerId);
  await recordAudit({
    actor,
    action: 'worker.restore',
    entityType: 'worker',
    entityId: worker.id,
    entityName: worker.full_name,
    summary: `${actor.full_name} ${worker.full_name} ishchisini tikladi`,
  });
  revalidateWork();
}

export async function addWorkerPosition(formData: FormData) {
  try {
    const actor = await requireRole(['creator']);
    const name = await apiAddWorkerPosition(
      String(formData.get('name') ?? ''),
      Number(formData.get('base_pay'))
    );
    await recordAudit({
      actor,
      action: 'position.add',
      entityType: 'position',
      entityName: name,
      summary: `${actor.full_name} «${name}» lavozimini qo‘shdi`,
    });
    revalidatePath('/control');
    revalidatePath('/workers');
    return {};
  } catch (err) {
    return { error: actionError(err) };
  }
}

export async function updateWorkerPositionPay(formData: FormData) {
  try {
    const actor = await requireRole(['creator']);
    const result = await apiUpdateWorkerPositionPay(
      String(formData.get('id') ?? ''),
      Number(formData.get('base_pay'))
    );
    await recordAudit({
      actor,
      action: 'position.pay',
      entityType: 'position',
      entityId: String(formData.get('id') ?? ''),
      entityName: result.name,
      summary: result.message,
      metadata: {
        previous: result.previous,
        next: result.next,
        updatedWorkers: result.updatedWorkers,
      },
    });
    revalidateWork();
    return { message: result.message };
  } catch (err) {
    return { error: actionError(err) };
  }
}

export async function removeWorkerPosition(id: string) {
  const actor = await requireRole(['creator']);
  const name = await apiRemoveWorkerPosition(id);
  await recordAudit({
    actor,
    action: 'position.remove',
    entityType: 'position',
    entityId: id,
    entityName: name,
    summary: `${actor.full_name} «${name}» lavozimini o‘chirdi`,
  });
  revalidatePath('/control');
  revalidatePath('/workers');
}

export async function addCreatorEmail(formData: FormData) {
  try {
    const actor = await requireRole(['creator']);
    const email = await apiAddCreatorEmail(String(formData.get('email') ?? ''));
    await recordAudit({
      actor,
      action: 'creator.add',
      entityType: 'creator',
      entityName: email,
      summary: `${actor.full_name} zaxira creator qo‘shdi`,
    });
    revalidatePath('/control');
    return {};
  } catch (err) {
    return { error: actionError(err) };
  }
}

export async function removeCreatorEmail(email: string) {
  const actor = await requireRole(['creator']);
  const session = await getSessionUser();
  await apiRemoveCreatorEmail(email, session?.email);
  await recordAudit({
    actor,
    action: 'creator.remove',
    entityType: 'creator',
    entityName: email,
    summary: `${actor.full_name} zaxira creatorni olib tashladi`,
  });
  revalidatePath('/control');
}

export async function startCreatorMfa(currentCode?: string) {
  const actor = await requireRole(['creator']);
  const session = await getSessionUser();
  const secret = await beginMfaEnrollment(actor.id, currentCode);
  return {
    secret,
    otpauth: totpAuthUrl(session?.email || actor.full_name, secret),
  };
}

export async function confirmCreatorMfa(code: string) {
  const actor = await requireRole(['creator']);
  await confirmMfaEnrollment(actor.id, code);
  await recordAudit({
    actor,
    action: 'creator.mfa_enable',
    entityType: 'creator',
    entityId: actor.id,
    summary: `${actor.full_name} ikki bosqichli kirishni yoqdi`,
  });
  revalidatePath('/control');
}
