-- FIX v1.1: corrige el bug de expires_at nulo para usuarios sin membresía previa
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

  -- Base de cálculo: ahora, o el vencimiento actual si aún tiene membresía activa.
  -- FIX: subconsulta escalar + COALESCE para que funcione también cuando el usuario
  -- aún NO tiene ninguna fila en emprendedor_access (antes devolvía NULL y rompía el INSERT).
  SELECT COALESCE(
           (SELECT GREATEST(now(), a.expires_at)
            FROM public.emprendedor_access a
            WHERE a.user_id = v_user),
           now()
         )
    INTO v_base;

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
