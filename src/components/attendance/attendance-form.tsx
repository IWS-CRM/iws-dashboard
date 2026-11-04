'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Modal } from '@/components/ui/modal';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import {
  Attendance,
  AttendanceShift,
  AttendanceStatus,
  ATTENDANCE_SHIFT_LABELS,
  ATTENDANCE_STATUS_LABELS,
  Worker,
  attendanceHasExtraWork,
  defaultHoursForWorker,
  formatStavka,
  isFemale12hWorker,
  isMaleStavka,
  isMaleWorker,
  DEFAULT_PAY_RATES,
  MALE_EXTRA_WORK_NOTE,
  MALE_STAVKA_OPTIONS,
  PayRates,
  maleDailyRate,
  maleDayPay,
  maleStavkaFromStored,
  nearestMaleStavka,
} from '@/types/database';
import { saveAttendanceBatch } from '@/lib/actions/attendance';
import {
  getAbsenceReason,
  getDaysInMonth,
  getMonthDates,
  isFutureDate,
  formatMonthLabel,
  todayInTashkent,
} from '@/lib/utils/payroll';
import { exportAttendanceToExcel } from '@/lib/utils/excel';
import { formatCurrency } from '@/lib/utils';
import {
  WorkerSearchFilter,
  useWorkerSearchFilter,
} from '@/components/workers/worker-search-filter';
import {
  ChevronLeft,
  ChevronRight,
  Check,
  X,
  Pencil,
  CheckCircle,
  Download,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';

interface CellData {
  status: AttendanceStatus;
  hoursWorked: number;
  notes: string;
  shift: AttendanceShift | null;
}

interface AttendanceFormProps {
  month: string;
  workers: Worker[];
  attendance: Attendance[];
  rates?: PayRates;
  scopeNote?: string | null;
  readOnly?: boolean;
  editableKeys?: string[] | null;
}

const WEEKDAYS = ['Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh', 'Ya'];

function cellKey(workerId: string, date: string) {
  return `${workerId}:${date}`;
}

function firstWeekdayOffset(month: string): number {
  const [year, mon] = month.split('-').map(Number);
  const weekday = new Date(year, mon - 1, 1).getDay();
  return (weekday + 6) % 7;
}

function shortMobileStatus(status: AttendanceStatus) {
  if (status === 'present') return 'Keldi';
  if (status === 'late') return 'Kech';
  if (status === 'absent') return 'Yo‘q';
  if (status === 'holiday') return 'Ta’til';
  return 'Kas.';
}

function presentCellLabel(
  worker: Pick<Worker, 'gender'>,
  hoursWorked: number,
  shift: AttendanceShift | null,
  showShift: boolean,
  notes: string
) {
  if (isMaleWorker(worker)) {
    const stavka = maleStavkaFromStored(hoursWorked);
    if (stavka <= 0) return '';
    const label = formatStavka(stavka);
    return attendanceHasExtraWork(notes) ? `${label}+` : label;
  }
  if (!showShift || !shift) return `${hoursWorked}s`;
  return `${hoursWorked}${shift === 'night' ? 'T' : 'K'}`;
}

function isPaidStatus(status: AttendanceStatus) {
  return status === 'present' || status === 'late';
}

function cellButtonClass(
  cell: CellData | undefined,
  isEditing: boolean,
  isNightPresent: boolean
) {
  const base =
    'inline-flex items-center justify-center min-w-7 h-7 px-0.5 rounded text-[10px] font-medium transition-colors';
  if (!cell) {
    return isEditing ? `${base} bg-slate-100 text-slate-400 hover:bg-slate-200` : `${base} text-slate-300`;
  }
  if (cell.status === 'present') {
    if (isNightPresent) {
      return isEditing
        ? `${base} bg-indigo-100 text-indigo-700 hover:bg-indigo-200`
        : `${base} bg-indigo-50 text-indigo-700`;
    }
    return isEditing
      ? `${base} bg-green-100 text-green-700 hover:bg-green-200`
      : `${base} bg-green-50 text-green-700`;
  }
  if (cell.status === 'late') {
    return isEditing
      ? `${base} bg-amber-100 text-amber-800 hover:bg-amber-200`
      : `${base} bg-amber-50 text-amber-700`;
  }
  if (cell.status === 'absent') {
    return isEditing
      ? `${base} bg-red-100 text-red-700 hover:bg-red-200`
      : `${base} bg-red-50 text-red-600`;
  }
  return isEditing
    ? `${base} bg-slate-100 text-slate-500 hover:bg-slate-200`
    : `${base} bg-slate-50 text-slate-500`;
}

export function AttendanceForm({
  month,
  workers,
  attendance,
  rates = DEFAULT_PAY_RATES,
  scopeNote = null,
  readOnly = false,
  editableKeys = null,
}: AttendanceFormProps) {
  const extraPay = rates.maleExtraWorkPay;
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedCell, setSelectedCell] = useState<{
    workerId: string;
    date: string;
    workerName: string;
  } | null>(null);

  const [editModal, setEditModal] = useState<{
    workerId: string;
    date: string;
    mode: 'present' | 'absent';
  } | null>(null);
  const [modalHours, setModalHours] = useState('8');
  const [modalShift, setModalShift] = useState<AttendanceShift | ''>('');
  const [modalExtra, setModalExtra] = useState(false);
  const [modalNotes, setModalNotes] = useState('Sababsiz kelmadi');

  const buildInitialCells = useCallback(() => {
    const map: Record<string, CellData> = {};
    attendance.forEach((a) => {
      const shift = a.shift === 'day' || a.shift === 'night' ? a.shift : null;
      map[cellKey(a.worker_id, a.date)] = {
        status: a.status,
        hoursWorked: a.hours_worked || 0,
        notes: a.notes || '',
        shift,
      };
    });
    return map;
  }, [attendance]);

  const editableKeySet = useMemo(
    () => (editableKeys ? new Set(editableKeys) : null),
    [editableKeys]
  );

  function canEditDay(workerId: string, date: string) {
    if (!editableKeySet) return true;
    return editableKeySet.has(cellKey(workerId, date));
  }

  const [cells, setCells] = useState<Record<string, CellData>>(buildInitialCells);
  const isEditingRef = useRef(false);
  const attendanceRevision = attendance
    .map(
      (row) =>
        `${row.worker_id}:${row.date}:${row.status}:${row.hours_worked}:${row.shift ?? ''}:${row.notes ?? ''}`
    )
    .join(';');

  useEffect(() => {
    isEditingRef.current = isEditing;
  }, [isEditing]);

  useEffect(() => {
    if (!isEditingRef.current) {
      setCells(buildInitialCells());
    }
  }, [attendanceRevision, buildInitialCells]);
  const [exporting, setExporting] = useState(false);
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
  } = useWorkerSearchFilter(workers);
  const [mobileWorkerId, setMobileWorkerId] = useState<string | null>(null);
  const mobileWorker =
    filteredWorkers.find((worker) => worker.id === mobileWorkerId) ??
    filteredWorkers[0] ??
    null;

  const daysInMonth = getDaysInMonth(month);
  const dates = getMonthDates(month);
  const monthLabel = formatMonthLabel(month);

  function workerById(workerId: string) {
    return workers.find((w) => w.id === workerId);
  }

  function changeMonth(offset: number) {
    const [year, mon] = month.split('-').map(Number);
    const d = new Date(year, mon - 1 + offset, 1);
    const newMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    router.push(`/attendance?month=${newMonth}`);
  }

  function getCell(workerId: string, date: string): CellData | undefined {
    return cells[cellKey(workerId, date)];
  }

  function handleCellClick(workerId: string, date: string, workerName: string) {
    if (isFutureDate(date) || !canEditDay(workerId, date)) return;

    if (isEditing) {
      const existing = getCell(workerId, date);
      const worker = workerById(workerId);
      if (worker && isMaleWorker(worker)) {
        const current = existing?.hoursWorked
          ? nearestMaleStavka(maleStavkaFromStored(existing.hoursWorked))
          : 1;
        setModalHours(String(current));
      } else {
        const defaultHours = worker ? defaultHoursForWorker(worker) : 8;
        setModalHours(
          existing?.hoursWorked ? String(existing.hoursWorked) : String(defaultHours)
        );
      }
      setModalExtra(existing ? attendanceHasExtraWork(existing.notes) : false);
      setModalShift(
        existing?.shift === 'night' || existing?.shift === 'day' ? existing.shift : ''
      );
      setModalNotes(existing?.notes || 'Sababsiz kelmadi');
      setEditModal({
        workerId,
        date,
        mode: existing?.status === 'absent' ? 'absent' : 'present',
      });
    } else {
      const cell = getCell(workerId, date);
      if (cell) {
        setSelectedCell({ workerId, date, workerName });
      }
    }
  }

  function handleMarkPresent() {
    if (!editModal) return;
    const worker = workerById(editModal.workerId);
    const male = worker ? isMaleWorker(worker) : false;
    const hours = parseFloat(modalHours) || 0;
    if (male) {
      if (!isMaleStavka(hours)) {
        alert('Stavkani tanlang: 0.5, 1, 1.5 yoki 2');
        return;
      }
    } else if (hours <= 0) {
      return;
    }

    const needsShift = worker ? isFemale12hWorker(worker) : false;
    if (needsShift && modalShift !== 'day' && modalShift !== 'night') {
      alert('Kunduzgi yoki kechki smenani tanlang');
      return;
    }

    const key = cellKey(editModal.workerId, editModal.date);
    setCells((prev) => ({
      ...prev,
      [key]: {
        status: 'present',
        hoursWorked: hours,
        notes: male && modalExtra ? MALE_EXTRA_WORK_NOTE : '',
        shift: needsShift && (modalShift === 'day' || modalShift === 'night')
          ? modalShift
          : null,
      },
    }));
    setEditModal(null);
  }

  function handleMarkAbsent() {
    if (!editModal) return;

    const key = cellKey(editModal.workerId, editModal.date);
    setCells((prev) => ({
      ...prev,
      [key]: {
        status: 'absent',
        hoursWorked: 0,
        notes: modalNotes || 'Sababsiz kelmadi',
        shift: null,
      },
    }));
    setEditModal(null);
  }

  function handleModalSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editModal) return;
    if (editModal.mode === 'present') handleMarkPresent();
    else handleMarkAbsent();
  }

  function handleModalKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target instanceof HTMLButtonElement || target.closest('button')) return;

    event.preventDefault();
    const save = () => {
      if (editModal?.mode === 'absent') handleMarkAbsent();
      else handleMarkPresent();
    };
    if (target instanceof HTMLSelectElement) {
      window.setTimeout(save, 0);
      return;
    }
    save();
  }

  async function handleSave() {
    const missingShift = Object.entries(cells).some(([key, data]) => {
      if (data.status !== 'present' && data.status !== 'late') return false;
      const workerId = key.split(':')[0];
      const worker = workerById(workerId);
      return (
        !!worker &&
        isFemale12hWorker(worker) &&
        data.shift !== 'day' &&
        data.shift !== 'night'
      );
    });
    if (missingShift) {
      alert('Kunduzgi yoki kechki smenani tanlang');
      return;
    }

    setSaving(true);
    try {
      const records = Object.entries(cells).flatMap(([key, data]) => {
        if (editableKeySet && !editableKeySet.has(key)) return [];
        const [workerId, date] = key.split(':');
        const worker = workerById(workerId);
        const paid = data.status === 'present' || data.status === 'late';
        const hoursWorked =
          worker && isMaleWorker(worker) && paid
            ? maleStavkaFromStored(data.hoursWorked)
            : data.hoursWorked;
        return [
          {
            workerId,
            date,
            status: data.status,
            hoursWorked,
            shift: data.shift,
            notes: data.notes || undefined,
          },
        ];
      });
      await saveAttendanceBatch(records);
      isEditingRef.current = false;
      setIsEditing(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Saqlashda xatolik';
      alert(message);
    } finally {
      setSaving(false);
    }
  }

  function handleStartEdit() {
    if (readOnly) return;
    setCells(buildInitialCells());
    setIsEditing(true);
    setSelectedCell(null);
  }

  function handleCancelEdit() {
    setCells(buildInitialCells());
    setIsEditing(false);
    setSelectedCell(null);
  }

  async function handleExportExcel() {
    setExporting(true);
    try {
      await exportAttendanceToExcel(workers, cells, month, dates, rates);
    } catch {
      alert('Excel faylni yuklab olishda xatolik');
    } finally {
      setExporting(false);
    }
  }

  const selectedCellData = selectedCell
    ? getCell(selectedCell.workerId, selectedCell.date)
    : null;
  const selectedWorker = selectedCell
    ? workerById(selectedCell.workerId)
    : undefined;
  const editModalWorker = editModal ? workerById(editModal.workerId) : undefined;
  const editNeedsShift = editModalWorker
    ? isFemale12hWorker(editModalWorker)
    : false;
  const editIsMale = editModalWorker ? isMaleWorker(editModalWorker) : false;
  const editDailyRate = editModalWorker ? maleDailyRate(editModalWorker.hourly_rate) : 0;
  const editStavka = Number(modalHours) || 0;

  const shiftOptions = [
    { value: '', label: 'Smenani tanlang' },
    { value: 'day', label: ATTENDANCE_SHIFT_LABELS.day },
    { value: 'night', label: ATTENDANCE_SHIFT_LABELS.night },
  ];

  return (
    <>
      {selectedCell && selectedCellData && !isEditing && (
        <div className="mb-4 rounded-xl border border-indigo-100 bg-indigo-50 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="break-words font-semibold text-indigo-950">
                {selectedCell.workerName} —{' '}
                {new Date(selectedCell.date + 'T00:00:00').toLocaleDateString('uz-UZ', {
                  day: 'numeric',
                  month: 'long',
                })}
              </p>
              {isPaidStatus(selectedCellData.status) ? (
                <p className="mt-1 text-sm text-indigo-800">
                  {selectedCellData.status === 'late' ? (
                    <>
                      Holat: <strong>{ATTENDANCE_STATUS_LABELS.late}</strong>
                      {' · '}
                    </>
                  ) : null}
                  {selectedWorker && isMaleWorker(selectedWorker) ? (
                    <>
                      Stavka:{' '}
                      <strong>
                        {formatStavka(maleStavkaFromStored(selectedCellData.hoursWorked))}
                      </strong>
                      {attendanceHasExtraWork(selectedCellData.notes) ? (
                        <>
                          {' · '}
                          Qo&apos;shimcha ish:{' '}
                          <strong>{formatCurrency(extraPay)}</strong>
                        </>
                      ) : null}
                      {' · '}
                      Kunlik:{' '}
                      <strong>
                        {formatCurrency(
                          maleDayPay(
                            maleDailyRate(selectedWorker.hourly_rate),
                            maleStavkaFromStored(selectedCellData.hoursWorked),
                            attendanceHasExtraWork(selectedCellData.notes),
                            extraPay
                          )
                        )}
                      </strong>
                    </>
                  ) : (
                    <>
                      Ishlangan vaqt: <strong>{selectedCellData.hoursWorked} soat</strong>
                    </>
                  )}
                  {selectedWorker &&
                  isFemale12hWorker(selectedWorker) &&
                  selectedCellData.shift ? (
                    <>
                      {' · '}
                      <strong>
                        {ATTENDANCE_SHIFT_LABELS[selectedCellData.shift]} smena
                      </strong>
                    </>
                  ) : null}
                </p>
              ) : (
                <p className="mt-1 text-sm text-indigo-800">
                  Sabab:{' '}
                  <strong>
                    {getAbsenceReason(selectedCellData.status, selectedCellData.notes)}
                  </strong>
                </p>
              )}
            </div>
            <button
              onClick={() => setSelectedCell(null)}
              className="text-indigo-600 hover:text-indigo-800"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

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
      </div>

      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="sm" onClick={() => changeMonth(-1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[140px] text-center text-sm font-medium text-slate-900">
            {monthLabel}
          </span>
          <Button variant="secondary" size="sm" onClick={() => changeMonth(1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            onClick={handleExportExcel}
            disabled={exporting || workers.length === 0}
          >
            <Download className="mr-2 h-4 w-4" />
            {exporting ? 'Yuklanmoqda...' : 'Excel'}
          </Button>
          {readOnly ? null : isEditing ? (
            <>
              <Button variant="secondary" onClick={handleCancelEdit} disabled={saving}>
                Bekor qilish
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                <CheckCircle className="mr-2 h-4 w-4" />
                {saving ? 'Saqlanmoqda...' : 'Tayyor'}
              </Button>
            </>
          ) : (
            <Button onClick={handleStartEdit}>
              <Pencil className="mr-2 h-4 w-4" />
              Tahrirlash
            </Button>
          )}
        </div>
      </div>

      <AttendanceMobileMonth
        month={month}
        dates={dates}
        workers={filteredWorkers}
        worker={mobileWorker}
        onWorkerChange={setMobileWorkerId}
        isEditing={isEditing}
        selectedCell={selectedCell}
        getCell={getCell}
        emptyLabel={
          workers.length === 0 ? scopeNote || "Faol ishchilar yo'q" : 'Ishchi topilmadi'
        }
        onDayClick={(workerId, date, workerName) =>
          handleCellClick(workerId, date, workerName)
        }
        canEditDay={canEditDay}
      />

      <Card className="hidden md:block">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="sticky left-0 z-20 w-10 min-w-10 bg-slate-50 px-2 py-3 text-center text-xs font-semibold uppercase tracking-wide text-slate-500">
                    №
                  </th>
                  <th className="sticky left-10 z-20 min-w-[160px] bg-slate-50 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    F.I.Sh
                  </th>
                  {Array.from({ length: daysInMonth }, (_, i) => {
                    const day = i + 1;
                    const dateStr = dates[i];
                    const future = isFutureDate(dateStr);
                    const isToday = dateStr === todayInTashkent();
                    return (
                      <th
                        key={day}
                        className={`px-1 py-3 text-center font-medium min-w-[44px] ${
                          future
                            ? 'text-slate-300'
                            : isToday
                              ? 'bg-indigo-50 text-indigo-600'
                              : 'text-slate-600'
                        }`}
                      >
                        {day}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredWorkers.length === 0 ? (
                  <tr>
                    <td
                      colSpan={daysInMonth + 2}
                      className="px-6 py-12 text-center text-slate-500"
                    >
                      {workers.length === 0
                        ? scopeNote || 'Faol ishchilar yo\'q'
                        : 'Ishchi topilmadi'}
                    </td>
                  </tr>
                ) : (
                  filteredWorkers.map((worker, index) => (
                    <tr key={worker.id} className="hover:bg-slate-50">
                      <td className="sticky left-0 z-10 w-10 min-w-10 bg-white px-2 py-3 text-center text-sm text-slate-500">
                        {index + 1}
                      </td>
                      <td className="sticky left-10 z-10 border-r border-slate-100 bg-white px-4 py-3 font-medium text-slate-900">
                        <div className="max-w-[160px] truncate">
                          {worker.full_name}
                          {worker.deleted_at ? ' (o‘chirilgan)' : ''}
                        </div>
                        {isMaleWorker(worker) && (
                          <div className="text-xs text-indigo-600">Kunbay</div>
                        )}
                        {isFemale12hWorker(worker) && (
                          <div className="text-xs text-indigo-600">12 soatlik</div>
                        )}
                        {worker.position && (
                          <div className="truncate text-xs text-slate-500">
                            {worker.position}
                          </div>
                        )}
                      </td>
                      {dates.map((dateStr) => {
                        const cell = getCell(worker.id, dateStr);
                        const future = isFutureDate(dateStr) || !canEditDay(worker.id, dateStr);
                        const isSelected =
                          selectedCell?.workerId === worker.id &&
                          selectedCell?.date === dateStr;
                        const isNightPresent =
                          cell?.status === 'present' && cell.shift === 'night';
                        const showShiftLabel = isFemale12hWorker(worker);
                        const maleWorker = isMaleWorker(worker);
                        const hoursLabel =
                          cell && isPaidStatus(cell.status)
                            ? presentCellLabel(
                                worker,
                                cell.hoursWorked,
                                cell.shift,
                                showShiftLabel,
                                cell.notes
                              )
                            : '';

                        return (
                          <td
                            key={dateStr}
                            className={`px-1 py-2 text-center ${
                              future ? 'bg-slate-50' : ''
                            } ${isSelected ? 'ring-2 ring-inset ring-indigo-400' : ''}`}
                          >
                            {future ? (
                              <span className="inline-block h-7 w-7 rounded text-slate-200">
                                —
                              </span>
                            ) : isEditing ? (
                              <button
                                type="button"
                                onClick={() =>
                                  handleCellClick(worker.id, dateStr, worker.full_name)
                                }
                                className={cellButtonClass(cell, true, isNightPresent)}
                              >
                                {cell?.status === 'present' ? (
                                  showShiftLabel || maleWorker ? (
                                    <span>{hoursLabel}</span>
                                  ) : (
                                    <Check className="h-4 w-4" />
                                  )
                                ) : cell?.status === 'late' ? (
                                  <span>{hoursLabel || 'Kech'}</span>
                                ) : cell?.status === 'absent' ? (
                                  <X className="h-4 w-4" />
                                ) : cell ? (
                                  <span>{ATTENDANCE_STATUS_LABELS[cell.status]}</span>
                                ) : (
                                  <span className="text-xs">+</span>
                                )}
                              </button>
                            ) : cell ? (
                              <button
                                type="button"
                                onClick={() =>
                                  handleCellClick(worker.id, dateStr, worker.full_name)
                                }
                                className={`${cellButtonClass(cell, false, isNightPresent)} hover:ring-2 hover:ring-indigo-300`}
                              >
                                {cell.status === 'present' ? (
                                  <span>{hoursLabel}</span>
                                ) : cell.status === 'late' ? (
                                  <span>{hoursLabel || 'Kech'}</span>
                                ) : (
                                  <X className="h-3.5 w-3.5" />
                                )}
                              </button>
                            ) : (
                              <span className="inline-block h-7 w-7 text-slate-300">·</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="mt-4 flex flex-wrap gap-4 text-xs text-slate-500">
        <span className="flex items-center gap-1">
          <span className="inline-flex w-5 h-5 items-center justify-center rounded bg-green-50 text-green-700">
            <Check className="h-3 w-3" />
          </span>
          Ishlagan
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-flex min-w-5 h-5 items-center justify-center rounded bg-green-50 px-0.5 text-[10px] font-medium text-green-700">
            1
          </span>
          Erkak stavkasi (0.5, 1, 1.5, 2)
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-flex min-w-5 h-5 items-center justify-center rounded bg-green-50 px-0.5 text-[10px] font-medium text-green-700">
            1+
          </span>
          Qo&apos;shimcha ish ({formatCurrency(extraPay)})
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-flex min-w-5 h-5 items-center justify-center rounded bg-green-50 px-0.5 text-[10px] font-medium text-green-700">
            12K
          </span>
          Kunduzgi smena
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-flex min-w-5 h-5 items-center justify-center rounded bg-indigo-50 px-0.5 text-[10px] font-medium text-indigo-700">
            12T
          </span>
          Kechki smena
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-flex min-w-5 h-5 items-center justify-center rounded bg-amber-50 px-0.5 text-[10px] font-medium text-amber-700">
            Kech
          </span>
          Kech qoldi
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-flex w-5 h-5 items-center justify-center rounded bg-red-50 text-red-600">
            <X className="h-3 w-3" />
          </span>
          Ishlamagan
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-5 w-5 rounded bg-slate-50 text-center leading-5 text-slate-300">
            —
          </span>
          Hali kelmagan kun
        </span>
        {!isEditing && (
          <span className="text-slate-400">
            Katakchani bosib batafsil ma&apos;lumotni ko&apos;ring
          </span>
        )}
      </div>

      {editModal && (
        <Modal
          isOpen
          onClose={() => setEditModal(null)}
          title={
            editModal.mode === 'absent'
              ? 'Kelmaslik sababi'
              : editIsMale
                ? 'Kunlik stavka'
                : editNeedsShift
                  ? 'Ishlangan soatlar va smena'
                  : 'Ishlangan soatlar'
          }
        >
          <form
            className="space-y-4"
            onSubmit={handleModalSubmit}
            onKeyDown={handleModalKeyDown}
          >
            {editModal.mode === 'present' ? (
              <>
                {editIsMale ? (
                  <>
                    <Select
                      id="stavka"
                      label="Stavka"
                      required
                      autoFocus
                      value={modalHours}
                      onChange={(e) => setModalHours(e.target.value)}
                      options={MALE_STAVKA_OPTIONS.map((value) => ({
                        value: String(value),
                        label: `${formatStavka(value)} stavka`,
                      }))}
                    />
                    <label className="flex items-start gap-3 rounded-lg border border-slate-200 px-3 py-3 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 rounded border-slate-300"
                        checked={modalExtra}
                        onChange={(e) => setModalExtra(e.target.checked)}
                      />
                      <span>
                        <span className="font-medium text-slate-900">Qo&apos;shimcha ish</span>
                        <span className="mt-0.5 block text-xs text-slate-500">
                          Shu kun uchun qo&apos;shimcha {formatCurrency(extraPay)}.
                        </span>
                      </span>
                    </label>
                    <p className="text-xs text-slate-500">
                      1 stavka = {formatCurrency(editDailyRate)}. Shu kun:{' '}
                      {formatCurrency(maleDayPay(editDailyRate, editStavka, modalExtra, extraPay))}.
                    </p>
                  </>
                ) : null}
                {editNeedsShift && (
                  <Select
                    id="shift"
                    label="Smena"
                    required
                    value={modalShift}
                    onChange={(e) => {
                      const value = e.target.value;
                      setModalShift(value === 'night' || value === 'day' ? value : '');
                    }}
                    options={shiftOptions}
                  />
                )}
                {editIsMale ? null : (
                  <Input
                    id="hours"
                    label="Ishlangan soatlar"
                    type="number"
                    min={0.5}
                    max={24}
                    step={0.5}
                    autoFocus
                    value={modalHours}
                    onChange={(e) => setModalHours(e.target.value)}
                  />
                )}
              </>
            ) : (
              <div className="space-y-1">
                <label className="block text-sm font-medium text-slate-700">
                  Kelmaslik sababi
                </label>
                <select
                  autoFocus
                  value={modalNotes}
                  onChange={(e) => setModalNotes(e.target.value)}
                  className="block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                >
                  <option value="Sababsiz kelmadi">Sababsiz kelmadi</option>
                  <option value="Kasallik">Kasallik</option>
                  <option value="Ta&apos;til">Ta&apos;til</option>
                  <option value="Shaxsiy sabab">Shaxsiy sabab</option>
                  <option value="Ruxsat bilan">Ruxsat bilan</option>
                </select>
              </div>
            )}
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
              <Button
                type="button"
                variant="secondary"
                className="w-full sm:w-auto"
                onClick={() => setEditModal(null)}
              >
                Bekor qilish
              </Button>
              {editModal.mode === 'present' ? (
                <>
                  <Button
                    type="button"
                    variant="danger"
                    className="w-full sm:w-auto"
                    onClick={() =>
                      setEditModal((prev) => (prev ? { ...prev, mode: 'absent' } : null))
                    }
                  >
                    <X className="mr-2 h-4 w-4" />
                    Ishlamadi
                  </Button>
                  <Button type="submit" className="w-full sm:w-auto">
                    <Check className="mr-2 h-4 w-4" />
                    Saqlash
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="secondary"
                    className="w-full sm:w-auto"
                    onClick={() =>
                      setEditModal((prev) => (prev ? { ...prev, mode: 'present' } : null))
                    }
                  >
                    Orqaga
                  </Button>
                  <Button type="submit" variant="danger" className="w-full sm:w-auto">
                    <X className="mr-2 h-4 w-4" />
                    Saqlash
                  </Button>
                </>
              )}
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

function AttendanceMobileMonth({
  month,
  dates,
  workers,
  worker,
  onWorkerChange,
  isEditing,
  selectedCell,
  getCell,
  emptyLabel,
  onDayClick,
  canEditDay,
}: {
  month: string;
  dates: string[];
  workers: Worker[];
  worker: Worker | null;
  onWorkerChange: (workerId: string) => void;
  isEditing: boolean;
  selectedCell: { workerId: string; date: string } | null;
  getCell: (workerId: string, date: string) => CellData | undefined;
  canEditDay: (workerId: string, date: string) => boolean;
  emptyLabel: string;
  onDayClick: (workerId: string, date: string, workerName: string) => void;
}) {
  const offset = firstWeekdayOffset(month);

  if (!worker) {
    return (
      <Card className="md:hidden">
        <CardContent className="py-12 text-center text-sm text-slate-500">
          {emptyLabel}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="mb-4 space-y-3 md:hidden">
      <Select
        id="attendance-mobile-worker"
        label="Ishchi"
        value={worker.id}
        onChange={(event) => onWorkerChange(event.target.value)}
        options={workers.map((item) => ({
          value: item.id,
          label: item.deleted_at ? `${item.full_name} (o‘chirilgan)` : item.full_name,
        }))}
      />
      <Card>
        <CardContent className="px-3 pt-4">
          <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-slate-500">
            {WEEKDAYS.map((day) => (
              <div key={day} className="min-w-0 py-1">
                {day}
              </div>
            ))}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-1">
            {Array.from({ length: offset }).map((_, index) => (
              <div key={`pad-${index}`} />
            ))}
            {dates.map((date) => (
              <MobileDayCell
                key={date}
                date={date}
                worker={worker}
                cell={getCell(worker.id, date)}
                future={isFutureDate(date) || !canEditDay(worker.id, date)}
                isEditing={isEditing}
                selected={
                  selectedCell?.workerId === worker.id && selectedCell.date === date
                }
                onDayClick={onDayClick}
              />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function MobileDayCell({
  date,
  worker,
  cell,
  future,
  isEditing,
  selected,
  onDayClick,
}: {
  date: string;
  worker: Worker;
  cell: CellData | undefined;
  future: boolean;
  isEditing: boolean;
  selected: boolean;
  onDayClick: (workerId: string, date: string, workerName: string) => void;
}) {
  const day = Number(date.slice(-2));
  const interactive = !future && (isEditing || Boolean(cell));
  let classes =
    'flex min-h-16 w-full min-w-0 flex-col overflow-hidden break-words rounded-lg border px-0.5 py-1 text-left';

  if (future) {
    classes += ' border-slate-100 bg-slate-50 text-slate-300';
  } else if (!cell) {
    classes += ' border-slate-200 bg-white text-slate-400';
  } else if (cell.status === 'late') {
    classes += ' border-yellow-200 bg-yellow-50 text-yellow-900';
  } else if (cell.status === 'present' && cell.shift === 'night') {
    classes += ' border-indigo-200 bg-indigo-50 text-indigo-900';
  } else if (cell.status === 'present') {
    classes += ' border-green-200 bg-green-50 text-green-900';
  } else if (cell.status === 'absent') {
    classes += ' border-red-200 bg-red-50 text-red-900';
  } else {
    classes += ' border-slate-200 bg-slate-50 text-slate-600';
  }

  if (selected) classes += ' ring-2 ring-inset ring-indigo-400';

  const detail = cell
    ? isPaidStatus(cell.status)
      ? presentCellLabel(
          worker,
          cell.hoursWorked,
          cell.shift,
          isFemale12hWorker(worker),
          cell.notes
        )
      : cell.status === 'absent'
        ? getAbsenceReason(cell.status, cell.notes)
        : ''
    : '';

  const body = (
    <>
      <div className="text-xs font-semibold">{day}</div>
      {!future ? (
        <div className="mt-0.5 text-[10px] leading-tight">
          {cell ? shortMobileStatus(cell.status) : '—'}
        </div>
      ) : null}
      {detail ? (
        <div className="mt-0.5 line-clamp-2 text-[10px] leading-tight opacity-80">
          {detail}
        </div>
      ) : null}
    </>
  );

  if (!interactive) {
    return <div className={classes}>{body}</div>;
  }

  return (
    <button
      type="button"
      onClick={() => onDayClick(worker.id, date, worker.full_name)}
      className={classes}
    >
      {body}
    </button>
  );
}
