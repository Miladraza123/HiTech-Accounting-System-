-- Phase 63.01: a "Job" unit (for service / lump-sum lines). More can be added the same way.
insert into public.units (code, name) values ('JOB', 'Job')
on conflict (code) do nothing;
