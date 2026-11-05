import { listWorkerPositions } from '@/lib/api/positions';
import { createSupabaseAdminClient } from '@/lib/providers/supabase/admin';
import { isMissingSchema } from '@/lib/api/schema';
import {
  DEFAULT_PAY_CONTEXT,
  DEFAULT_PAY_RATES,
  PayContext,
  PayRates,
} from '@/types/database';

interface ScheduleRow {
  effective_month: string;
  male_daily_pay: number;
  male_extra_work_pay: number;
  female_8h_hourly: number;
  female_12h_day_pay: number;
  female_12h_night_pay: number;
  large_advance_limit: number;
}

async function loadPositionRates() {
  try {
    const listed = await listWorkerPositions();
    const rates: Record<string, number> = {};
    for (const position of listed.positions) {
      if (position.basePay == null) continue;
      rates[position.name.trim().toLowerCase()] = position.basePay;
    }
    return rates;
  } catch {
    return {};
  }
}

function toRates(row: ScheduleRow): PayRates {
  return {
    maleDailyPay: Number(row.male_daily_pay),
    maleExtraWorkPay: Number(row.male_extra_work_pay),
    female8hHourly: Number(row.female_8h_hourly),
    female12hDayPay: Number(row.female_12h_day_pay),
    female12hNightPay: Number(row.female_12h_night_pay),
    largeAdvanceLimit: Number(row.large_advance_limit),
  };
}

export async function getPayContext(month: string): Promise<PayContext> {
  const target = month.slice(0, 7);
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from('pay_rate_schedules')
      .select(
        'effective_month, male_daily_pay, male_extra_work_pay, female_8h_hourly, female_12h_day_pay, female_12h_night_pay, large_advance_limit'
      )
      .order('effective_month', { ascending: true });

    if (error) {
      if (isMissingSchema(error)) return DEFAULT_PAY_CONTEXT;
      throw error;
    }

    const rows = (data || []) as ScheduleRow[];
    if (rows.length === 0) return DEFAULT_PAY_CONTEXT;

    const applicable = [...rows].reverse().find((row) => row.effective_month <= target);
    const rates = applicable ? toRates(applicable) : DEFAULT_PAY_RATES;
    return {
      rates,
      standardMaleDaily: [
        DEFAULT_PAY_RATES.maleDailyPay,
        ...rows.map((row) => Number(row.male_daily_pay)),
      ],
      standardFemale8h: [
        DEFAULT_PAY_RATES.female8hHourly,
        ...rows.map((row) => Number(row.female_8h_hourly)),
      ],
      positionRates: await loadPositionRates(),
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes('SUPABASE_SERVICE_ROLE_KEY')) {
      return DEFAULT_PAY_CONTEXT;
    }
    throw error;
  }
}

export async function listPaySchedules(): Promise<
  { effectiveMonth: string; rates: PayRates }[]
> {
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from('pay_rate_schedules')
      .select(
        'effective_month, male_daily_pay, male_extra_work_pay, female_8h_hourly, female_12h_day_pay, female_12h_night_pay, large_advance_limit'
      )
      .order('effective_month', { ascending: false });
    if (error) {
      if (isMissingSchema(error)) return [];
      throw error;
    }
    return ((data || []) as ScheduleRow[]).map((row) => ({
      effectiveMonth: row.effective_month,
      rates: toRates(row),
    }));
  } catch (error) {
    if (error instanceof Error && error.message.includes('SUPABASE_SERVICE_ROLE_KEY')) {
      return [];
    }
    throw error;
  }
}
