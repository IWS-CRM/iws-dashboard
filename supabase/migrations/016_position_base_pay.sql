-- Lavozim boshlang'ich stavkasi
-- Xavfsiz qayta ishga tushirish mumkin (idempotent)

ALTER TABLE public.worker_positions
  ADD COLUMN IF NOT EXISTS base_pay NUMERIC(12, 2);
