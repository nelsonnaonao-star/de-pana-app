-- Añade soporte para documentos en el chat (pdf, apk, word, etc.)
-- El servidor guardaba document_name/type/size pero nunca la URL del archivo
-- por lo que el documento se perdía al enviarse. Esta columna la almacena.

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS file_url TEXT;

-- Opcional: materializar la URL en mensajes existentes que la tuvieran en otro campo
-- (ninguno hasta ahora), no se toca nada.