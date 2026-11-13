-- The owners indexes owners_natural_idx and owners_cluster_natural_idx call private.natural_key(), so any
-- role that updates owners must be allowed to run it. The admin-users function (service_role) moves a
-- deleted user's owner records to someone else and failed with "permission denied for function natural_key".
grant usage on schema private to service_role;
grant execute on function private.natural_key(text) to service_role;
