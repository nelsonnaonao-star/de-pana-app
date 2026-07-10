-- Run this SQL in your Supabase Dashboard > SQL Editor
-- Grants INSERT and SELECT on the chat-images bucket to authenticated users

-- Allow authenticated users to upload files
CREATE POLICY "Allow authenticated uploads"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'chat-images');

-- Allow authenticated users to view/download files
CREATE POLICY "Allow authenticated downloads"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'chat-images');

-- Allow users to delete their own uploaded files
CREATE POLICY "Allow users to delete own files"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'chat-images' AND owner_id = auth.uid());
