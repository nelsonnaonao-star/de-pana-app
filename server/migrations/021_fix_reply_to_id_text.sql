-- 021 - messages.reply_to_id pasa de uuid a text
--
-- Motivo: la columna se creó como uuid, pero la app usa ids no-UUID para
-- referencias que no son mensajes: al responder un estado se envía
-- "story_<id_del_estado>". Postgres rechazaba el insert con
-- "invalid input syntax for type uuid", el API devolvía error y la respuesta
-- se quedaba para siempre con el reloj de "enviando" (en todos los teléfonos,
-- en cualquier red).
--
-- El esquema local (SQLite) ya define reply_to_id como TEXT y el cliente ya
-- maneja el prefijo "story_", así que text es el tipo correcto.
--
-- Conserva los valores existentes (UUIDs) tal cual y elimina la FK si existía,
-- porque un text con prefijos no puede referenciar messages(id) de tipo uuid.

BEGIN;

ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_reply_to_id_fkey;

ALTER TABLE public.messages
  ALTER COLUMN reply_to_id TYPE text USING reply_to_id::text;

COMMIT;
