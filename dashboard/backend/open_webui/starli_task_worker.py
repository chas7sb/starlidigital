"""Standalone delegated Pi worker. Run only with STARLI_EXTERNAL_WORKER=1."""
import asyncio
import os
import socket
import uuid

from open_webui.routers.starli_runtime_adapter import worker_forever


def main():
    if os.getenv("STARLI_EXTERNAL_WORKER") != "1":
        raise SystemExit("Set STARLI_EXTERNAL_WORKER=1 before starting worker")
    worker_id=socket.gethostname()+":"+uuid.uuid4().hex
    async def serve():
        await asyncio.gather(*(worker_forever(worker_id+":"+str(i)) for i in range(3)))
    asyncio.run(serve())


if __name__ == "__main__":
    main()
