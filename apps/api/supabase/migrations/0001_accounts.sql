-- Accounts: user-owned brokerage/IRA/crypto-exchange/cash holding vehicles.
-- See docs/domain-model.md and docs/auth.md for the design this implements.
--
-- Not yet applied against a live Supabase project — no MYAPP_REPOSITORY=
-- supabase adapter exists yet (see docs/environments.md; a real Supabase-
-- backed AccountRepository lands in a later ticket). Checked in now,
-- alongside the table it protects, per docs/security.md's checklist: "RLS
-- policy lands in the same migration that creates the table — never a
-- follow-up." Written and reviewed now so there is never a window where
-- this table exists without ownership enforcement once it is applied.

create table if not exists public.accounts (
    id text primary key,
    user_id uuid not null references auth.users(id) on delete cascade,
    name text not null,
    institution text not null,
    account_type text not null check (account_type in ('brokerage', 'ira', 'crypto_exchange', 'cash')),
    created_at timestamptz not null default now()
);

create index if not exists accounts_user_id_idx on public.accounts (user_id);

alter table public.accounts enable row level security;

-- Owner-only access — matches AccountService.get_account's "cross-user
-- reads return None" policy (docs/auth.md: 404, not 403). A row simply
-- does not exist from another user's perspective.
create policy "accounts_select_own" on public.accounts
    for select using (auth.uid() = user_id);

create policy "accounts_insert_own" on public.accounts
    for insert with check (auth.uid() = user_id);

-- No update/delete policy here — none existed when this table was
-- written. The delete policy landed with the endpoint that needed it, in
-- 0002_accounts_delete_policy.sql (#24). There is still no update policy,
-- because nothing edits an Account.
