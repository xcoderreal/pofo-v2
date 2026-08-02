-- Owner-only DELETE on accounts, for the cascade delete built in #24
-- (DELETE /accounts/{account_id} → AccountService.delete_account).
--
-- A forward migration rather than an edit to 0001, per docs/deployment.md
-- § "migrations are append-only once applied to a long-lived environment".
-- 0001 said the update/delete policy should land "alongside whichever
-- ticket builds one" — this is that ticket.
--
-- Still no UPDATE policy: nothing edits an Account. Transaction edit and
-- delete is #25 and gets its own.

create policy "accounts_delete_own" on public.accounts
    for delete using (auth.uid() = user_id);

-- The service-layer cascade (AccountService.delete_account) deletes the
-- account's Transactions first and the Account second, and is the only
-- cascade there is today because no `transactions` table migration exists
-- yet. When one lands it must carry
--   account_id text not null references public.accounts(id) on delete cascade
-- so the database enforces the same rule the service does — with its own
-- owner-only delete policy in that same migration, per docs/security.md.
-- Deleting by account (never by instrument) is what makes this safe:
-- FIFO lot matching is scoped per Account, so an Account's Transactions
-- cannot be closing lots anywhere else.
