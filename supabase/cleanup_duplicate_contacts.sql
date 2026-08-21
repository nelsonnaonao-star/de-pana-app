-- ═══════════════════════════════════════════════════════════════════
-- LIMPIEZA SEGURA DE CONTACTOS DUPLICADOS
-- Ejecutar en: Supabase Dashboard → SQL Editor → New query → Run
--
-- Qué hace:
--   • Contactos de Red On (con contact_user_id): deja UNO por persona,
--     priorizando la fila que tiene teléfono y luego la más reciente.
--   • Contactos externos SIN user vinculado: dedupe por (user_id, name,
--     phone) SOLO cuando el teléfono existe (evita fusionar gente con
--     el mismo nombre). Los externos sin teléfono NO se tocan.
--
-- Es seguro: se ejecuta en una transacción y borra únicamente las filas
-- sobrantes (nunca la última de cada persona). Revisa los números del
-- SELECT antes de correr el DELETE.
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1) VISTA PREVIA (NO borra nada) ─────────────────────────────
-- Contactos de Red On que se borrarían (duplicados por persona):
SELECT COUNT(*) AS linked_duplicates_to_delete
FROM (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY user_id, contact_user_id
           ORDER BY
             CASE WHEN phone IS NOT NULL AND phone <> '' THEN 1 ELSE 2 END,
             created_at DESC,
             id DESC
         ) AS rn
  FROM contacts
  WHERE contact_user_id IS NOT NULL
) t
WHERE t.rn > 1;

-- Externos con teléfono que se borrarían:
SELECT COUNT(*) AS external_duplicates_to_delete
FROM (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY user_id, name, phone
           ORDER BY created_at DESC, id DESC
         ) AS rn
  FROM contacts
  WHERE contact_user_id IS NULL
    AND name IS NOT NULL AND name <> ''
    AND phone IS NOT NULL AND phone <> ''
) t
WHERE t.rn > 1;

-- ─── 2) BORRADO (comentar hasta revisar los conteos) ─────────────

-- Contactos de Red On duplicados:
DELETE FROM contacts c
USING (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY user_id, contact_user_id
           ORDER BY
             CASE WHEN phone IS NOT NULL AND phone <> '' THEN 1 ELSE 2 END,
             created_at DESC,
             id DESC
         ) AS rn
  FROM contacts
  WHERE contact_user_id IS NOT NULL
) r
WHERE c.id = r.id AND r.rn > 1;

-- Externos con teléfono duplicados:
DELETE FROM contacts c
USING (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY user_id, name, phone
           ORDER BY created_at DESC, id DESC
         ) AS rn
  FROM contacts
  WHERE contact_user_id IS NULL
    AND name IS NOT NULL AND name <> ''
    AND phone IS NOT NULL AND phone <> ''
) r
WHERE c.id = r.id AND r.rn > 1;

COMMIT;

-- ─── 3) (OPCIONAL) PREVENIR FUTUROS DUPLICADOS ───────────────────
-- Índice único por persona vinculada: el próximo intento de insertar
-- una fila repetida fallará (y el app ya tiene lógica que lo maneja).
-- Si lo activas y el app intenta duplicar, verás un error de conflicto
-- en los logs; puedes decidir luego si quieres cambiar addContact a
-- "upsert". Mientras tanto, déjalo comentado para no cambiar
-- comportamiento.
-- CREATE UNIQUE INDEX IF NOT EXISTS contacts_unique_linked
--   ON contacts (user_id, contact_user_id)
--   WHERE contact_user_id IS NOT NULL;