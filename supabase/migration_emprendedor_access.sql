-- ============================================================
-- MODO EMPRENDEDOR — MEMBRESÍA RED ON NEGOCIOS (v1.0)
-- Aplicar UNA vez en: Supabase Dashboard → SQL Editor → Run.
-- Idempotente: se puede re-ejecutar sin romper nada.
--
-- Flujo:
--   1. El usuario paga por fuera (pago móvil / transferencia / etc.)
--   2. El administrador crea un código en esta tabla (ver ejemplos abajo)
--   3. El usuario ingresa el código en la app → se activa su membresía
--      con fecha de vencimiento según el plan (7, 15 o 30 días)
--
-- Planes: semanal = 7 días ($5) · quincenal = 15 días ($10) · mensual = 30 días ($15)
-- ============================================================

-- ============================================================
-- 1) TABLA DE CÓDIGOS (solo el administrador la maneja vía Dashboard)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.emprendedor_codes (
  code       text PRIMARY KEY,
  plan       text    NOT NULL CHECK (plan IN ('semanal', 'quincenal', 'mensual')),
  max_uses   integer NOT NULL DEFAULT 1 CHECK (max_uses > 0),
  uses_count integer NOT NULL DEFAULT 0,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- 2) TABLA DE ACCESOS ACTIVOS (una fila por usuario; el tiempo se acumula)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.emprendedor_access (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  plan         text NOT NULL,
  code_used    text,
  activated_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_emprendedor_access_user ON public.emprendedor_access(user_id);

-- ============================================================
-- 3) ROW LEVEL SECURITY
--    - emprendedor_codes: RLS sin políticas → nadie la lee desde la app
--      (solo service_role y el Dashboard). Los códigos viajan por RPC.
--    - emprendedor_access: cada usuario solo ve su propia fila.
-- ============================================================
ALTER TABLE public.emprendedor_codes  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.emprendedor_access ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "emprendedor_access_select_own" ON public.emprendedor_access;
CREATE POLICY "emprendedor_access_select_own" ON public.emprendedor_access
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- ============================================================
-- 4) RPC: ACTIVAR CÓDIGO DE MEMBRESÍA
--    El cliente llama: supabase.rpc('validate_emprendedor_code', { p_code: 'XXXX' })
--    Devuelve: { valid, msg, plan, expires_on }
--    Si el usuario ya tenía membresía vigente, los días del nuevo código
--    se SUMAN a partir del vencimiento actual (no se pierde tiempo).
-- ============================================================
CREATE OR REPLACE FUNCTION public.validate_emprendedor_code(p_code text)
RETURNS TABLE (valid boolean, msg text, plan text, expires_on timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user     uuid := auth.uid();
  v_code     public.emprendedor_codes%ROWTYPE;
  v_base     timestamptz;
  v_new_exp  timestamptz;
BEGIN
  IF v_user IS NULL THEN
    RETURN QUERY SELECT false, 'Debes iniciar sesión para activar tu membresía.', NULL::text, NULL::timestamptz;
    RETURN;
  END IF;

  SELECT * INTO v_code
  FROM public.emprendedor_codes c
  WHERE upper(trim(c.code)) = upper(trim(p_code));

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Código incorrecto. Verifica con el administrador.', NULL::text, NULL::timestamptz;
    RETURN;
  END IF;

  IF NOT v_code.is_active THEN
    RETURN QUERY SELECT false, 'Este código fue desactivado por el administrador.', NULL::text, NULL::timestamptz;
    RETURN;
  END IF;

  IF v_code.uses_count >= v_code.max_uses THEN
    RETURN QUERY SELECT false, 'Este código ya fue utilizado. Solicita uno nuevo al administrador.', NULL::text, NULL::timestamptz;
    RETURN;
  END IF;

  -- Base de cálculo: ahora, o el vencimiento actual si aún tiene membresía activa
  SELECT GREATEST(now(), COALESCE(a.expires_at, now()))
    INTO v_base
  FROM public.emprendedor_access a
  WHERE a.user_id = v_user;

  v_new_exp := v_base + CASE v_code.plan
    WHEN 'semanal'   THEN interval '7 days'
    WHEN 'quincenal' THEN interval '15 days'
    WHEN 'mensual'   THEN interval '30 days'
    ELSE interval '7 days'
  END;

  INSERT INTO public.emprendedor_access AS a (user_id, plan, code_used, activated_at, expires_at)
  VALUES (v_user, v_code.plan, v_code.code, now(), v_new_exp)
  ON CONFLICT (user_id) DO UPDATE
    SET plan         = EXCLUDED.plan,
        code_used    = EXCLUDED.code_used,
        activated_at = now(),
        expires_at   = EXCLUDED.expires_at;

  UPDATE public.emprendedor_codes
     SET uses_count = uses_count + 1
   WHERE code = v_code.code;

  RETURN QUERY SELECT true, '¡Membresía activada con éxito!', v_code.plan, v_new_exp;
END;
$$;

-- ============================================================
-- 5) RPC: CONSULTAR ACCESO VIGENTE DEL USUARIO ACTUAL
--    Devuelve: { active, plan, expires_on }
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_emprendedor_access()
RETURNS TABLE (active boolean, plan text, expires_on timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(a.expires_at > now(), false),
    a.plan,
    a.expires_at
  FROM public.emprendedor_access a
  WHERE a.user_id = auth.uid();
$$;

-- ============================================================
-- 6) GRANTS: solo usuarios autenticados pueden ejecutar las RPC
-- ============================================================
REVOKE ALL ON FUNCTION public.validate_emprendedor_code(text) FROM anon, public;
REVOKE ALL ON FUNCTION public.get_emprendedor_access()       FROM anon, public;

GRANT EXECUTE ON FUNCTION public.validate_emprendedor_code(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_emprendedor_access()        TO authenticated;

-- ============================================================
-- 7) GUÍA RÁPIDA PARA EL ADMINISTRADOR (NELSON)
--    Cuando alguien te pague, genera su código aquí:
--    Supabase Dashboard → SQL Editor → ejecuta un INSERT como estos:
--
--    -- Membresía SEMANAL de un solo uso:
--    INSERT INTO public.emprendedor_codes (code, plan, max_uses)
--    VALUES ('REDON7-A1B2C3', 'semanal', 1);
--
--    -- Membresía QUINCENAL de un solo uso:
--    INSERT INTO public.emprendedor_codes (code, plan, max_uses)
--    VALUES ('REDON15-X9Y8Z7', 'quincenal', 1);
--
--    -- Membresía MENSUAL reutilizable hasta 5 veces (ej: para tus propios negocios):
--    INSERT INTO public.emprendedor_codes (code, plan, max_uses)
--    VALUES ('NELSON-MENSUAL-VIP', 'mensual', 5);
--
--    Para desactivar un código filtrado/robado:
--    UPDATE public.emprendedor_codes SET is_active = false WHERE code = 'REDON7-A1B2C3';
--
--    Para ver quién tiene membresía activa:
--    SELECT * FROM public.emprendedor_access ORDER BY expires_at DESC;
-- ============================================================
