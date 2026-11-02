from collections.abc import Iterator
from functools import lru_cache

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session

from app.config import get_settings


@lru_cache
def get_engine() -> Engine:
    return create_engine(get_settings().database_url, pool_pre_ping=True)


def get_session() -> Iterator[Session]:
    """Зависимость FastAPI: один сеанс и одна транзакция на запрос.

    Транзакция фиксируется, если обработчик завершился без исключения, иначе откатывается.
    """
    with Session(get_engine(), expire_on_commit=False) as session, session.begin():
        yield session
