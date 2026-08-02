from myapp.adapters.stub_auth_provider import DEV_USER_ID, StubAuthProvider


def test_returns_fixed_dev_user_with_no_token() -> None:
    provider = StubAuthProvider()

    user = provider.get_user(None)

    assert user.id == DEV_USER_ID


def test_returns_fixed_dev_user_regardless_of_token_value() -> None:
    provider = StubAuthProvider()

    user = provider.get_user("anything-at-all")

    assert user.id == DEV_USER_ID
