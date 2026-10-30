from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Настройки сервера из переменных окружения или файла .env."""

    model_config = SettingsConfigDict(env_file='.env', extra='ignore')

    # postgresql+psycopg://пользователь:пароль@хост:5432/planner
    database_url: str


@lru_cache
def get_settings() -> Settings:
    return Settings()
