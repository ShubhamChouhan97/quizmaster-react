
CREATE TABLE public.questions (
  id TEXT PRIMARY KEY,
  domain TEXT,
  scenario TEXT NOT NULL,
  options JSONB NOT NULL,
  correct_answer TEXT NOT NULL,
  hint TEXT,
  rationale_correct TEXT,
  rationale_incorrect TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.questions TO anon, authenticated;
GRANT ALL ON public.questions TO service_role;
ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "questions readable by everyone" ON public.questions FOR SELECT USING (true);

CREATE TABLE public.stats (
  id TEXT PRIMARY KEY DEFAULT 'global',
  total_correct INTEGER NOT NULL DEFAULT 0,
  total_wrong INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.stats TO anon, authenticated;
GRANT ALL ON public.stats TO service_role;
ALTER TABLE public.stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "stats readable by everyone" ON public.stats FOR SELECT USING (true);

INSERT INTO public.stats (id) VALUES ('global') ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.record_answer(is_correct BOOLEAN)
RETURNS public.stats
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result public.stats;
BEGIN
  UPDATE public.stats
     SET total_correct = total_correct + CASE WHEN is_correct THEN 1 ELSE 0 END,
         total_wrong   = total_wrong   + CASE WHEN is_correct THEN 0 ELSE 1 END,
         updated_at = now()
   WHERE id = 'global'
  RETURNING * INTO result;
  RETURN result;
END;
$$;
GRANT EXECUTE ON FUNCTION public.record_answer(BOOLEAN) TO anon, authenticated;
