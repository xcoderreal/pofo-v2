from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    secret_key: str = "change-me"
    data_dir: str = "data"

    model_config = {"env_file": ".env", "env_prefix": "MYAPP_"}
