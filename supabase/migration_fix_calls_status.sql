-- Fix the CHECK constraint on calls.status to allow all needed values
-- Run this in: Supabase Dashboard → SQL Editor → New Query → Run

-- Step 1: Drop the existing restrictive CHECK constraint
ALTER TABLE calls DROP CONSTRAINT IF EXISTS calls_status_check;

-- Step 2: Add the correct CHECK constraint with all needed statuses
ALTER TABLE calls ADD CONSTRAINT calls_status_check
  CHECK (status IN ('ringing', 'ongoing', 'accepted', 'ended', 'missed'));
