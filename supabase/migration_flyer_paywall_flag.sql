-- ============================================================
-- FEATURE FLAG: PUBLICAR FLYER (PAYWALL ON/OFF) — v1.0
-- Aplicar UNA vez en: Supabase Dashboard → SQL Editor → Run.
-- Idempotente: se puede re-ejecutar sin romper nada.
--
-- Qué hace: activa/desactiva la exigencia de membresía para
-- publicar flyers SIN re-subir la app.
--
--   enabled = false → MODO PRUEBA: se publica libre (sin banner)
--   enabled = true  → MODO PRODUCCIÓN: exige membresía vigente
--
-- Cómo alternar desde el Dashboard (sin tocar la app):
--   UPDATE public.feature_flags SET enabled = true  WHERE name = 'flyer_paywall_active';  -- activar paywall
--   UPDATE public.feature_flags SET enabled = false WHERE name = 'flyer_paywall_active';  -- modo prueba
-- ============================================================

-- 1) TABLA DE FEATURE FLAGS (una fila por flag; la maneja el admin vía Dashboard)
CREATE TABLE IF NOT EXISTS public.feature_flags (
  name       text PRIMARY KEY,
  enabled    boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Flag por defecto en MODO PRUEBA (publicación libre)
INSERT INTO public.feature_flags (name, enabled)
VALUES ('flyer_paywall_active', false)
ON CONFLICT (name) DO NOTHING;

-- ============================================================
-- 2) ROW LEVEL SECURITY
--    Sin políticas de lectura: la app NO lee la tabla directo.
--    El valor viaja por RPC (SECURITY DEFINER) y permanece oculto.
-- ============================================================
ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 3) RPC: LEER UN FEATURE FLAG
--    El cliente llama: supabase.rpc('get_feature_flag', { p_name: 'flyer_paywall_active' })
--    Devuelve el boolean; si el flag no existe devuelve false.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_feature_flag(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT enabled FROM public.feature_flags WHERE name = p_name),
    false
  );
$$;

-- ============================================================
-- 4) GRANTS: solo usuarios autenticados ejecutan la RPC;
--    la tabla queda restringida a service_role / Dashboard.
-- ============================================================
REVOKE ALL ON FUNCTION public.get_feature_flag(text) FROM anon, public;

GRANT EXECUTE ON FUNCTION public.get_feature_flag(text) TO authenticated;