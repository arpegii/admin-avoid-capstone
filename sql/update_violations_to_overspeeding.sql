-- Update ALL violation records to 'Overspeeding' (including NULL values)
-- Run this script in Supabase SQL Editor

UPDATE public.violation_logs
SET violation = 'Overspeeding';

-- Verify the changes
SELECT COUNT(*) as total_records, violation
FROM public.violation_logs
GROUP BY violation;
