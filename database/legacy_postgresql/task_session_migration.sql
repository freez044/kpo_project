begin;

drop table if exists task_session;

alter table goal
drop column if exists estimated_duration_minutes;

commit;

rollback;

do $$
begin
	
	if to_regclass('public.task_session') is not null then
		raise exception 'Ошибка: таблица task_session всё ещё существует';
	end if;
	
	if exists (
		select 1
		from information_schema.columns
		where table_schema = 'public'
		and table_name = 'goal'
		and column_name = 'estimated_duration_minutes'
	) then
		raise exception 'Ошибка: поле estimated_duration_minutes всё ещё существует';
	end if;
	
	
	if not exists (
		select 1
		from information_schema.columns
		where table_schema = 'public'
		and table_name = 'task'
		and column_name = 'estimated_duration_minutes'
	) then
		raise exception 'Ошибка: поле estimated_duration_minutes отсутствует';
	end if;
	
end $$;


select 'Migration completed successfully.' as result
