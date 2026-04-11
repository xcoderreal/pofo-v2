from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    secret_key: str = "change-me"
    port: int = 8090

    model_config = {
        "env_file": (".env", ".env.local"),
        "env_prefix": "MYAPP_",
    }
