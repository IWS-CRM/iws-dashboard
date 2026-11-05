'use client';

import {
  addCreatorEmail,
  addWorkerPosition,
  approveAdvance,
  confirmCreatorMfa,
  rejectAdvance,
  removeCreatorEmail,
  removeWorkerPosition,
  restoreWorker,
  savePaySchedule,
  startCreatorMfa,
  updateWorkerPositionPay,
} from '@/lib/actions/governance';
import type { getCreatorSettings } from '@/lib/actions/governance';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import { currentMonthInTashkent, formatMonthLabel } from '@/lib/utils/payroll';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

type Settings = Awaited<ReturnType<typeof getCreatorSettings>>;

export function ControlSettings({
  settings,
}: {
  settings: Settings;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [mfa, setMfa] = useState<{ secret: string; otpauth: string } | null>(null);
  const [otp, setOtp] = useState('');
  const [currentOtp, setCurrentOtp] = useState('');
  const rates = settings.rates;

  async function run(id: string, task: () => Promise<void>) {
    setBusy(id);
    setMessage(null);
    setNotice(null);
    try {
      await task();
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Xatolik');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      {message ? (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{message}</div>
      ) : null}
      {notice ? (
        <div className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</div>
      ) : null}

      <Card>
        <CardContent className="space-y-4 p-4 sm:p-6">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Stavkalar</h2>
            <p className="mt-1 text-sm text-slate-500">
              Tanlangan oydan boshlab yangi narx ishlaydi. Undan oldingi oylar o‘z narxida qoladi.
            </p>
          </div>
          <form
            className="grid gap-3 sm:grid-cols-2"
            action={async (formData) => {
              const result = await savePaySchedule(formData);
              setMessage(result.error || null);
              if (!result.error) router.refresh();
            }}
          >
            <Input
              name="effective_month"
              label="Qaysi oydan"
              type="month"
              required
              defaultValue={currentMonthInTashkent()}
            />
            <Input
              name="large_advance_limit"
              label="Katta avans chegarasi"
              type="number"
              min={0}
              required
              defaultValue={rates.largeAdvanceLimit}
            />
            <Input
              name="male_daily_pay"
              label="Erkak, 1 stavka"
              type="number"
              min={1}
              required
              defaultValue={rates.maleDailyPay}
            />
            <Input
              name="male_extra_work_pay"
              label="Qo‘shimcha ish"
              type="number"
              min={1}
              required
              defaultValue={rates.maleExtraWorkPay}
            />
            <Input
              name="female_8h_hourly"
              label="Ayol, 8 soat / soat"
              type="number"
              min={1}
              required
              defaultValue={rates.female8hHourly}
            />
            <Input
              name="female_12h_day_pay"
              label="Ayol, 12 soat kunduzgi kun"
              type="number"
              min={1}
              required
              defaultValue={rates.female12hDayPay}
            />
            <Input
              name="female_12h_night_pay"
              label="Ayol, 12 soat kechki kun"
              type="number"
              min={1}
              required
              defaultValue={rates.female12hNightPay}
            />
            <div className="sm:col-span-2">
              <Button type="submit">Saqlash</Button>
            </div>
          </form>
          {settings.schedules.length > 0 ? (
            <ul className="space-y-1 text-sm text-slate-600">
              {settings.schedules.map((schedule) => (
                <li key={schedule.effectiveMonth}>
                  {formatMonthLabel(schedule.effectiveMonth)}: erkak{' '}
                  {formatCurrency(schedule.rates.maleDailyPay)}, qo‘shimcha{' '}
                  {formatCurrency(schedule.rates.maleExtraWorkPay)}, avans chegarasi{' '}
                  {formatCurrency(schedule.rates.largeAdvanceLimit)}
                </li>
              ))}
            </ul>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 p-4 sm:p-6">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Lavozimlar</h2>
            <p className="mt-1 text-sm text-slate-500">
              Har bir lavozimning boshlang‘ich stavkasi bor. Stavka o‘zgarsa, shu summada turgan
              ishchilar yangilanadi. Stavkasi boshlang‘ichdan farq qiladigan, ya’ni ko‘tarilgan
              ishchilar o‘zgarishsiz qoladi. 12 soatlik ayollar smena narxida qoladi.
            </p>
          </div>
          {!settings.positionsReady ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Lavozimlar jadvali hali yo‘q. Supabase SQL Editor’da 015_worker_positions.sql ni
              ishga tushiring yoki npm run migrate.
            </p>
          ) : null}
          {settings.positionsReady && !settings.positionPayReady ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Stavka ustuni hali yo‘q. Supabase SQL Editor’da 016_position_base_pay.sql ni ishga
              tushiring yoki npm run migrate.
            </p>
          ) : null}
          {settings.positions.length === 0 ? (
            <p className="text-sm text-slate-500">Hali lavozim yo‘q.</p>
          ) : (
            <ul className="space-y-3 text-sm">
              {settings.positions.map((position) => (
                <li
                  key={position.id || position.name}
                  className="rounded-lg border border-slate-200 p-3"
                >
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
                    <p className="min-w-0 flex-1 font-medium text-slate-900">{position.name}</p>
                    <form
                      className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-end"
                      action={async (formData) => {
                        setMessage(null);
                        setNotice(null);
                        const result = await updateWorkerPositionPay(formData);
                        if (result.error) {
                          setMessage(result.error);
                          return;
                        }
                        setNotice(result.message || null);
                        router.refresh();
                      }}
                    >
                      <input type="hidden" name="id" value={position.id} />
                      <div className="min-w-0 flex-1">
                        <Input
                          key={`${position.id}-${position.basePay ?? ''}`}
                          name="base_pay"
                          label="Boshlang‘ich stavka"
                          type="number"
                          min={1}
                          step={1}
                          required
                          disabled={!settings.positionPayReady || !position.id}
                          defaultValue={position.basePay ?? ''}
                        />
                      </div>
                      <Button
                        type="submit"
                        size="sm"
                        disabled={!settings.positionPayReady || !position.id || busy === position.id}
                      >
                        Saqlash
                      </Button>
                    </form>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={!settings.positionsReady || !position.id || busy === position.id}
                      onClick={() => {
                        if (!confirm(`«${position.name}» lavozimini o‘chirasizmi?`)) return;
                        void run(position.id, () => removeWorkerPosition(position.id));
                      }}
                    >
                      O‘chirish
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <form
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
            action={async (formData) => {
              setNotice(null);
              const result = await addWorkerPosition(formData);
              setMessage(result.error || null);
              if (!result.error) router.refresh();
            }}
          >
            <div className="min-w-0 flex-1">
              <Input name="name" label="Yangi lavozim" required disabled={!settings.positionsReady} />
            </div>
            <div className="min-w-0 flex-1">
              <Input
                name="base_pay"
                label="Boshlang‘ich stavka"
                type="number"
                min={1}
                step={1}
                required
                disabled={!settings.positionPayReady}
              />
            </div>
            <Button type="submit" disabled={!settings.positionsReady || !settings.positionPayReady}>
              Qo‘shish
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-4 sm:p-6">
          <h2 className="text-lg font-semibold text-slate-900">Avans tasdig‘i</h2>
          {settings.requests.length === 0 ? (
            <p className="text-sm text-slate-500">Kutilayotgan so‘rov yo‘q.</p>
          ) : (
            settings.requests.map((request) => (
              <div key={request.id} className="rounded-lg border border-slate-200 p-3">
                <p className="font-medium text-slate-900">
                  {request.workerName} · {formatMonthLabel(request.month)}
                </p>
                <p className="mt-1 text-sm text-slate-600">
                  {request.requested_by_name}: {formatCurrency(Number(request.previous_amount))} →{' '}
                  {formatCurrency(Number(request.amount))}
                </p>
                <div className="mt-3 flex gap-2">
                  <Button
                    size="sm"
                    disabled={busy === request.id}
                    onClick={() => run(request.id, () => approveAdvance(request.id))}
                  >
                    Tasdiqlash
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy === request.id}
                    onClick={() => run(request.id, () => rejectAdvance(request.id))}
                  >
                    Rad etish
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-4 sm:p-6">
          <h2 className="text-lg font-semibold text-slate-900">O‘chirilgan ishchilar</h2>
          <p className="text-sm text-slate-500">7 kun ichida tiklash mumkin.</p>
          {settings.deletedWorkers.length === 0 ? (
            <p className="text-sm text-slate-500">Ro‘yxat bo‘sh.</p>
          ) : (
            settings.deletedWorkers.map((worker) => (
              <div key={worker.id} className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-medium text-slate-900">{worker.fullName}</p>
                  <p className="text-xs text-slate-500">{formatDateTime(worker.deletedAt)}</p>
                </div>
                {worker.restorable ? (
                  <Button
                    size="sm"
                    disabled={busy === worker.id}
                    onClick={() => run(worker.id, () => restoreWorker(worker.id))}
                  >
                    Tiklash
                  </Button>
                ) : (
                  <span className="text-xs text-slate-400">Muddat tugagan</span>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 p-4 sm:p-6">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Creator hisoblari</h2>
            <p className="mt-1 text-sm text-slate-500">
              Zaxira email avval oddiy hisob sifatida yaratilgan bo‘lishi kerak. Asosiy{' '}
              creator@isko.uz kodda qoladi.
            </p>
          </div>
          <ul className="space-y-2 text-sm">
            {settings.creators.map((creator) => (
              <li key={creator.email} className="flex items-center justify-between gap-3">
                <span className="break-all text-slate-800">{creator.email}</span>
                {creator.primary ? (
                  <span className="text-xs text-slate-400">Asosiy</span>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy === creator.email}
                    onClick={() => run(creator.email, () => removeCreatorEmail(creator.email))}
                  >
                    Olib tashlash
                  </Button>
                )}
              </li>
            ))}
          </ul>
          <form
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
            action={async (formData) => {
              const result = await addCreatorEmail(formData);
              setMessage(result.error || null);
              if (!result.error) router.refresh();
            }}
          >
            <div className="min-w-0 flex-1">
              <Input name="email" label="Zaxira email" type="email" required />
            </div>
            <Button type="submit">Qo‘shish</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-4 sm:p-6">
          <h2 className="text-lg font-semibold text-slate-900">Ikki bosqichli kirish</h2>
          {mfa ? (
            <div className="space-y-3">
              <p className="text-sm text-slate-600">
                Yangi kalitni ilovaga kiriting va 6 xonali kod bilan tasdiqlang.
              </p>
              <p className="break-all rounded-lg bg-slate-50 p-3 font-mono text-sm text-slate-800">
                {mfa.secret}
              </p>
              <p className="break-all text-xs text-slate-500">{mfa.otpauth}</p>
              <Input
                label="6 xonali kod"
                value={otp}
                onChange={(event) => setOtp(event.target.value)}
                inputMode="numeric"
              />
              <Button
                disabled={busy === 'mfa' || otp.trim().length < 6}
                onClick={() =>
                  run('mfa', async () => {
                    await confirmCreatorMfa(otp.trim());
                    setMfa(null);
                    setOtp('');
                  })
                }
              >
                Tasdiqlash
              </Button>
            </div>
          ) : settings.mfaEnabled ? (
            <div className="space-y-3">
              <p className="text-sm text-slate-600">
                Yoqilgan. Keyingi kirishda autentifikator kodi so‘raladi. Kalitni yangilash eski kodni o‘chirmaydi — yangi kod tasdiqlanguncha eski kod ishlaydi.
              </p>
              <Input
                label="Joriy 6 xonali kod"
                value={currentOtp}
                onChange={(event) => setCurrentOtp(event.target.value)}
                inputMode="numeric"
              />
              <Button
                variant="secondary"
                disabled={busy === 'mfa-start' || currentOtp.trim().length < 6}
                onClick={() =>
                  run('mfa-start', async () => {
                    setMfa(await startCreatorMfa(currentOtp.trim()));
                    setCurrentOtp('');
                  })
                }
              >
                Kalitni yangilash
              </Button>
            </div>
          ) : (
            <>
              <p className="text-sm text-slate-600">
                Google Authenticator yoki shunga o‘xshash ilovaga kalitni qo‘lda kiriting.
              </p>
              <Button
                variant="secondary"
                disabled={busy === 'mfa-start'}
                onClick={() =>
                  run('mfa-start', async () => {
                    setMfa(await startCreatorMfa());
                  })
                }
              >
                Yoqish
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
