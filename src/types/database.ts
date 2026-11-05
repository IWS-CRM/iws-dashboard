export type UserRole = 'superadmin' | 'admin' | 'brigadier' | 'worker' | 'creator';

export type AttendanceStatus =
  | 'present'
  | 'absent'
  | 'late'
  | 'holiday'
  | 'sick_leave';

export type WorkerGender = 'male' | 'female';
export type ShiftLength = 8 | 12;
export type AttendanceShift = 'day' | 'night';

export const MALE_SHIFT_PAY = 140_000;
export const MALE_DAILY_PAY = MALE_SHIFT_PAY;
export const MALE_SHIFT_HOURS = 12;
export const MALE_EXTRA_WORK_PAY = 50_000;
export const MALE_EXTRA_WORK_NOTE = 'extra_work';
export const MALE_STAVKA_OPTIONS = [0.5, 1, 1.5, 2] as const;
export type MaleStavka = (typeof MALE_STAVKA_OPTIONS)[number];
export const FEMALE_8H_HOURLY_RATE = 15_000;
export const FEMALE_HOURLY_RATE = FEMALE_8H_HOURLY_RATE;
export const FEMALE_12H_HOURS = 12;
export const FEMALE_12H_DAY_PAY = 160_000;
export const FEMALE_12H_NIGHT_PAY = 180_000;

export function roundMoney(amount: number): number {
  return Math.round(amount * 100) / 100;
}

export interface PayRates {
  maleDailyPay: number;
  maleExtraWorkPay: number;
  female8hHourly: number;
  female12hDayPay: number;
  female12hNightPay: number;
  largeAdvanceLimit: number;
}

export const DEFAULT_PAY_RATES: PayRates = {
  maleDailyPay: MALE_DAILY_PAY,
  maleExtraWorkPay: MALE_EXTRA_WORK_PAY,
  female8hHourly: FEMALE_8H_HOURLY_RATE,
  female12hDayPay: FEMALE_12H_DAY_PAY,
  female12hNightPay: FEMALE_12H_NIGHT_PAY,
  largeAdvanceLimit: 500_000,
};

export interface PayContext {
  rates: PayRates;
  standardMaleDaily: number[];
  standardFemale8h: number[];
  positionRates: Record<string, number>;
}

export const DEFAULT_PAY_CONTEXT: PayContext = {
  rates: DEFAULT_PAY_RATES,
  standardMaleDaily: [MALE_DAILY_PAY],
  standardFemale8h: [FEMALE_8H_HOURLY_RATE],
  positionRates: {},
};

export function female12hDayHourly(rates: PayRates = DEFAULT_PAY_RATES): number {
  return rates.female12hDayPay / FEMALE_12H_HOURS;
}

export function female12hNightHourly(rates: PayRates = DEFAULT_PAY_RATES): number {
  return rates.female12hNightPay / FEMALE_12H_HOURS;
}

export function defaultHourlyRate(
  gender: WorkerGender,
  shiftLength?: ShiftLength | null,
  rates: PayRates = DEFAULT_PAY_RATES
): number {
  if (gender === 'male') {
    return rates.maleDailyPay;
  }
  if (shiftLength === 12) {
    return roundMoney(female12hDayHourly(rates));
  }
  return rates.female8hHourly;
}

export function isMaleWorker(worker: Pick<Worker, 'gender'>): boolean {
  return worker.gender === 'male';
}

/** Erkak `hourly_rate` i 1 stavkaning kunlik summasi. Eski yozuvlar soatbay saqlangan. */
export function maleDailyRate(storedRate: number): number {
  const rate = Number(storedRate) || 0;
  if (rate <= 0) return MALE_DAILY_PAY;
  if (rate < MALE_DAILY_PAY / 2) {
    return Math.round(rate * MALE_SHIFT_HOURS);
  }
  return Math.round(rate);
}

export function isMaleStavka(value: number): value is MaleStavka {
  return MALE_STAVKA_OPTIONS.some((option) => Math.abs(option - value) < 0.001);
}

export function nearestMaleStavka(value: number): MaleStavka {
  return MALE_STAVKA_OPTIONS.reduce((best, option) =>
    Math.abs(option - value) < Math.abs(best - value) ? option : best
  );
}

/**
 * Erkak davomatida `hours_worked` stavkani saqlaydi: 0.5, 1, 1.5 yoki 2.
 * 2 dan katta qiymatlar eski soat yozuvi (12 soat = 1 stavka).
 */
export function maleStavkaFromStored(hoursWorked: number): number {
  const hours = Number(hoursWorked) || 0;
  if (hours <= 0) return 0;
  const stavka = hours > 2 ? roundMoney(hours / MALE_SHIFT_HOURS) : roundMoney(hours);
  if (isMaleStavka(stavka)) return stavka;
  return nearestMaleStavka(stavka);
}

export function formatStavka(value: number): string {
  const rounded = roundMoney(value);
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

export function attendanceHasExtraWork(notes: string | null | undefined): boolean {
  return (notes ?? '').trim() === MALE_EXTRA_WORK_NOTE;
}

export function maleDayPay(
  dailyRate: number,
  stavka: number,
  extraWork = false,
  extraPay = MALE_EXTRA_WORK_PAY
): number {
  return roundMoney(
    (Number(dailyRate) || 0) * (Number(stavka) || 0) + (extraWork ? extraPay : 0)
  );
}

export interface Profile {
  id: string;
  full_name: string;
  role: UserRole;
  assigned_location_id: string | null;
  access_disabled?: boolean;
  created_at: string;
  updated_at: string;
}

export interface WorkLocation {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Worker {
  id: string;
  full_name: string;
  position: string | null;
  phone: string | null;
  start_date: string;
  gender: WorkerGender | null;
  shift_length: ShiftLength | null;
  hourly_rate: number;
  login_code: string | null;
  user_id: string | null;
  is_active: boolean;
  login_enabled?: boolean;
  deleted_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuditEvent {
  id: string;
  actor_id: string | null;
  actor_name: string;
  actor_role: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  entity_name: string | null;
  summary: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface ActivityPing {
  user_id: string;
  full_name: string;
  role: string | null;
  last_seen_at: string;
}

export interface ControlAlertAction {
  kind: 'disable-staff' | 'disable-worker' | 'lock-month' | 'restore-worker';
  targetId: string;
  label: string;
}

export interface ControlAlert {
  id: string;
  title: string;
  detail: string;
  createdAt: string;
  severity: 'warning' | 'danger';
  section: string;
  href?: string;
  action?: ControlAlertAction;
}

export interface ControlLoginRow {
  id: string;
  fullName: string;
  role: string;
  loginCode: string | null;
  lastLoggedInAt: string | null;
  isOnline: boolean;
  hasLoggedIn: boolean;
  loginEnabled: boolean;
  kind: 'worker' | 'staff';
}

export function isFemale12hWorker(
  worker: Pick<Worker, 'gender' | 'shift_length'>
): boolean {
  return worker.gender === 'female' && Number(worker.shift_length) === 12;
}

export function defaultHoursForWorker(
  worker: Pick<Worker, 'shift_length'>
): number {
  if (Number(worker.shift_length) === 8) return 8;
  return 12;
}

export function hourlyRateForAttendance(
  worker: Pick<Worker, 'gender' | 'shift_length' | 'hourly_rate'>,
  shift: AttendanceShift | null | undefined,
  rates: PayRates = DEFAULT_PAY_RATES
): number {
  if (isFemale12hWorker(worker)) {
    return shift === 'night' ? female12hNightHourly(rates) : female12hDayHourly(rates);
  }
  return Number(worker.hourly_rate) || 0;
}

export interface WorkerLocationAssignment {
  id: string;
  worker_id: string;
  location_id: string;
  assignment_date: string;
  created_at: string;
  worker?: Worker;
  location?: WorkLocation;
}

export interface Attendance {
  id: string;
  worker_id: string;
  date: string;
  status: AttendanceStatus;
  hours_worked: number;
  shift: AttendanceShift | null;
  notes: string | null;
  marked_by: string | null;
  created_at: string;
  updated_at: string;
  worker?: Worker;
}

export interface Advance {
  id: string;
  worker_id: string;
  month: string;
  amount: number;
  created_at: string;
  updated_at: string;
  worker?: Worker;
}

export interface PayrollRow {
  worker: Worker;
  totalHours: number;
  totalStavka: number;
  extraWorkPay: number;
  calculatedSalary: number;
  advanceAmount: number;
  remainingAmount: number;
}

export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: 'Keldi',
  absent: 'Kelmadi',
  late: 'Kech qoldi',
  holiday: 'Ta\'til',
  sick_leave: 'Kasallik',
};

export const ATTENDANCE_STATUS_COLORS: Record<AttendanceStatus, string> = {
  present: 'bg-green-100 text-green-800',
  absent: 'bg-red-100 text-red-800',
  late: 'bg-yellow-100 text-yellow-800',
  holiday: 'bg-blue-100 text-blue-800',
  sick_leave: 'bg-purple-100 text-purple-800',
};

export interface ProfileLogin {
  id: string;
  user_id: string | null;
  worker_id: string | null;
  full_name: string;
  login_code: string | null;
  role: string;
  logged_in_at: string;
}

export interface WorkerLoginStatus {
  workerId: string;
  fullName: string;
  loginCode: string | null;
  lastLoggedInAt: string | null;
  loginCount: number;
  hasLoggedIn: boolean;
}

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  superadmin: 'Superadmin',
  admin: 'Admin',
  brigadier: 'Brigadir',
  worker: 'Ishchi',
  creator: 'Creator',
};

export const WORKER_GENDER_LABELS: Record<WorkerGender, string> = {
  male: 'Erkak',
  female: 'Ayol',
};

export const SHIFT_LENGTH_LABELS: Record<ShiftLength, string> = {
  8: '8 soatlik',
  12: '12 soatlik',
};

export const ATTENDANCE_SHIFT_LABELS: Record<AttendanceShift, string> = {
  day: 'Kunduzgi',
  night: 'Kechki',
};

export const WORKER_POSITIONS = [
  'Qadoqlovchi',
  'Qandolatchi',
  'Yordamchi qandolatchi',
  'Surmachi (vafli)',
  'Pechkachi (vafli)',
  'Xamirchi (vafli)',
  'Yuk tashuvchi',
  'Kremchi',
  'Pechkachi (pechenye)',
  'Xamirchi (pechenye)',
  'Sendvich operatori',
  'Brigader',
  'Ish boshqaruvchi',
  'Oshpaz',
  'Farrosh',
] as const;

export type WorkerPosition = (typeof WORKER_POSITIONS)[number];

export const ABSENCE_REASON_LABELS: Record<string, string> = {
  absent: 'Sababsiz kelmadi',
  sick_leave: 'Kasallik',
  holiday: 'Ta\'til',
  late: 'Kech qoldi',
};
