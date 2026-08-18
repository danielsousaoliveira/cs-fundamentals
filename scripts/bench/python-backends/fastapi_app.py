"""Server fixture for python-backends.mdx. Requires fastapi and uvicorn:
    pip install fastapi 'uvicorn[standard]'

Run with:
    uvicorn fastapi_app:app --port 4001 --workers 1
"""

import asyncio
import time

from fastapi import FastAPI

app = FastAPI()


@app.get("/fast")
async def fast():
    await asyncio.sleep(0)
    return {"ok": True}


@app.get("/block")
async def block():
    # Synchronous sleep inside an async route: does not yield the loop.
    time.sleep(0.02)
    return {"ok": True}


@app.get("/block-async")
async def block_async():
    # Cooperative sleep: yields the loop while waiting.
    await asyncio.sleep(0.02)
    return {"ok": True}
