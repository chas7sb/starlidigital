"""Native producer for the company-only display-note job on the platform GraphQL API."""
import starli_portable as _portable
import asyncio
import hashlib
import hmac
import json
import logging
import re
from urllib.parse import urlsplit

import httpx

from transport import GrantDenied, digest, native_scope


async def verified_platform_result(job, receipt):
    """Validate the physical fields in the authenticated producer status reply.

    The enrolled Node service verifies the host signature before storing this
    receipt. The physical signing key is intentionally absent from native WebUI.
    """
    raw = receipt.get("physicalReceipt")
    if not isinstance(raw, dict) or receipt.get("physicalReceiptDigest") != digest(raw):
        return None
    mapping = {"companyId": "company_id", "computerId": "computer_id", "botId": "bot_id",
               "roomId": "room_id", "actorUserId": "actor_id", "runId": "run_id",
               "assistantMessageId": "assistant_message_id", "toolCallId": "tool_call_id",
               "operationId": "operation_id", "noteSha256": "noteSha256"}
    if any(job[key] != raw.get(field) for key, field in mapping.items()):
        return None
    if (raw.get("state") != "DISPLAYED" or raw.get("viewer_id") != receipt.get("viewerId")
            or type(raw.get("epoch")) is not int or raw["epoch"] < 1 or raw["epoch"] != receipt.get("epoch")
            or raw.get("frameSha256") != receipt.get("frameSha256")
            or not re.fullmatch("[0-9a-f]{64}", raw.get("frameSha256", ""))
            or not re.fullmatch("[0-9a-f]{64}", raw.get("frame_receipt", ""))
            or not isinstance(receipt.get("signedPhysicalReceipt"), str)
            or not 32 <= len(receipt["signedPhysicalReceipt"]) <= 8192):
        return None
    return {"viewerId": raw["viewer_id"]}


class PlatformNoteJobs:
    SUBMIT = """mutation PrimeNoteSubmit($serviceToken:String!,$envelope:String!){
      companyComputerNoteSubmit(serviceToken:$serviceToken,envelope:$envelope){message}}"""
    STATUS = """mutation PrimeNoteStatus($serviceToken:String!,$operationId:String!){
      companyComputerNoteStatus(serviceToken:$serviceToken,operationId:$operationId){message}}"""

    def __init__(self, channel, worker, submit, result, verify_physical, *,
                 deadline=50.0, poll_interval=0.3):
        self.channel = channel
        self.worker = worker
        self.submit = submit
        self.result = result
        self.verify_physical = verify_physical
        self.deadline = deadline
        self.poll_interval = poll_interval
        self.pending = {}

    @staticmethod
    def graphql_producer(origin, service_token):
        parts = urlsplit(origin)
        # Destination is operator-owned configuration, never a caller-selected host.
        expected = urlsplit(_portable.company_platform_url())
        if (parts.username or parts.password or parts.query or parts.fragment
                or (parts.scheme, parts.netloc) != (expected.scheme, expected.netloc)
                or parts.path not in ("/graphql", "/_company-note-stage/graphql")):
            raise ValueError("Expected an enrolled platform GraphQL endpoint")
        if not service_token.startswith("starli_company_note_"):
            raise ValueError("Dedicated company producer enrollment required")

        async def execute(query, field, variables):
            variables["serviceToken"] = service_token
            async with httpx.AsyncClient(trust_env=False, timeout=httpx.Timeout(8, connect=2), follow_redirects=False) as client:
                async with client.stream("POST", origin, json={"query": query, "variables": variables}) as response:
                    response.raise_for_status()
                    data = bytearray()
                    async for chunk in response.aiter_bytes(8192):
                        data.extend(chunk)
                        if len(data) > 32768:
                            raise GrantDenied()
            body = json.loads(data)
            if body.get("errors"):
                raise GrantDenied()
            return json.loads(body["data"][field]["message"])

        async def submit(envelope):
            return await execute(PlatformNoteJobs.SUBMIT, "companyComputerNoteSubmit",
                                 {"envelope": json.dumps(envelope, separators=(",", ":"))})

        async def result(operation, _job_digest):
            return await execute(PlatformNoteJobs.STATUS, "companyComputerNoteStatus",
                                 {"operationId": operation})
        return submit, result

    async def fresh(self, request):
        operation = request["operationId"]
        current = self.pending.get(operation)
        if current is None:
            if isinstance(operation, str) and re.fullmatch(r"[a-f0-9]{64}", operation):
                logging.getLogger(__name__).warning("Computer authority has no active call operation=%s", operation[:12])
            raise GrantDenied()
        if (not hmac.compare_digest(request["jobDigest"], current[0])
                or request["phase"] not in {"submit", "submitted", "claim", "authorize", "complete",
                                            "verify-physical-receipt", "delivery-status", "binding",
                                            "pre-effect-binding"}
                or not isinstance(request["nonce"], str) or len(request["nonce"]) != 32):
            raise GrantDenied()
        if await current[1]() is not True:
            logging.getLogger(__name__).warning("Native Computer authority denied phase=%s operation=%s", request["phase"], operation[:12])
            raise GrantDenied()
        # Node verifies the signed physical receipt independently before
        # settling; this callback vouches for current native authority only.
        response = {"operationId": operation, "phase": request["phase"], "authorized": True,
                    "nonce": request["nonce"], "jobDigest": current[0]}
        if request["phase"] == "binding":
            response["scope"] = current[3]
        return response

    def callback_route(self):
        return self.channel.endpoint("/internal/company-computer/job-authority", "job.authorize", self.fresh)

    async def display(self, grant, note, authorize):
        if grant["tool"] != "computer.display_note" or await authorize() is not True:
            raise GrantDenied()
        op = grant["operationId"]
        # The node contract is strict. Never serialize a JWT, native closure,
        # model credential or caller-selected transport endpoint into a job.
        job = {k: grant[k] for k in ("companyId", "computerId", "actorUserId", "botId",
                                      "roomId", "runId", "assistantMessageId", "toolCallId",
                                      "operationId", "membershipRevision", "noteSha256")}
        job.update(workerId=self.worker, text=note)
        if hashlib.sha256(note.encode()).hexdigest() != job["noteSha256"] or op in self.pending:
            raise GrantDenied()
        job_hash = digest(job)
        self.pending[op] = (job_hash, authorize, job, native_scope(grant))
        try:
            async with asyncio.timeout(self.deadline):
                ack = await self.submit(self.channel.sign("submit", job))
                if ack["operationId"] != op or ack["jobDigest"] != job_hash:
                    raise GrantDenied()
                while await authorize() is True:
                    try:
                        state = await self.result(op, job_hash)
                    except (httpx.TimeoutException, httpx.TransportError) as error:
                        # Only the read-only delivery query is tried again. Its caller
                        # revalidates rights and the watched viewer before every poll.
                        logging.getLogger(__name__).warning("Computer delivery read unavailable operation=%s reason=%s",
                                                            op[:12], type(error).__name__)
                        await asyncio.sleep(self.poll_interval)
                        continue
                    if state["operationId"] != op or state["jobDigest"] != job_hash:
                        raise GrantDenied()
                    if state["state"] in {"QUEUED", "CLAIMED", "DISPATCHING"}:
                        await asyncio.sleep(self.poll_interval)
                        continue
                    if state["state"] != "DISPLAYED":
                        raise GrantDenied()
                    receipt = state["receipt"]
                    for field in ("companyId", "computerId", "actorUserId", "runId", "assistantMessageId",
                                  "toolCallId", "operationId", "noteSha256", "workerId"):
                        if receipt.get(field) != job[field]:
                            raise GrantDenied()
                    proof = await self.verify_physical(job, receipt)
                    if (not isinstance(proof, dict) or proof.get("viewerId") != native_scope(grant)["viewer_id"]
                            or await authorize() is not True):
                        raise GrantDenied()
                    return {"companyId": job["companyId"], "actorUserId": job["actorUserId"],
                            "runId": job["runId"], "assistantMessageId": job["assistantMessageId"],
                            "operationId": op, "computerId": job["computerId"], "state": "DISPLAYED",
                            "memoryBytes": 1073741824, "viewerId": proof["viewerId"],
                            "epoch": receipt["epoch"], "noteSha256": job["noteSha256"],
                            "frameSha256": receipt["frameSha256"],
                            "receiptSha256": receipt["physicalReceiptDigest"]}
                raise GrantDenied()
        except Exception as error:
            logging.getLogger(__name__).warning("Computer delivery stopped operation=%s reason=%s", op[:12], type(error).__name__)
            raise
        finally:
            # Late claims/late receipts cannot resurrect an expired native run.
            self.pending.pop(op, None)
