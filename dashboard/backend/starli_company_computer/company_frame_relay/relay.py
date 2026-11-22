import copy
import base64
import hashlib
import logging
import json
import secrets
import threading
import time
from dataclasses import dataclass


class RelayError(Exception):
    def __init__(self, status=403, code="VIEW_UNAVAILABLE"):
        self.status, self.code = status, code


@dataclass(frozen=True)
class EnrolledPublisher:
    company_id: str
    computer_id: str
    publisher_id: str
    enrollment_revision: int | str


def sanitize_jpeg(raw):
    """Structural baseline/progressive JPEG check, no image decompression.

    Remove APP/COM metadata including EXIF/ICC/GPS and reject trailing payloads.
    Capture remains the enrolled device's job. No Pillow/native decoder required.
    """
    if not isinstance(raw, bytes) or not 4 <= len(raw) <= 512 * 1024 or raw[:2] != b"\xff\xd8":
        raise RelayError(400, "INVALID_JPEG")
    out = bytearray(raw[:2])
    pos, width, height, scans, segments = 2, 0, 0, 0, 0
    while pos < len(raw):
        start = pos
        if raw[pos] != 255:
            raise RelayError(400, "INVALID_JPEG")
        while pos < len(raw) and raw[pos] == 255:
            pos += 1
        if pos >= len(raw):
            raise RelayError(400, "INVALID_JPEG")
        marker = raw[pos]
        pos += 1
        segments += 1
        if segments > 128:
            raise RelayError(400, "INVALID_JPEG")
        if marker == 0xD9:
            if pos != len(raw) or not width or not scans:
                raise RelayError(400, "INVALID_JPEG")
            out.extend(b"\xff\xd9")
            if len(out) > 384 * 1024:
                raise RelayError(413, "FRAME_TOO_LARGE")
            return bytes(out)
        if marker not in {0xC0, 0xC2, 0xC4, 0xDB, 0xDD, 0xDA, 0xFE, *range(0xE0, 0xF0)}:
            raise RelayError(400, "INVALID_JPEG")
        if pos + 2 > len(raw):
            raise RelayError(400, "INVALID_JPEG")
        size = int.from_bytes(raw[pos:pos + 2], "big")
        end = pos + size
        if size < 2 or end > len(raw):
            raise RelayError(400, "INVALID_JPEG")
        body = raw[pos + 2:end]
        if marker in (0xC0, 0xC2):
            if width or len(body) < 6 or body[0] != 8 or body[5] not in (1, 3) or len(body) != 6 + 3 * body[5]:
                raise RelayError(400, "INVALID_JPEG")
            height, width = int.from_bytes(body[1:3], "big"), int.from_bytes(body[3:5], "big")
            if not 1 <= width <= 1280 or not 1 <= height <= 720:
                raise RelayError(400, "FRAME_DIMENSIONS")
        if marker == 0xDA:
            scans += 1
            if not width or scans > 8 or not body or body[0] not in (1, 2, 3) or len(body) != 4 + 2 * body[0]:
                raise RelayError(400, "INVALID_JPEG")
        if not (0xE0 <= marker <= 0xEF or marker == 0xFE):
            out.extend(b"\xff" + bytes([marker]) + raw[pos:end])
        pos = end
        if marker == 0xDA:
            entropy = pos
            while True:
                hit = raw.find(b"\xff", pos)
                if hit < 0 or hit + 1 >= len(raw):
                    raise RelayError(400, "INVALID_JPEG")
                following = hit + 1
                while following < len(raw) and raw[following] == 255:
                    following += 1
                if following >= len(raw):
                    raise RelayError(400, "INVALID_JPEG")
                if raw[following] == 0 or 0xD0 <= raw[following] <= 0xD7:
                    pos = following + 1
                    continue
                out.extend(raw[entropy:hit])
                pos = hit
                break
    raise RelayError(400, "INVALID_JPEG")


class Relay:
    def __init__(self, issuer, publisher_authorize, binding_authorize, *, monotonic=time.monotonic, wall=time.time,
                 max_viewers=8, viewer_ttl=15, absolute_ttl=120, frame_ttl=2):
        if not callable(publisher_authorize) or not callable(binding_authorize) or not 1 <= max_viewers <= 8:
            raise ValueError("Explicit enrolled publisher authority required")
        if not 1 <= viewer_ttl <= 15 or not 1 <= absolute_ttl <= 120 or not 0 < frame_ttl <= 2:
            raise ValueError("Invalid expiry limits")
        self.issuer, self.publisher_authorize = issuer, publisher_authorize
        self.binding_authorize = binding_authorize
        self.clock, self.wall = monotonic, wall
        self.max_viewers, self.viewer_ttl, self.absolute_ttl, self.frame_ttl = max_viewers, viewer_ttl, absolute_ttl, frame_ttl
        self.lock = threading.RLock()
        self.records, self.compat = {}, {}
        self.publisher_seen_at, self.publisher_identity = None, None

    def _snapshot(self, session):
        try:
            if session.revalidate() is not True:
                raise ValueError()
            value = self.issuer.snapshot(session)
            if value["companyId"] != self.issuer.company or value["computerId"] != self.issuer.computer:
                raise ValueError()
            if value["actorUserId"] != session.user_id or not value["viewerId"]:
                raise ValueError()
            if self.binding_authorize(copy.deepcopy(value)) is not True:
                raise ValueError()
            return value
        except Exception as error:
            logging.getLogger(__name__).info("Computer viewer snapshot denied (%s)", type(error).__name__)
            raise RelayError() from None

    @staticmethod
    def _key(binding):
        stable = {k: v for k, v in binding.items() if k not in ("runId", "assistantMessageId")}
        return hashlib.sha256(json.dumps(stable, sort_keys=True, separators=(",", ":")).encode()).hexdigest()

    def _refresh_binding(self, record, current):
        if self._key(current) != self._key(record["binding"]):
            raise RelayError()
        if current != record["binding"]:
            # Authorized run admission/terminal transitions preserve the viewer,
            # but never retain pixels or tickets from the previous run binding.
            record.update(binding=copy.deepcopy(current), jpeg=None, pending=None,
                          sequence=record["sequence"] + 1)

    def _drop(self, rid):
        self.records.pop(rid, None)
        self.compat = {key: value for key, value in self.compat.items() if value != rid}

    def _prune(self):
        now = self.clock()
        for rid, record in list(self.records.items()):
            if now >= min(record["expires"], record["absolute"]):
                self._drop(rid)
            elif record["jpeg"] is not None and now - record["frameAt"] > self.frame_ttl:
                record["jpeg"] = None

    def _live(self, rid, session=None):
        self._prune()
        record = self.records.get(rid)
        if record is None:
            raise RelayError(404)
        try:
            self._refresh_binding(record, self._snapshot(record["session"]))
        except RelayError:
            self._drop(rid)
            raise
        # A foreign reader must not be able to revoke the legitimate viewer.
        if session is not None:
            self._refresh_binding(record, self._snapshot(session))
        return record

    def _publisher(self, identity):
        if not isinstance(identity, EnrolledPublisher):
            raise RelayError()
        if identity.company_id != self.issuer.company or identity.computer_id != self.issuer.computer:
            raise RelayError()
        try:
            if self.publisher_authorize(identity) is not True:
                raise ValueError()
        except Exception:
            raise RelayError() from None

    def viewer_for_run(self, grant, pinned=None):
        """Resolve an actual watching member for this specific active channel turn."""
        expected = {k: grant[k] for k in ("companyId", "computerId", "roomId", "botId",
                                           "actorUserId", "runId", "assistantMessageId", "membershipRevision")}
        expected["actorBindingSha256"] = hashlib.sha256(
            json.dumps(grant["actorBinding"], ensure_ascii=False, separators=(",", ":")).encode()
        ).hexdigest()
        with self.lock:
            if not self.publisher_live():
                logging.getLogger(__name__).warning("Computer viewer unavailable operation=%s reason=publisher", grant["operationId"][:12])
                return None
            for rid in list(self.records):
                try:
                    record = self._live(rid)
                except RelayError:
                    continue
                binding = record["binding"]
                if (record["lastUpload"] is not None and
                        all(binding.get(k) == v for k, v in expected.items()) and
                        (pinned is None or pinned == binding["viewerId"])):
                    return binding["viewerId"]
            return None

    def open(self, session, company, *, compatibility=False):
        with self.lock:
            binding = self._snapshot(session)
            if company != binding["companyId"]:
                raise RelayError()
            if not self.publisher_live():
                raise RelayError(503, "PUBLISHER_OFFLINE")
            self._prune()
            key = self._key(binding)
            if compatibility and key in self.compat:
                rid = self.compat[key]
                self._live(rid, session)
                return self._descriptor(rid)
            if len(self.records) >= self.max_viewers:
                raise RelayError(429, "VIEWER_CAPACITY")
            rid = secrets.token_urlsafe(24)
            now = self.clock()
            self.records[rid] = dict(session=session, binding=copy.deepcopy(binding), expires=now + self.viewer_ttl,
                                     absolute=now + self.absolute_ttl, jpeg=None, frameAt=0, sequence=0,
                                     pending=None, lastUpload=None)
            if compatibility:
                self.compat[key] = rid
            return self._descriptor(rid)

    def _descriptor(self, rid):
        record = self.records[rid]
        return {"relayId": rid, "viewerId": record["binding"]["viewerId"], "viewer_id": record["binding"]["viewerId"],
                "companyId": self.issuer.company, "computerId": self.issuer.computer,
                "company": self.issuer.company, "computer": self.issuer.computer, "paired": self.publisher_live(),
                "mode": "native-latest-frame-relay", "cursor": record["sequence"],
                "frameUrl": "/api/v1/company-computer/frame", "viewOnly": True, "expiresIn": self.viewer_ttl}

    def resolve_compat(self, session):
        with self.lock:
            binding = self._snapshot(session)
            rid = self.compat.get(self._key(binding))
            if not rid:
                raise RelayError(404)
            return rid

    def frame(self, session, company, rid, after=0):
        if type(after) is not int or not 0 <= after <= 2**53 - 1:
            raise RelayError(400, "INVALID_CURSOR")
        with self.lock:
            record = self._live(rid, session)
            if company != record["binding"]["companyId"]:
                raise RelayError()
            if after > record["sequence"]:
                raise RelayError(409, "CURSOR_AHEAD")
            record["expires"] = min(self.clock() + self.viewer_ttl, record["absolute"])
            self._live(rid, session)
            data = record["jpeg"] if record["sequence"] > after else None
            return data, record["sequence"]

    def close(self, session, company, rid):
        with self.lock:
            record = self._live(rid, session)
            if company != record["binding"]["companyId"]:
                raise RelayError()
            self._drop(rid)

    def work(self, identity):
        with self.lock:
            self._publisher(identity)
            self.publisher_seen_at, self.publisher_identity = self.clock(), identity
            self._prune()
            jobs = []
            for rid in list(self.records):
                try:
                    record = self._live(rid)
                except RelayError:
                    continue
                if record["lastUpload"] is not None and self.clock() - record["lastUpload"] < 0.25:
                    continue
                if record["pending"] is None or record["pending"]["claims"]["exp"] <= self.wall():
                    grant = self.issuer.issue(record["session"], "frame")
                    claims = grant.get("claims", {})
                    if (any(claims.get(k) != v for k, v in record["binding"].items())
                            or claims.get("operation") != "frame"
                            or claims.get("aud") != "starli-company-stage-viewer-v1"
                            or type(claims.get("iat")) is not int or type(claims.get("exp")) is not int
                            or not self.wall() < claims["exp"] <= claims["iat"] + 5
                            or not isinstance(claims.get("nonce"), str)):
                        self._drop(rid)
                        continue
                    record["pending"] = copy.deepcopy(grant)
                self._live(rid)
                if record["pending"] is None:
                    continue
                jobs.append({"relayId": rid, "nextSequence": record["sequence"] + 1,
                             "grant": copy.deepcopy(record["pending"])})
            self._publisher(identity)
            return {"version": 1, "jobs": jobs, "maxInputBytes": 512 * 1024, "maxStoredBytes": 384 * 1024,
                    "maxWidth": 1280, "maxHeight": 720, "pollAfterMs": 250}

    def publisher_live(self):
        with self.lock:
            if self.publisher_seen_at is None or self.clock() - self.publisher_seen_at > 5:
                return False
            try:
                self._publisher(self.publisher_identity)
                return True
            except RelayError:
                return False

    def signed_work(self, identity, request_id):
        import re
        if not isinstance(request_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{16,128}", request_id):
            raise RelayError(400, "PUBLISHER_REQUEST_REQUIRED")
        with self.lock:
            work = self.work(identity)
            now = self.wall()
            remaining = [max(0, int((j["grant"]["claims"]["exp"] - now) * 1000)) for j in work["jobs"]]
            claims = {"aud": "starli-company-relay-work-v1", "operation": "frame.work",
                      "publisherRole": "company-frame-publisher", "publisherId": identity.publisher_id,
                      "enrollmentRevision": identity.enrollment_revision, "companyId": identity.company_id,
                      "computerId": identity.computer_id, "requestId": request_id,
                      "iat": int(now), "freshForMs": min([2000, *remaining]), "work": work}
            raw = json.dumps(claims, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
            signature = base64.urlsafe_b64encode(self.issuer.key.sign(raw)).rstrip(b"=").decode()
            return {"claims": claims, "signature": signature}

    def upload(self, identity, rid, nonce, sequence, raw):
        # Check active authorization before spending parser work and again at commit.
        with self.lock:
            self._publisher(identity)
            self._live(rid)
        jpeg = sanitize_jpeg(raw)
        with self.lock:
            self._publisher(identity)
            record = self._live(rid)
            ticket = record["pending"]
            if (not ticket or ticket["claims"]["exp"] <= self.wall()
                    or not isinstance(nonce, str) or not secrets.compare_digest(nonce, ticket["claims"]["nonce"])
                    or type(sequence) is not int or sequence != record["sequence"] + 1):
                raise RelayError(409, "FRAME_REPLAY_OR_EXPIRED")
            if record["lastUpload"] is not None and self.clock() - record["lastUpload"] < 0.25:
                raise RelayError(429, "FRAME_RATE")
            record.update(jpeg=jpeg, frameAt=self.clock(), lastUpload=self.clock(), sequence=sequence, pending=None)
            return {"accepted": True, "cursor": sequence}

    def revoke(self, *, company=None, viewer=None):
        """Trusted lifecycle hook; never expose as a caller-selected public endpoint."""
        with self.lock:
            for rid, record in list(self.records.items()):
                if ((company is None or record["binding"]["companyId"] == company)
                        and (viewer is None or record["binding"]["viewerId"] == viewer)):
                    self._drop(rid)

    def sweep(self):
        with self.lock:
            self._prune()
            for rid in list(self.records):
                try:
                    self._live(rid)
                except RelayError:
                    pass
