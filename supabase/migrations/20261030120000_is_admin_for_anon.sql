-- Signed-out visitors couldn't read site announcements: the table's read
-- policy calls public.is_admin(), which anon wasn't allowed to execute, so
-- every page load got a 401 ("permission denied for function is_admin")
-- instead of the active announcements. is_admin() only says whether the
-- caller is an admin (false without a session), so anon may run it.
grant execute on function public.is_admin() to anon;
