'use client';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Modal } from '@/components/ui/modal';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import {
  Worker,
  WorkerGender,
  ShiftLength,
  WORKER_POSITIONS,
  WORKER_GENDER_LABELS,
  SHIFT_LENGTH_LABELS,
  DEFAULT_PAY_RATES,
  FEMALE_12H_HOURS,
  PayRates,
  defaultHourlyRate,
  female12hDayHourly,
  female12hNightHourly,
  isFemale12hWorker,
  isMaleWorker,
  maleDailyRate,
  roundMoney,
} from '@/types/database';
import { formatCurrency, formatDate } from '@/lib/utils';
import {
  createWorker,
  createWorkerLogin,
  deleteWorker,
  provisionMissingWorkerLogins,
  resetWorkerLogin,
  updateWorker,
} from '@/lib/actions/workers';
import {
  WorkerSearchFilter,
  useWorkerSearchFilter,
} from '@/components/workers/worker-search-filter';
import { KeyRound, Pencil, Plus, Trash2, UserPlus } from 'lucide-react';
import { useState } from 'react';

interface PositionChoice {
  name: string;
  basePay: number | null;
}

interface WorkersTableProps {
  initialWorkers: Worker[];
  rates?: PayRates;
  positions?: PositionChoice[];
}

const DEFAULT_POSITION_CHOICES: PositionChoice[] = WORKER_POSITIONS.map((name) => ({
  name,
  basePay: null,
}));

export function WorkersTable({
  initialWorkers,
  rates = DEFAULT_PAY_RATES,
  positions = DEFAULT_POSITION_CHOICES,
}: WorkersTableProps) {
  const [showModal, setShowModal] = useState(false);
  const [editingWorker, setEditingWorker] = useState<Worker | null>(null);
  const [loading, setLoading] = useState(false);
  const [gender, setGender] = useState<WorkerGender | ''>('');
  const [shiftLength, setShiftLength] = useState<ShiftLength | ''>('');
  const [positionName, setPositionName] = useState('');
  const [hourlyRate, setHourlyRate] = useState('');
  const [loginLoadingId, setLoginLoadingId] = useState<string | null>(null);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<
    { kind: 'login'; worker: Worker } | { kind: 'provision' } | null
  >(null);
  const [feedback, setFeedback] = useState<{ title: string; message: string } | null>(
    null
  );
  const {
    query,
    setQuery,
    gender: filterGender,
    setGender: setFilterGender,
    shiftLength: filterShiftLength,
    setShiftLength: setFilterShiftLength,
    filteredWorkers,
    hasActiveFilters,
    clearFilters,
  } = useWorkerSearchFilter(initialWorkers);

  function positionBase(name: string) {
    return positions.find((item) => item.name === name)?.basePay ?? null;
  }

  function startingRate(nextGender: WorkerGender | '', nextShift: ShiftLength | '', name = positionName) {
    const base = positionBase(name);
    if (base != null && (nextGender === 'male' || (nextGender === 'female' && nextShift === 8))) {
      return base;
    }
    if (nextGender === 'male') return defaultHourlyRate('male', null, rates);
    if (nextGender === 'female' && nextShift) return defaultHourlyRate('female', nextShift, rates);
    return null;
  }

  function openCreate() {
    setEditingWorker(null);
    setGender('');
    setShiftLength('');
    setPositionName('');
    setHourlyRate('');
    setShowModal(true);
  }

  function openEdit(worker: Worker) {
    setEditingWorker(worker);
    setPositionName(worker.position || '');
    setGender(worker.gender ?? '');
    setShiftLength(worker.shift_length ?? '');
    setHourlyRate(
      worker.hourly_rate
        ? String(isMaleWorker(worker) ? maleDailyRate(worker.hourly_rate) : worker.hourly_rate)
        : ''
    );
    setShowModal(true);
  }

  function applyRate(
    nextGender: WorkerGender | '',
    nextShift: ShiftLength | '',
    name = positionName
  ) {
    const next = startingRate(nextGender, nextShift, name);
    if (next != null) setHourlyRate(String(next));
  }

  function handleGenderChange(value: string) {
    const next = value === 'male' || value === 'female' ? value : '';
    setGender(next);
    if (next === 'male') {
      setShiftLength('');
      applyRate('male', '');
      return;
    }
    setShiftLength('');
    setHourlyRate('');
  }

  function handleShiftLengthChange(value: string) {
    const next = value === '8' || value === '12' ? (Number(value) as ShiftLength) : '';
    setShiftLength(next);
    applyRate(gender, next);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);

    const formData = new FormData(e.currentTarget);

    try {
      const result = editingWorker
        ? await updateWorker(editingWorker.id, formData)
        : await createWorker(formData);
      if (result?.error) {
        alert(result.error);
        return;
      }
      setShowModal(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Xatolik yuz berdi';
      alert(message);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Ishchini o‘chirishni tasdiqlaysizmi? 7 kun ichida Creator tiklashi mumkin.')) return;

    try {
      await deleteWorker(id);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'O‘chirishda xatolik');
    }
  }

  function loginActionLabel(worker: Worker) {
    return worker.user_id ? 'Parolni yangilash' : 'Kirish yaratish';
  }

  function requestLogin(worker: Worker) {
    if (!worker.login_code) return;
    setConfirmDialog({ kind: 'login', worker });
  }

  function requestProvisionAll() {
    const missing = initialWorkers.filter((worker) => !worker.user_id && worker.login_code);
    if (missing.length === 0) {
      setFeedback({ title: 'Kirish', message: 'Kirishi yo‘q ishchi qolmadi' });
      return;
    }
    setConfirmDialog({ kind: 'provision' });
  }

  async function confirmLogin(worker: Worker) {
    setLoginLoadingId(worker.id);
    try {
      const result = worker.user_id
        ? await resetWorkerLogin(worker.id)
        : await createWorkerLogin(worker.id);
      setConfirmDialog(null);
      if (result.error) {
        setFeedback({ title: 'Xatolik', message: result.error });
        return;
      }
      if (!result.password) {
        setFeedback({
          title: 'Xatolik',
          message: 'Parol qaytarilmadi. Qayta yangilang.',
        });
        return;
      }
      setFeedback({
        title: worker.user_id ? 'Parol yangilandi' : 'Kirish yaratildi',
        message: `Kod: ${result.loginCode || worker.login_code}\nParol: ${result.password}\n\nParolni hozir yozib oling. Keyin ko‘rsatilmaydi.`,
      });
    } catch (err) {
      setConfirmDialog(null);
      setFeedback({
        title: 'Xatolik',
        message: err instanceof Error ? err.message : 'Xatolik yuz berdi',
      });
    } finally {
      setLoginLoadingId(null);
    }
  }

  async function confirmProvisionAll() {
    setBulkLoading(true);
    try {
      const result = await provisionMissingWorkerLogins();
      setConfirmDialog(null);
      if (result.error) {
        setFeedback({ title: 'Xatolik', message: result.error });
        return;
      }
      const failedNote =
        result.failed && result.errors?.length
          ? `\n\nXatolik (${result.failed}):\n${result.errors.slice(0, 8).join('\n')}`
          : '';
      const passwordNote = (result.passwords ?? [])
        .map((item) => `${item.fullName}: ${item.loginCode} / ${item.password}`)
        .join('\n');
      setFeedback({
        title: 'Kirish yaratildi',
        message: `${result.created ?? 0} ta kirish yaratildi.${passwordNote ? `\n\n${passwordNote}\n\nParolni hozir yozib oling. Keyin ko‘rsatilmaydi.` : ''}${failedNote}`,
      });
    } catch (err) {
      setConfirmDialog(null);
      setFeedback({
        title: 'Xatolik',
        message: err instanceof Error ? err.message : 'Xatolik yuz berdi',
      });
    } finally {
      setBulkLoading(false);
    }
  }

  function renderWorkerActions(worker: Worker, showLabels: boolean) {
    return (
      <div className={showLabels ? 'flex flex-wrap gap-2' : 'flex justify-end gap-2'}>
        <Button
          variant={showLabels ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => requestLogin(worker)}
          title={
            worker.user_id
              ? 'Parolni formula bo‘yicha yangilash'
              : 'Kirish yaratish'
          }
          disabled={!worker.login_code || loginLoadingId === worker.id}
        >
          <KeyRound className={`h-4 w-4 text-indigo-600 ${showLabels ? 'mr-2' : ''}`} />
          {showLabels
            ? loginLoadingId === worker.id
              ? 'Yaratilmoqda...'
              : loginActionLabel(worker)
            : null}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => openEdit(worker)}>
          <Pencil className="h-4 w-4" />
          {showLabels ? <span className="ml-2">Tahrirlash</span> : null}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => handleDelete(worker.id)}>
          <Trash2 className="h-4 w-4 text-red-500" />
          {showLabels ? <span className="ml-2">O‘chirish</span> : null}
        </Button>
      </div>
    );
  }

  const positionOptions = [
    { value: '', label: 'Lavozimni tanlang' },
    ...positions.map((position) => ({
      value: position.name,
      label: position.name,
    })),
    ...(editingWorker?.position &&
    !positions.some((position) => position.name === editingWorker.position)
      ? [{ value: editingWorker.position, label: editingWorker.position }]
      : []),
  ];

  const genderOptions = [
    { value: '', label: 'Jinsni tanlang' },
    { value: 'male', label: WORKER_GENDER_LABELS.male },
    { value: 'female', label: WORKER_GENDER_LABELS.female },
  ];

  const shiftLengthOptions = [
    { value: '', label: 'Ish vaqtini tanlang' },
    { value: '8', label: SHIFT_LENGTH_LABELS[8] },
    { value: '12', label: SHIFT_LENGTH_LABELS[12] },
  ];

  const showHourlyRateInput = gender === 'male' || (gender === 'female' && shiftLength === 8);
  const show12hRates = gender === 'female' && shiftLength === 12;
  const missingLoginCodes = initialWorkers.some((worker) => !worker.login_code);
  const missingLogins = initialWorkers.filter(
    (worker) => !worker.user_id && worker.login_code
  );

  return (
    <>
      {missingLoginCodes ? (
        <div className="mb-4 break-words rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm text-indigo-900">
          Ishchi kodlari uchun Supabase SQL Editor’da{' '}
          <code className="rounded bg-white/70 px-1">008_worker_portal.sql</code> ni
          ishga tushiring yoki <code className="rounded bg-white/70 px-1">npm run migrate</code>.
        </div>
      ) : null}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <WorkerSearchFilter
          query={query}
          onQueryChange={setQuery}
          gender={filterGender}
          onGenderChange={setFilterGender}
          shiftLength={filterShiftLength}
          onShiftLengthChange={setFilterShiftLength}
          hasActiveFilters={hasActiveFilters}
          onClearFilters={clearFilters}
        />
        <Button onClick={openCreate} className="shrink-0">
          <Plus className="mr-2 h-4 w-4" />
          Yangi ishchi
        </Button>
        {missingLogins.length > 0 ? (
          <Button
            type="button"
            variant="secondary"
            onClick={requestProvisionAll}
            disabled={bulkLoading}
            className="shrink-0"
          >
            <UserPlus className="mr-2 h-4 w-4" />
            {bulkLoading
              ? 'Yaratilmoqda...'
              : `Hammasiga kirish yaratish (${missingLogins.length})`}
          </Button>
        ) : null}
      </div>

      <div className="space-y-3 md:hidden">
        {filteredWorkers.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-sm text-slate-500">
              {initialWorkers.length === 0
                ? 'Hozircha ishchilar yo\'q'
                : 'Ishchi topilmadi'}
            </CardContent>
          </Card>
        ) : (
          filteredWorkers.map((worker) => (
            <Card key={worker.id}>
              <CardContent className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900">{worker.full_name}</p>
                    <p className="mt-1 font-mono text-sm text-slate-700">
                      {worker.login_code || 'Kod yo‘q'}
                    </p>
                    <p className="mt-1 text-sm text-slate-600">
                      {worker.position || 'Lavozim yo‘q'}
                    </p>
                    <p className="mt-1 text-sm text-slate-600">
                      {worker.gender ? WORKER_GENDER_LABELS[worker.gender] : 'Jins ko‘rsatilmagan'}
                      {worker.gender === 'female' && worker.shift_length
                        ? ` · ${SHIFT_LENGTH_LABELS[worker.shift_length]}`
                        : ''}
                    </p>
                    <p className="mt-1 text-sm text-slate-600">
                      {worker.phone || 'Telefon yo‘q'}
                    </p>
                    <p className="mt-1 break-words text-sm text-slate-700">
                      <WorkerRateText worker={worker} rates={rates} />
                    </p>
                  </div>
                  <Badge variant={worker.is_active ? 'success' : 'neutral'}>
                    {worker.is_active ? 'Faol' : 'Nofaol'}
                  </Badge>
                </div>
                {renderWorkerActions(worker, true)}
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <Card className="hidden md:block">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>F.I.Sh</th>
                  <th>Kod</th>
                  <th>Jins</th>
                  <th>Lavozim</th>
                  <th>Telefon</th>
                  <th>Ish boshlagan</th>
                  <th>Stavka</th>
                  <th>Holat</th>
                  <th className="text-right">Amallar</th>
                </tr>
              </thead>
              <tbody>
                {filteredWorkers.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-6 py-12 text-center text-slate-500">
                      {initialWorkers.length === 0
                        ? 'Hozircha ishchilar yo\'q'
                        : 'Ishchi topilmadi'}
                    </td>
                  </tr>
                ) : (
                  filteredWorkers.map((worker) => (
                    <tr key={worker.id}>
                      <td className="font-medium text-slate-900">
                        {worker.full_name}
                      </td>
                      <td className="font-mono text-slate-700">
                        {worker.login_code || '—'}
                      </td>
                      <td className="text-slate-600">
                        <div>{worker.gender ? WORKER_GENDER_LABELS[worker.gender] : '—'}</div>
                        {worker.gender === 'female' && worker.shift_length ? (
                          <div className="text-xs text-slate-500">
                            {SHIFT_LENGTH_LABELS[worker.shift_length]}
                          </div>
                        ) : null}
                      </td>
                      <td className="text-slate-600">
                        {worker.position || '—'}
                      </td>
                      <td className="text-slate-600">
                        {worker.phone || '—'}
                      </td>
                      <td className="text-slate-600">
                        {formatDate(worker.start_date)}
                      </td>
                      <td className="text-slate-600">
                        <WorkerRateText worker={worker} rates={rates} />
                      </td>
                      <td>
                        <Badge variant={worker.is_active ? 'success' : 'neutral'}>
                          {worker.is_active ? 'Faol' : 'Nofaol'}
                        </Badge>
                      </td>
                      <td className="text-right">
                        {renderWorkerActions(worker, false)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Modal
        isOpen={confirmDialog !== null}
        onClose={() => {
          if (!loginLoadingId && !bulkLoading) setConfirmDialog(null);
        }}
        title={
          confirmDialog?.kind === 'login'
            ? loginActionLabel(confirmDialog.worker)
            : 'Hammasiga kirish yaratish'
        }
      >
        <p className="text-sm text-slate-700">
          {confirmDialog?.kind === 'login'
            ? `${confirmDialog.worker.full_name} uchun ${loginActionLabel(confirmDialog.worker).toLowerCase()}?`
            : `${missingLogins.length} ta ishchiga tasodifiy parol bilan kirish yaratiladi. Parollar bir marta ko‘rsatiladi.`}
        </p>
        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          <Button
            type="button"
            variant="secondary"
            onClick={() => setConfirmDialog(null)}
            disabled={Boolean(loginLoadingId) || bulkLoading}
          >
            Bekor qilish
          </Button>
          <Button
            type="button"
            onClick={() => {
              if (confirmDialog?.kind === 'login') {
                void confirmLogin(confirmDialog.worker);
                return;
              }
              void confirmProvisionAll();
            }}
            disabled={Boolean(loginLoadingId) || bulkLoading}
          >
            {loginLoadingId || bulkLoading ? 'Yaratilmoqda...' : 'Tasdiqlash'}
          </Button>
        </div>
      </Modal>

      <Modal
        isOpen={feedback !== null}
        onClose={() => setFeedback(null)}
        title={feedback?.title || ''}
      >
        <p className="whitespace-pre-wrap break-words text-sm text-slate-700">
          {feedback?.message}
        </p>
        <div className="mt-4 flex justify-end">
          <Button type="button" onClick={() => setFeedback(null)}>
            Yopish
          </Button>
        </div>
      </Modal>

      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={editingWorker ? 'Ishchini tahrirlash' : 'Yangi ishchi'}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            id="full_name"
            name="full_name"
            label="F.I.Sh"
            defaultValue={editingWorker?.full_name}
            required
          />
          <Select
            key={editingWorker?.id ?? 'new'}
            id="position"
            name="position"
            label="Lavozim"
            required
            value={positionName}
            onChange={(event) => {
              const next = event.target.value;
              setPositionName(next);
              if (!editingWorker) applyRate(gender, shiftLength, next);
            }}
            options={positionOptions}
          />
          <Input
            id="phone"
            name="phone"
            label="Telefon"
            defaultValue={editingWorker?.phone || ''}
          />
          <Input
            id="start_date"
            name="start_date"
            label="Ish boshlagan sana"
            type="date"
            defaultValue={editingWorker?.start_date || new Date().toISOString().split('T')[0]}
            required
          />
          <Select
            id="gender"
            name="gender"
            label="Jins"
            required
            value={gender}
            onChange={(e) => handleGenderChange(e.target.value)}
            options={genderOptions}
          />
          {gender === 'female' && (
            <Select
              id="shift_length"
              name="shift_length"
              label="Ish vaqti"
              required
              value={shiftLength === '' ? '' : String(shiftLength)}
              onChange={(e) => handleShiftLengthChange(e.target.value)}
              options={shiftLengthOptions}
            />
          )}
          {showHourlyRateInput && (
            <div>
              <Input
                id="hourly_rate"
                name="hourly_rate"
                label={
                  gender === 'male'
                    ? "Kunlik stavka (1 stavka, so'm)"
                    : "Soatbay stavka (so'm/soat)"
                }
                type="number"
                value={hourlyRate}
                onChange={(e) => setHourlyRate(e.target.value)}
                min={0}
                step={0.01}
                required
              />
              <p className="mt-1 text-xs text-slate-500">
                {positionBase(positionName) != null
                  ? `Lavozim boshlang‘ich stavkasi: ${formatCurrency(positionBase(positionName) || 0)}. Boshqacha summa kiritsangiz, lavozim stavkasi o‘zgarganda bu ishchi o‘zgarmaydi.`
                  : gender === 'male'
                    ? `1 stavka = shu summa. Davomatda 0.5, 1, 1.5 yoki 2 stavka belgilanadi. Qo'shimcha ish kuniga ${formatCurrency(rates.maleExtraWorkPay)}.`
                    : `8 soatlik: ${formatCurrency(rates.female8hHourly)}/soat. Qo'shimcha soatlar shu stavkada.`}
              </p>
            </div>
          )}
          {show12hRates && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              <input
                type="hidden"
                name="hourly_rate"
                value={String(defaultHourlyRate('female', 12, rates))}
              />
              <p className="font-medium text-slate-900">12 soatlik soatbay stavkalar</p>
              <p className="mt-1">
                Kunduzgi: {formatCurrency(rates.female12hDayPay)} / {FEMALE_12H_HOURS} soat
                {' '}
                ({formatCurrency(roundMoney(female12hDayHourly(rates)))}/soat)
              </p>
              <p>
                Kechki: {formatCurrency(rates.female12hNightPay)} / {FEMALE_12H_HOURS} soat
                {' '}
                ({formatCurrency(roundMoney(female12hNightHourly(rates)))}/soat)
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Stavka davomatdagi smenaga qarab avtomatik qo&apos;llaniladi.
              </p>
            </div>
          )}
          {editingWorker && (
            <div className="space-y-1">
              <label className="block text-sm font-medium text-slate-700">Holat</label>
              <select
                name="is_active"
                defaultValue={editingWorker.is_active ? 'true' : 'false'}
                className="block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              >
                <option value="true">Faol</option>
                <option value="false">Nofaol</option>
              </select>
            </div>
          )}
          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:flex-wrap sm:justify-end">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setShowModal(false)}
            >
              Bekor qilish
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Saqlanmoqda...' : 'Saqlash'}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

function WorkerRateText({ worker, rates }: { worker: Worker; rates: PayRates }) {
  if (isFemale12hWorker(worker)) {
    return (
      <span>
        <span className="block">
          Kunduzgi: {formatCurrency(roundMoney(female12hDayHourly(rates)))}/soat
        </span>
        <span className="block">
          Kechki: {formatCurrency(roundMoney(female12hNightHourly(rates)))}/soat
        </span>
      </span>
    );
  }
  if (isMaleWorker(worker)) {
    return `${formatCurrency(maleDailyRate(worker.hourly_rate))}/kun`;
  }
  return `${formatCurrency(worker.hourly_rate)}/soat`;
}
