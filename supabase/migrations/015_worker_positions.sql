-- Ishchi lavozimlari: Creator Nazorat sozlamalaridan boshqariladi
-- Xavfsiz qayta ishga tushirish mumkin (idempotent)

CREATE TABLE IF NOT EXISTS public.worker_positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  base_pay NUMERIC(12, 2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT worker_positions_name_unique UNIQUE (name)
);

CREATE UNIQUE INDEX IF NOT EXISTS worker_positions_name_lower_idx
  ON public.worker_positions (lower(name));

INSERT INTO public.worker_positions (name, sort_order)
VALUES
  ('Qadoqlovchi', 1),
  ('Qandolatchi', 2),
  ('Yordamchi qandolatchi', 3),
  ('Surmachi (vafli)', 4),
  ('Pechkachi (vafli)', 5),
  ('Xamirchi (vafli)', 6),
  ('Yuk tashuvchi', 7),
  ('Kremchi', 8),
  ('Pechkachi (pechenye)', 9),
  ('Xamirchi (pechenye)', 10),
  ('Sendvich operatori', 11),
  ('Brigader', 12),
  ('Ish boshqaruvchi', 13),
  ('Oshpaz', 14),
  ('Farrosh', 15)
ON CONFLICT (name) DO NOTHING;

ALTER TABLE public.worker_positions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages worker positions" ON public.worker_positions;
CREATE POLICY "Service role manages worker positions" ON public.worker_positions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

GRANT ALL ON public.worker_positions TO service_role;
