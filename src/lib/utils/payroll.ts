import {
  ABSENCE_REASON_LABELS,
  Advance,
  Attendance,
  attendanceHasExtraWork,
  DEFAULT_PAY_CONTEXT,
  hourlyRateForAttendance,
  isFemale12hWorker,
  isMaleWorker,
  maleDailyRate,
  maleDayPay,
  maleStavkaFromStored,
  PayContext,
  PayrollRow,
  roundMoney,
  Worker,
} from '@/types/database';
import { toNumber } from '@/lib/utils';

function matchesStandard(value: number, standards: number[]) {
  return standards.some((standard) => Math.abs(standard - value) < 1);
}

function sameMoney(left: number, right: number) {
  return Math.abs(left - right) < 1;
}

function positionBasePay(worker: Worker, context: PayContext) {
  const key = worker.position?.trim().toLowerCase();
  if (!key) return null;
  const value = context.positionRates?.[key];
  return value == null || !Number.isFinite(value) ? null : value;
}

function rateFromPositionOrSchedule(
  stored: number,
  base: number | null,
  standards: number[],
  scheduleRate: number
) {
  if (base != null) {
    return sameMoney(stored, base) ? base : stored;
  }
  return matchesStandard(stored, standards) ? scheduleRate : stored;
}

export function calculatePayroll(
  workers: Worker[],
  attendance: Attendance[],
  advances: Advance[],
  month: string,
  context: PayContext = DEFAULT_PAY_CONTEXT
): PayrollRow[] {
  const monthPrefix = month.slice(0, 7);
  const { rates } = context;

  return workers.map((worker) => {
    const male = isMaleWorker(worker);
    const storedMale = maleDailyRate(toNumber(worker.hourly_rate));
    const storedHourly = toNumber(worker.hourly_rate);
    const basePay = positionBasePay(worker, context);
    const hourlyRate = male
      ? rateFromPositionOrSchedule(
          storedMale,
          basePay,
          context.standardMaleDaily,
          rates.maleDailyPay
        )
      : isFemale12hWorker(worker)
        ? storedHourly
        : rateFromPositionOrSchedule(
            storedHourly,
            basePay,
            context.standardFemale8h,
            rates.female8hHourly
          );
    const ratedWorker = { ...worker, hourly_rate: hourlyRate };
    const workerAttendance = attendance.filter(
      (a) => a.worker_id === worker.id && a.date.startsWith(monthPrefix)
    );

    const paidRecords = workerAttendance.filter(
      (a) => a.status === 'present' || a.status === 'late'
    );

    const totalStavka = male
      ? roundMoney(
          paidRecords.reduce(
            (sum, a) => sum + maleStavkaFromStored(toNumber(a.hours_worked)),
            0
          )
        )
      : 0;

    const extraWorkPay = male
      ? roundMoney(
          paidRecords.filter((record) => attendanceHasExtraWork(record.notes)).length *
            rates.maleExtraWorkPay
        )
      : 0;

    const totalHours = male
      ? 0
      : paidRecords.reduce((sum, a) => sum + toNumber(a.hours_worked), 0);

    const calculatedSalary = roundMoney(
      paidRecords.reduce((sum, record) => {
        if (male) {
          return (
            sum +
            maleDayPay(
              hourlyRate,
              maleStavkaFromStored(toNumber(record.hours_worked)),
              attendanceHasExtraWork(record.notes),
              rates.maleExtraWorkPay
            )
          );
        }
        return (
          sum +
          toNumber(record.hours_worked) *
            hourlyRateForAttendance(ratedWorker, record.shift, rates)
        );
      }, 0)
    );

    const advance = advances.find(
      (a) => a.worker_id === worker.id && a.month.startsWith(monthPrefix)
    );
    const advanceAmount = Math.max(0, toNumber(advance?.amount));
    const remainingAmount = calculatedSalary - advanceAmount;

    return {
      worker: ratedWorker,
      totalHours,
      totalStavka,
      extraWorkPay,
      calculatedSalary,
      advanceAmount,
      remainingAmount,
    };
  });
}

export function workersVisibleForMonth<T extends { id: string; is_active: boolean }>(
  workers: T[],
  attendanceWorkerIds: Iterable<string>
): T[] {
  const ids = new Set(attendanceWorkerIds);
  return workers.filter((worker) => worker.is_active || ids.has(worker.id));
}

export function getAbsenceReason(status: string, notes: string | null): string {
  if (notes) return notes;
  return ABSENCE_REASON_LABELS[status] || 'Kelmadi';
}

export function getDaysInMonth(month: string): number {
  const [year, mon] = month.split('-').map(Number);
  return new Date(year, mon, 0).getDate();
}

export function getMonthDateRange(month: string): { startDate: string; endDate: string } {
  const prefix = month.slice(0, 7);
  const days = getDaysInMonth(prefix);
  return {
    startDate: `${prefix}-01`,
    endDate: `${prefix}-${String(days).padStart(2, '0')}`,
  };
}

const UZ_MONTHS = [
  'yanvar',
  'fevral',
  'mart',
  'aprel',
  'may',
  'iyun',
  'iyul',
  'avgust',
  'sentabr',
  'oktabr',
  'noyabr',
  'dekabr',
];

export function formatMonthLabel(month: string): string {
  const [year, mon] = month.split('-').map(Number);
  return `${UZ_MONTHS[mon - 1] ?? month} ${year}`;
}

const UZ_WEEKDAYS = [
  'yakshanba',
  'dushanba',
  'seshanba',
  'chorshanba',
  'payshanba',
  'juma',
  'shanba',
];

export function formatTashkentTodayLabel(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tashkent',
    weekday: 'short',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? '';
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(part('weekday'));
  const month = Number(part('month')) - 1;
  return `${UZ_WEEKDAYS[weekday] ?? part('weekday')}, ${part('day')}-${UZ_MONTHS[month] ?? part('month')}, ${part('year')}`;
}

const TASHKENT_TIME_ZONE = 'Asia/Tashkent';

/** Server va brauzer bir xil kunni ko'rsin. Toshkent yarim tunda UTC hali kecha bo'ladi. */
export function todayInTashkent(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TASHKENT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function currentMonthInTashkent(now = new Date()): string {
  return todayInTashkent(now).slice(0, 7);
}

export function hourInTashkent(value: string | Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TASHKENT_TIME_ZONE,
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(value));
  const hour = Number(parts.find((item) => item.type === 'hour')?.value);
  if (!Number.isFinite(hour)) return 0;
  return hour === 24 ? 0 : hour;
}

export function isFutureDate(dateStr: string): boolean {
  return dateStr > todayInTashkent();
}

export function getMonthDates(month: string): string[] {
  const days = getDaysInMonth(month);
  const prefix = month.slice(0, 7);
  return Array.from({ length: days }, (_, i) => {
    const day = String(i + 1).padStart(2, '0');
    return `${prefix}-${day}`;
  });
}
