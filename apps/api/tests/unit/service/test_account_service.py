import pytest

from myapp.domain.model import Account, AccountType
from myapp.service.account_service import AccountService, DuplicateIdError
from tests.fake_repository import FakeAccountRepository


def test_create_account_adds_it_scoped_to_the_owner() -> None:
    service = AccountService(repo=FakeAccountRepository())

    account = service.create_account(
        Account(
            id="1",
            user_id="user-a",
            name="Wells Fargo Brokerage",
            institution="Wells Fargo",
            account_type=AccountType.BROKERAGE,
        )
    )

    assert service.list_accounts(user_id="user-a") == [account]


def test_create_account_rejects_duplicate_id_even_for_a_different_owner() -> None:
    repo = FakeAccountRepository(
        [
            Account(
                id="1",
                user_id="user-a",
                name="A's Brokerage",
                institution="Fidelity",
                account_type=AccountType.BROKERAGE,
            )
        ]
    )
    service = AccountService(repo=repo)

    with pytest.raises(DuplicateIdError):
        service.create_account(
            Account(
                id="1",
                user_id="user-b",
                name="B's IRA",
                institution="Schwab",
                account_type=AccountType.IRA,
            )
        )


def test_list_accounts_only_returns_the_requesting_users_accounts() -> None:
    repo = FakeAccountRepository(
        [
            Account(
                id="1",
                user_id="user-a",
                name="A's Brokerage",
                institution="Fidelity",
                account_type=AccountType.BROKERAGE,
            ),
            Account(
                id="2",
                user_id="user-b",
                name="B's IRA",
                institution="Schwab",
                account_type=AccountType.IRA,
            ),
        ]
    )
    service = AccountService(repo=repo)

    accounts = service.list_accounts(user_id="user-a")

    assert [a.id for a in accounts] == ["1"]


def test_get_account_returns_it_for_the_owner() -> None:
    account = Account(
        id="1",
        user_id="user-a",
        name="Brokerage",
        institution="Fidelity",
        account_type=AccountType.BROKERAGE,
    )
    service = AccountService(repo=FakeAccountRepository([account]))

    assert service.get_account("1", user_id="user-a") == account


def test_get_account_returns_none_for_a_different_user() -> None:
    """Cross-user reads must be indistinguishable from not-found (404, not 403)."""
    account = Account(
        id="1",
        user_id="user-a",
        name="Brokerage",
        institution="Fidelity",
        account_type=AccountType.BROKERAGE,
    )
    service = AccountService(repo=FakeAccountRepository([account]))

    assert service.get_account("1", user_id="user-b") is None


def test_get_account_returns_none_for_a_missing_id() -> None:
    service = AccountService(repo=FakeAccountRepository())

    assert service.get_account("missing", user_id="user-a") is None
