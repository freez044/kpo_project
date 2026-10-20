from pydantic import BaseModel, Field
from colors import Colors

class CategoryCreate(BaseModel):
    name: str = Field(min_length = 1, max_length = 200)
    color: Colors | None = None

class CategoryUpdate(BaseModel):
    name: str | None = Field(default=None, min_length = 1, max_length = 200)
    color: Colors | None = None

class CategoryRead(BaseModel):
    name: str
    color: Colors | None
    


