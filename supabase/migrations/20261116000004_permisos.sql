-- "Exponer tablas automáticamente" está desactivado: permisos explícitos solo para service_role
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant execute on functions to service_role;
revoke all on all tables in schema public from anon, authenticated;
revoke execute on all functions in schema public from anon, authenticated, public;

-- programar_tareas es security definer: solo service_role la puede ejecutar
revoke execute on function programar_tareas(text, text) from public, anon, authenticated;
grant execute on function programar_tareas(text, text) to service_role;
