-- Prevent client-side tampering of plan and stripe_customer_id columns.
-- Only service_role (used by webhooks) can modify these fields.
-- Regular authenticated users' attempts to change them are silently ignored.

create or replace function prevent_plan_tamper()
returns trigger as $$
begin
  if (current_setting('request.jwt.claims', true)::json->>'role') != 'service_role' then
    new.plan := old.plan;
    new.stripe_customer_id := old.stripe_customer_id;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger protect_plan_columns
  before update on public.profiles
  for each row execute function prevent_plan_tamper();
