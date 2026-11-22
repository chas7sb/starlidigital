"""Acceptance and security tests for company-owned SMTP integration."""

import asyncio
import base64
from datetime import datetime, timedelta, timezone
from email import policy
from email.parser import BytesParser
import ipaddress
import json
import socket
import sqlite3
import ssl
import threading
import time
from types import SimpleNamespace
import uuid

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID
from fastapi import Depends, FastAPI, Request
from fastapi.testclient import TestClient
import pytest

from company_messaging.authority import Member, Session
from company_messaging.native_authority import NativeAuthority
from company_messaging.store import Store
from open_webui.company_authority.company_rbac import Authority as RbacAuthority
from starli_automations.common import Fault
from starli_automations.connections import Vault
from starli_company_tools.core import BoundCall, CompanyTools, ToolFault
from starli_engine_connections.smtp import (
    CompanySmtpService,
    SmtpContext,
    SmtpFault,
    SmtpNetworkClient,
    clean_host,
    html_to_text,
    resolve_public_smtp,
    sanitize_html_body,
)
from starli_engine_connections.smtp_http import install as install_smtp_http


def _make_cert_bundle(tmp_path):
    """Generate a test CA plus a valid leaf cert and a mismatched-SAN leaf cert."""
    ca_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    now = datetime.now(timezone.utc)
    ca_name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Starli Test CA")])
    ca_cert = (
        x509.CertificateBuilder()
        .subject_name(ca_name)
        .issuer_name(ca_name)
        .public_key(ca_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(days=1))
        .not_valid_after(now + timedelta(days=2))
        .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
        .sign(ca_key, hashes.SHA256())
    )
    ca_path = tmp_path / "ca.pem"
    ca_path.write_bytes(ca_cert.public_bytes(serialization.Encoding.PEM))

    def issue_leaf(san_dns: str, prefix: str):
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, san_dns)])
        cert = (
            x509.CertificateBuilder()
            .subject_name(name)
            .issuer_name(ca_name)
            .public_key(key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(now - timedelta(days=1))
            .not_valid_after(now + timedelta(days=2))
            .add_extension(x509.SubjectAlternativeName([x509.DNSName(san_dns)]), critical=False)
            .sign(ca_key, hashes.SHA256())
        )
        cert_file = tmp_path / f"{prefix}.crt.pem"
        key_file = tmp_path / f"{prefix}.key.pem"
        cert_file.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
        key_file.write_bytes(
            key.private_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PrivateFormat.TraditionalOpenSSL,
                encryption_algorithm=serialization.NoEncryption(),
            )
        )
        return str(cert_file), str(key_file)

    valid_cert, valid_key = issue_leaf("smtp.valid-test.example", "valid")
    bad_cert, bad_key = issue_leaf("evil.wrong.example", "wrong")
    return {
        "ca": str(ca_path),
        "valid": (valid_cert, valid_key),
        "wrong": (bad_cert, bad_key),
    }


class EphemeralSmtpServer:
    """Real TLS / STARTTLS SMTP socket fixture recording envelope, MIME headers, and commands."""

    def __init__(
        self,
        cert_file: str,
        key_file: str,
        *,
        implicit_tls: bool,
        advertise_starttls: bool = True,
        expected_user: str = "smtp-user",
        expected_pass: str = "SuperSecret!99",
    ):
        self.implicit_tls = implicit_tls
        self.advertise_starttls = advertise_starttls
        self.expected_user = expected_user
        self.expected_pass = expected_pass
        self.drop_after_data = False
        self.refuse_data = False
        self.auth_count = 0
        self.mail_from_count = 0
        self.data_count = 0
        self.received: list[dict] = []

        self._ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        self._ctx.minimum_version = ssl.TLSVersion.TLSv1_2
        self._ctx.load_cert_chain(certfile=cert_file, keyfile=key_file)

        self._sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self._sock.bind(("127.0.0.1", 0))
        self._sock.listen(16)
        self._sock.settimeout(0.2)
        self.port = int(self._sock.getsockname()[1])
        self._stop = False
        self._thread = threading.Thread(target=self._serve, daemon=True)
        self._thread.start()

    def _serve(self):
        while not self._stop:
            try:
                conn, _ = self._sock.accept()
            except socket.timeout:
                continue
            except OSError:
                break
            threading.Thread(target=self._handle_conn, args=(conn,), daemon=True).start()

    @staticmethod
    def _readline(sock) -> str | None:
        buf = bytearray()
        while True:
            chunk = sock.recv(1)
            if not chunk:
                return None if not buf else buf.decode("utf-8", errors="replace")
            buf.extend(chunk)
            if buf.endswith(b"\n"):
                return buf.decode("utf-8", errors="replace").rstrip("\r\n")

    def _handle_conn(self, raw_sock: socket.socket):
        sock: socket.socket | ssl.SSLSocket = raw_sock
        sock.settimeout(3.0)
        try:
            if self.implicit_tls:
                sock = self._ctx.wrap_socket(sock, server_side=True)
            sock.sendall(b"220 smtp.valid-test.example ESMTP Ready\r\n")
            mail_from = None
            rcpt_tos: list[str] = []
            authed = False
            while not self._stop:
                line = self._readline(sock)
                if line is None:
                    break
                upper = line.upper()
                if upper.startswith("EHLO ") or upper.startswith("HELO "):
                    caps = ["250-smtp.valid-test.example", "250-AUTH PLAIN LOGIN"]
                    if not self.implicit_tls and self.advertise_starttls and not isinstance(sock, ssl.SSLSocket):
                        caps.insert(1, "250-STARTTLS")
                    caps[-1] = caps[-1].replace("250-", "250 ", 1)
                    sock.sendall(("\r\n".join(caps) + "\r\n").encode("ascii"))
                elif upper == "STARTTLS":
                    if not self.advertise_starttls:
                        sock.sendall(b"502 Command not implemented\r\n")
                        continue
                    sock.sendall(b"220 Ready to start TLS\r\n")
                    sock = self._ctx.wrap_socket(sock, server_side=True)
                elif upper.startswith("AUTH PLAIN"):
                    parts = line.split(" ", 2)
                    if len(parts) == 3:
                        raw_b64 = parts[2]
                    else:
                        sock.sendall(b"334 \r\n")
                        raw_b64 = self._readline(sock) or ""
                    decoded = base64.b64decode(raw_b64).split(b"\x00")
                    user = decoded[-2].decode("utf-8") if len(decoded) >= 2 else ""
                    pw = decoded[-1].decode("utf-8") if len(decoded) >= 1 else ""
                    if user == self.expected_user and pw == self.expected_pass:
                        self.auth_count += 1
                        authed = True
                        sock.sendall(b"235 2.7.0 Authentication successful\r\n")
                    else:
                        sock.sendall(b"535 5.7.8 Authentication credentials invalid\r\n")
                elif upper.startswith("AUTH LOGIN"):
                    sock.sendall(b"334 VXNlcm5hbWU6\r\n")
                    u_b64 = self._readline(sock) or ""
                    sock.sendall(b"334 UGFzc3dvcmQ6\r\n")
                    p_b64 = self._readline(sock) or ""
                    user = base64.b64decode(u_b64).decode("utf-8")
                    pw = base64.b64decode(p_b64).decode("utf-8")
                    if user == self.expected_user and pw == self.expected_pass:
                        self.auth_count += 1
                        authed = True
                        sock.sendall(b"235 2.7.0 Authentication successful\r\n")
                    else:
                        sock.sendall(b"535 5.7.8 Authentication credentials invalid\r\n")
                elif upper == "NOOP":
                    sock.sendall(b"250 2.0.0 OK\r\n")
                elif upper.startswith("MAIL FROM:"):
                    if not authed:
                        sock.sendall(b"530 5.7.0 Authentication required\r\n")
                        continue
                    self.mail_from_count += 1
                    mail_from = line.split(":", 1)[1].strip()
                    rcpt_tos = []
                    sock.sendall(b"250 2.1.0 OK\r\n")
                elif upper.startswith("RCPT TO:"):
                    rcpt_tos.append(line.split(":", 1)[1].strip())
                    sock.sendall(b"250 2.1.5 OK\r\n")
                elif upper == "DATA":
                    self.data_count += 1
                    sock.sendall(b"354 End data with <CR><LF>.<CR><LF>\r\n")
                    data_buf = bytearray()
                    while True:
                        chunk = sock.recv(4096)
                        if not chunk:
                            break
                        data_buf.extend(chunk)
                        if b"\r\n.\r\n" in data_buf:
                            break
                    if self.drop_after_data:
                        break
                    if self.refuse_data:
                        sock.sendall(b"550 5.7.1 Message rejected\r\n")
                        continue
                    raw_msg = bytes(data_buf).split(b"\r\n.\r\n", 1)[0]
                    # Un-dotstuff RFC 5321
                    raw_msg = raw_msg.replace(b"\r\n..", b"\r\n.")
                    parsed = BytesParser(policy=policy.default).parsebytes(raw_msg)
                    self.received.append(
                        {
                            "mail_from": mail_from,
                            "rcpt_tos": rcpt_tos,
                            "raw": raw_msg,
                            "parsed": parsed,
                        }
                    )
                    sock.sendall(b"250 2.0.0 Ok: queued\r\n")
                elif upper == "QUIT":
                    sock.sendall(b"221 2.0.0 Bye\r\n")
                    break
                else:
                    sock.sendall(b"250 OK\r\n")
        except Exception:
            pass
        finally:
            try:
                sock.close()
            except OSError:
                pass

    def close(self):
        self._stop = True
        try:
            self._sock.close()
        except OSError:
            pass
        self._thread.join(timeout=1.0)


def _build_env(tmp_path, certs, *, server_port_map: dict[int, int]):
    db_path = tmp_path / "webui.db"
    now_us = int(time.time() * 1_000_000)
    with sqlite3.connect(db_path) as raw:
        raw.executescript(
            """
            CREATE TABLE IF NOT EXISTS channel(
                id TEXT PRIMARY KEY,
                name TEXT,
                type TEXT,
                data TEXT,
                created_at INTEGER,
                updated_at INTEGER
            );
            CREATE TABLE IF NOT EXISTS message(
                id TEXT PRIMARY KEY,
                channel_id TEXT,
                user_id TEXT,
                content TEXT,
                data TEXT,
                meta TEXT,
                parent_id TEXT,
                created_at INTEGER,
                updated_at INTEGER
            );
            """
        )
    rbac = RbacAuthority(str(db_path))
    with rbac.db:
        rbac.db.executescript(
            """
            CREATE TABLE IF NOT EXISTS bots(
                id TEXT PRIMARY KEY,
                kind TEXT NOT NULL,
                owner TEXT NOT NULL,
                revision INTEGER NOT NULL,
                active INTEGER NOT NULL
            );
            """
        )
        # Company A: admin-a (owner), member-a (basic member without integrations.run), bot-a (company bot with integrations.run + bots.run + tools.dispatch + messages.send)
        rbac.db.execute("INSERT INTO companies VALUES('comp-a','Company A')")
        rbac.db.execute("INSERT INTO members VALUES('comp-a','admin-a','owner',1,1,'Admin A','person')")
        rbac.db.execute("INSERT INTO members VALUES('comp-a','member-a','member',1,1,'Member A','person')")
        rbac.db.execute("INSERT INTO members VALUES('comp-a','bot-a','member',1,1,'Bot A','bot')")
        rbac.db.execute("INSERT INTO bots VALUES('bot-a','company','comp-a',1,1)")
        rbac.db.execute(
            "INSERT INTO custom_roles VALUES('role-bot-a','comp-a','SmtpBot','bot',?,1)",
            (json.dumps(["bots.run", "integrations.run", "messages.send", "tools.dispatch"]),),
        )
        rbac.db.execute("INSERT INTO role_assignments VALUES('comp-a','bot-a','role-bot-a')")

        # Company B: admin-b (owner), bot-b
        rbac.db.execute("INSERT INTO companies VALUES('comp-b','Company B')")
        rbac.db.execute("INSERT INTO members VALUES('comp-b','admin-b','owner',1,1,'Admin B','person')")
        rbac.db.execute("INSERT INTO members VALUES('comp-b','bot-b','member',1,1,'Bot B','bot')")
        rbac.db.execute("INSERT INTO bots VALUES('bot-b','company','comp-b',1,1)")
        rbac.db.execute(
            "INSERT INTO custom_roles VALUES('role-bot-b','comp-b','SmtpBotB','bot',?,1)",
            (json.dumps(["bots.run", "integrations.run", "messages.send", "tools.dispatch"]),),
        )
        rbac.db.execute("INSERT INTO role_assignments VALUES('comp-b','bot-b','role-bot-b')")

    sessions_active = {"admin-a": True, "member-a": True, "admin-b": True}
    runs_revoked = set()

    def _auth_check(sess):
        return bool(sess and getattr(sess, "kind", None) == "jwt" and sessions_active.get(sess.user_id, False))

    def _run_check(_db, scope):
        return scope.run_id not in runs_revoked

    # Provide lightweight NativeAuthority compatible with Store.db bind_connection
    class BoundAuthority(NativeAuthority):
        def bind_connection(self, conn):
            class Ctx:
                def __enter__(_s):
                    self._bound_db = conn
                    return conn
                def __exit__(_s, *exc):
                    self._bound_db = None
            return Ctx()

        def connection(self):
            return getattr(self, "_bound_db", rbac.db)

        def require_member(self, user_id, company_id, expected_revision=None):
            conn = self.connection()
            row = conn.execute(
                "SELECT company_id,user_id,revision,active,kind,role FROM members WHERE company_id=? AND user_id=?",
                (company_id, user_id),
            ).fetchone()
            if not row or not row[3]:
                from company_messaging.authority import Denied
                raise Denied(403, "MEMBERSHIP_REVOKED")
            return Member(company_id, user_id, f"m:{company_id}:{user_id}", 1, int(row[2]))

        def require_agent(self, member, agent_id):
            return {"id": agent_id, "companyId": member.company_id}

    nat_auth = BoundAuthority(
        _auth_check,
        lambda *a: None,
        lambda *a: None,
        lambda *a: True,
        lambda *a: True,
        _run_check,
    )
    store = Store(db_path, nat_auth)

    def permission(ctx, db, capability):
        row = db.execute(
            "SELECT role,active,revision,kind FROM members WHERE company_id=? AND user_id=?",
            (ctx.company, ctx.actor),
        ).fetchone()
        if not row or not row[1]:
            raise SmtpFault("MEMBERSHIP_REVOKED", 403)
        r_auth = object.__new__(RbacAuthority)
        r_auth.db = db
        try:
            scope = r_auth.require_member(ctx.actor, ctx.company, permission=capability)
        except Exception as exc:
            raise SmtpFault("COMPANY_PERMISSION_DENIED", 403) from exc
        if ctx.bot:
            try:
                r_auth.require_member(ctx.actor, ctx.company, permission="bots.run")
                r_auth.require_member(ctx.bot, ctx.company, permission="bots.run")
                r_auth.require_member(ctx.bot, ctx.company, permission=capability)
                r_auth.require_member(ctx.bot, ctx.company, permission="tools.dispatch")
            except Exception as exc:
                raise SmtpFault("COMPANY_PERMISSION_DENIED", 403) from exc
        if ctx.native_scope is not None and ctx.native_scope.run_id in runs_revoked:
            raise SmtpFault("NATIVE_AUTOMATION_RUN_REVOKED", 403)
        return scope

    with store.db() as db:
        db.execute("INSERT INTO channel VALUES('room-a','General','group','{}',?,?)", (now_us, now_us))
        db.execute(
            "INSERT INTO cm_rooms VALUES('room-a','comp-a','group','private','admin-a','m:comp-a:admin-a:1',1,1,0,NULL)"
        )
        db.execute("INSERT INTO cm_members VALUES('room-a','admin-a','m:comp-a:admin-a:1',1)")
        db.execute("INSERT INTO cm_members VALUES('room-a','member-a','m:comp-a:member-a:1',1)")
        db.execute("INSERT INTO cm_agents VALUES('room-a','bot-a')")

        # Assistant origin message containing pre-existing data key (must be preserved by card projection!)
        db.execute(
            "INSERT INTO message VALUES('msg-a-1','room-a','bot-a','Preparing email...',?,?,NULL,?,?)",
            (json.dumps({"existingCard": {"keep": True}}), json.dumps({"attribution": {"requestedBy": "admin-a"}}), now_us, now_us),
        )
        db.execute("INSERT INTO cm_messages VALUES('msg-a-1','room-a',1,'agent','bot-a',1,0,'[]','[]','run-1')")

        # Company B room
        db.execute("INSERT INTO channel VALUES('room-b','B Room','group','{}',?,?)", (now_us, now_us))
        db.execute(
            "INSERT INTO cm_rooms VALUES('room-b','comp-b','group','private','admin-b','m:comp-b:admin-b:1',1,1,0,NULL)"
        )
        db.execute("INSERT INTO cm_members VALUES('room-b','admin-b','m:comp-b:admin-b:1',1)")
        db.execute("INSERT INTO cm_agents VALUES('room-b','bot-b')")

    fake_clock = [1_750_000_000.0]

    def test_resolver(host: str, port: int):
        # Validate SSRF rules cleanly first; only rewrite logical valid-test.example domain to loopback listener port
        clean = clean_host(host)
        if port in server_port_map and clean == "smtp.valid-test.example":
            return "127.0.0.1", server_port_map[port]
        return resolve_public_smtp(host, port)

    def test_ssl_ctx():
        ctx = ssl.create_default_context(cafile=certs["ca"])
        ctx.check_hostname = True
        ctx.verify_mode = ssl.CERT_REQUIRED
        ctx.minimum_version = ssl.TLSVersion.TLSv1_2
        return ctx

    vault = Vault(b"\x11" * 32)
    network = SmtpNetworkClient(resolver=test_resolver, ssl_context_factory=test_ssl_ctx, timeout=3.0)
    service = CompanySmtpService(store, permission, vault, network=network, clock=lambda: fake_clock[0])

    # Wire real FastAPI + CompanyTools runtime shim
    tools_registry = CompanyTools()
    runtime = SimpleNamespace(
        store=store,
        authority=rbac,
        company_tools=tools_registry,
        authorize_run=lambda s, c, b, r, run_id: run_id not in runs_revoked,
    )

    app = FastAPI()

    def session_dep(request: Request):
        auth = request.headers.get("authorization", "")
        if not auth.startswith("Bearer "):
            raise SmtpFault("NATIVE_JWT_REQUIRED", 401)
        uid = auth[7:].strip()
        if uid not in sessions_active:
            raise SmtpFault("NATIVE_JWT_REQUIRED", 401)
        return Session(uid, f"hash:{uid}", time.time() + 3600, "jwt")

    app.state.company_messaging_session = session_dep
    install_smtp_http(app, runtime, service)

    return {
        "app": app,
        "client": TestClient(app),
        "store": store,
        "vault": vault,
        "service": service,
        "runtime": runtime,
        "clock": fake_clock,
        "admin_a_sess": Session("admin-a", "h-aa", time.time() + 3600, "jwt"),
        "member_a_sess": Session("member-a", "h-ma", time.time() + 3600, "jwt"),
        "admin_b_sess": Session("admin-b", "h-ab", time.time() + 3600, "jwt"),
    }


def _make_bound(env, *, company="comp-a", room="room-a", bot="bot-a", actor="admin-a", sess_key="admin_a_sess", call_id="call-1"):
    ctx = SimpleNamespace(company_id=company, room_id=room, bot_id=bot, actor_id=actor)
    ns = SimpleNamespace(assistant_message_id="msg-a-1", run_id="run-1", call_id=call_id)
    return BoundCall(env["runtime"], env[sess_key], ctx, {}, "run-1", call_id, "msg-a-1", ns)


def test_vault_encryption_cross_company_and_secret_redaction(tmp_path):
    certs = _make_cert_bundle(tmp_path)
    srv = EphemeralSmtpServer(*certs["valid"], implicit_tls=True)
    try:
        env = _build_env(tmp_path, certs, server_port_map={465: srv.port})
        svc = env["service"]
        ctx_a = svc.context(env["admin_a_sess"], "comp-a")
        created = svc.create_connection(
            ctx_a,
            {
                "name": "Primary SMTP",
                "host": "smtp.valid-test.example",
                "port": 465,
                "tlsMode": "implicit_tls",
                "username": "smtp-user",
                "password": "SuperSecret!99",
                "senderEmail": "noreply@starlidigital.ro",
                "senderName": "Starli Digital",
            },
        )
        conn = created["connection"]
        assert "password" not in conn
        assert "SuperSecret!99" not in json.dumps(created)
        assert conn["passwordConfigured"] is True

        # Check ciphertext on disk and strict AAD binding (company + conn + rev)
        with env["store"].db(readonly=True) as db:
            row = db.execute("SELECT secret FROM cs_smtp_connections WHERE id=?", (conn["id"],)).fetchone()
            assert b"SuperSecret!99" not in bytes(row["secret"])
            with pytest.raises(Fault):
                env["vault"].open("comp-b", f"smtp:{conn['id']}:1", bytes(row["secret"]))
            with pytest.raises(Fault):
                env["vault"].open("comp-a", f"smtp:{conn['id']}:2", bytes(row["secret"]))

        # Bot listing must redact password AND username
        bot_ctx_a = svc.context(env["admin_a_sess"], "comp-a", room="room-a", bot="bot-a")
        bot_list = svc.list_bot_connections(bot_ctx_a)
        serialized_bot = json.dumps(bot_list)
        assert "SuperSecret!99" not in serialized_bot
        assert "smtp-user" not in serialized_bot
        assert len(bot_list["connections"]) == 1

        # Company B admin & bot cannot access Company A connection, test, revoke, or receipts
        ctx_b = svc.context(env["admin_b_sess"], "comp-b")
        bot_ctx_b = svc.context(env["admin_b_sess"], "comp-b", room="room-b", bot="bot-b")
        assert svc.list_admin_connections(ctx_b)["connections"] == []
        assert svc.list_bot_connections(bot_ctx_b)["connections"] == []
        with pytest.raises(SmtpFault) as exc_test:
            asyncio.run(svc.test_connection(ctx_b, conn["id"]))
        assert exc_test.value.status == 404
        with pytest.raises(SmtpFault) as exc_rev:
            svc.revoke_connection(ctx_b, conn["id"], 1)
        assert exc_rev.value.status == 404
        with pytest.raises(SmtpFault) as exc_draft:
            svc.prepare_draft(
                bot_ctx_b,
                {"connectionId": conn["id"], "to": ["x@example.com"], "subject": "Steal", "textBody": "Hi"},
                "rk-b-1",
            )
        assert exc_draft.value.status == 404

        # Non-admin member in Company A cannot list/create admin SMTP credentials
        client = env["client"]
        r_mem = client.get(
            "/api/v1/starli/companies/comp-a/integrations/smtp/connections",
            headers={"Authorization": "Bearer member-a"},
        )
        assert r_mem.status_code == 403
    finally:
        srv.close()


def test_port_tls_policy_ssrf_and_invalid_certificate_rejected(tmp_path, monkeypatch):
    certs = _make_cert_bundle(tmp_path)
    wrong_srv = EphemeralSmtpServer(*certs["wrong"], implicit_tls=True)
    plain_587 = EphemeralSmtpServer(*certs["valid"], implicit_tls=False, advertise_starttls=False)
    try:
        env = _build_env(tmp_path, certs, server_port_map={465: wrong_srv.port, 587: plain_587.port})
        svc = env["service"]
        ctx_a = svc.context(env["admin_a_sess"], "comp-a")

        # Port & TLS mismatch policies rejected
        bad_policies = [
            (25, "none"),
            (25, "implicit_tls"),
            (2525, "required_starttls"),
            (465, "required_starttls"),
            (587, "implicit_tls"),
            (587, "none"),
        ]
        for port, mode in bad_policies:
            with pytest.raises(SmtpFault) as err:
                svc.create_connection(
                    ctx_a,
                    {
                        "name": "Bad TLS",
                        "host": "smtp.valid-test.example",
                        "port": port,
                        "tlsMode": mode,
                        "username": "u",
                        "password": "p",
                        "senderEmail": "noreply@starlidigital.ro",
                    },
                )
            assert err.value.code == "SMTP_TLS_POLICY_DENIED"

        # Private/internal IP literals & domains rejected
        for bad_host in [
            "127.0.0.1",
            "10.0.0.5",
            "169.254.169.254",
            "172.16.4.2",
            "192.168.1.10",
            "100.64.0.1",
            "::1",
            "[::1]",
            "::ffff:127.0.0.1",
            "fc00::1",
            "localhost",
            "mail.local",
            "smtp.internal",
            "relay.localdomain",
        ]:
            with pytest.raises(SmtpFault) as err:
                svc.create_connection(
                    ctx_a,
                    {
                        "name": "SSRF",
                        "host": bad_host,
                        "port": 465,
                        "tlsMode": "implicit_tls",
                        "username": "u",
                        "password": "p",
                        "senderEmail": "noreply@starlidigital.ro",
                    },
                )
            assert err.value.code == "PRIVATE_DESTINATION_DENIED"

        # Dynamic DNS resolution returning a private IP or mixed public+private fails closed
        monkeypatch.setattr(
            socket,
            "getaddrinfo",
            lambda *a, **k: [
                (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 465)),
                (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("169.254.169.254", 465)),
            ],
        )
        with pytest.raises(SmtpFault) as dns_err:
            resolve_public_smtp("rebind.attacker.example", 465)
        assert dns_err.value.code == "PRIVATE_DESTINATION_DENIED"
        monkeypatch.undo()

        # Invalid/mismatched TLS certificate fails closed on port 465
        c_wrong = svc.create_connection(
            ctx_a,
            {
                "name": "Wrong Cert",
                "host": "smtp.valid-test.example",
                "port": 465,
                "tlsMode": "implicit_tls",
                "username": "smtp-user",
                "password": "SuperSecret!99",
                "senderEmail": "noreply@starlidigital.ro",
            },
        )["connection"]
        with pytest.raises(SmtpFault) as cert_err:
            asyncio.run(svc.test_connection(ctx_a, c_wrong["id"]))
        assert cert_err.value.code == "TLS_CERTIFICATE_INVALID"
        assert wrong_srv.auth_count == 0

        # Port 587 without STARTTLS refuses plaintext fallback before AUTH
        c_plain = svc.create_connection(
            ctx_a,
            {
                "name": "No STARTTLS",
                "host": "smtp.valid-test.example",
                "port": 587,
                "tlsMode": "required_starttls",
                "username": "smtp-user",
                "password": "SuperSecret!99",
                "senderEmail": "noreply@starlidigital.ro",
            },
        )["connection"]
        with pytest.raises(SmtpFault) as stls_err:
            asyncio.run(svc.test_connection(ctx_a, c_plain["id"]))
        assert stls_err.value.code == "SMTP_STARTTLS_REQUIRED"
        assert plain_587.auth_count == 0 and plain_587.mail_from_count == 0
    finally:
        wrong_srv.close()
        plain_587.close()


def test_connection_never_sends_mail_implicit_tls_and_starttls(tmp_path):
    certs = _make_cert_bundle(tmp_path)
    srv_465 = EphemeralSmtpServer(*certs["valid"], implicit_tls=True)
    srv_587 = EphemeralSmtpServer(*certs["valid"], implicit_tls=False, advertise_starttls=True)
    try:
        env = _build_env(tmp_path, certs, server_port_map={465: srv_465.port, 587: srv_587.port})
        svc = env["service"]
        ctx_a = svc.context(env["admin_a_sess"], "comp-a")

        c465 = svc.create_connection(
            ctx_a,
            {
                "name": "Implicit TLS 465",
                "host": "smtp.valid-test.example",
                "port": 465,
                "tlsMode": "implicit_tls",
                "username": "smtp-user",
                "password": "SuperSecret!99",
                "senderEmail": "noreply@starlidigital.ro",
                "senderName": "Starli 465",
            },
        )["connection"]
        res465 = asyncio.run(svc.test_connection(ctx_a, c465["id"]))
        assert res465["test"]["tested"] is True
        assert res465["test"]["messageSent"] is False
        assert res465["connection"]["lastTestStatus"] == "PASSED"
        assert srv_465.auth_count == 1
        assert srv_465.mail_from_count == 0 and srv_465.data_count == 0 and srv_465.received == []

        c587 = svc.create_connection(
            ctx_a,
            {
                "name": "STARTTLS 587",
                "host": "smtp.valid-test.example",
                "port": 587,
                "tlsMode": "required_starttls",
                "username": "smtp-user",
                "password": "SuperSecret!99",
                "senderEmail": "noreply@starlidigital.ro",
            },
        )["connection"]
        res587 = asyncio.run(svc.test_connection(ctx_a, c587["id"]))
        assert res587["test"]["tested"] is True
        assert res587["test"]["messageSent"] is False
        assert srv_587.auth_count == 1
        assert srv_587.mail_from_count == 0 and srv_587.data_count == 0 and srv_587.received == []
    finally:
        srv_465.close()
        srv_587.close()


def test_approved_email_sends_via_real_tls_with_bcc_and_html_sanitization(tmp_path):
    certs = _make_cert_bundle(tmp_path)
    srv = EphemeralSmtpServer(*certs["valid"], implicit_tls=False, advertise_starttls=True)
    try:
        env = _build_env(tmp_path, certs, server_port_map={587: srv.port})
        svc = env["service"]
        tools = env["runtime"].company_tools
        ctx_a = svc.context(env["admin_a_sess"], "comp-a")

        conn = svc.create_connection(
            ctx_a,
            {
                "name": "Company Relay",
                "host": "smtp.valid-test.example",
                "port": 587,
                "tlsMode": "required_starttls",
                "username": "smtp-user",
                "password": "SuperSecret!99",
                "senderEmail": "support@starlidigital.ro",
                "senderName": "Starli Support",
            },
        )["connection"]

        # Execute tools exactly via CompanyTools
        listed = asyncio.run(tools.execute(_make_bound(env, call_id="c1"), "company_smtp_connections_list", {}))
        assert len(listed["connections"]) == 1

        dirty_html = (
            '<p onclick="alert(1)">Hello <strong>Team</strong></p>'
            '<script>fetch("http://evil.invalid")</script>'
            '<a href="javascript:alert(2)">Bad</a> '
            '<a href="https://starlidigital.ro/docs">Docs</a>'
        )
        prepared = asyncio.run(
            tools.execute(
                _make_bound(env, call_id="c2"),
                "company_smtp_draft_prepare",
                {
                    "connectionId": conn["id"],
                    "to": ["to@example.com"],
                    "cc": ["cc@example.com"],
                    "bcc": ["secret-bcc@example.com"],
                    "subject": "Weekly Report",
                    "htmlBody": dirty_html,
                },
            )
        )
        draft = prepared["draft"]
        assert "<script" not in draft["htmlBody"]
        assert "onclick" not in draft["htmlBody"]
        assert "javascript:" not in draft["htmlBody"]
        assert 'href="https://starlidigital.ro/docs"' in draft["htmlBody"]
        assert draft["textBody"]  # auto plain text derived cleanly from HTML

        requested = asyncio.run(
            tools.execute(
                _make_bound(env, call_id="c3"),
                "company_smtp_approval_request",
                {"draftId": draft["id"], "expectedRevision": draft["revision"], "note": "Please approve"},
            )
        )
        approval = requested["approval"]
        assert approval["state"] == "PENDING"

        # Card projected onto Store.message_dto preserving existing data key
        with env["store"].db(readonly=True) as db:
            projected = env["store"].message_dto(db, "room-a", "msg-a-1")
            assert projected["data"]["starliSmtpApproval"]["approvalId"] == approval["id"]

        # Human reviews & approves over HTTP
        client = env["client"]
        headers = {"Authorization": "Bearer admin-a", "Origin": "https://starlidigital.ro"}
        dec = client.post(
            f"/api/v1/starli/companies/comp-a/integrations/smtp/approvals/{approval['id']}/decision",
            headers=headers,
            json={"decision": "APPROVE", "expectedReviewHash": approval["reviewHash"], "sourceConversationId": "room-a"},
        )
        assert dec.status_code == 200
        assert dec.json()["approval"]["state"] == "APPROVED"

        # Bot executes single-flight send via native tool
        sent = asyncio.run(
            tools.execute(
                _make_bound(env, call_id="c4"),
                "company_smtp_send",
                {"approvalId": approval["id"], "idempotencyKey": "idem-approved-1"},
            )
        )
        assert sent["ok"] is True
        assert sent["smtpAccepted"] is True
        assert sent["deliveryVerified"] is False
        assert sent["receipt"]["status"] == "SMTP_ACCEPTED"
        assert sent["receipt"]["tlsProtocol"].startswith("TLSv1.")

        # Repeat with exact same idempotencyKey -> no duplicate send
        replay = asyncio.run(
            tools.execute(
                _make_bound(env, call_id="c5"),
                "company_smtp_send",
                {"approvalId": approval["id"], "idempotencyKey": "idem-approved-1"},
            )
        )
        assert replay["ok"] is True and replay["idempotentReplay"] is True

        # Inspect real received email bytes
        assert len(srv.received) == 1
        rec = srv.received[0]
        assert rec["mail_from"] == "<support@starlidigital.ro>"
        assert rec["rcpt_tos"] == ["<to@example.com>", "<cc@example.com>", "<secret-bcc@example.com>"]
        parsed = rec["parsed"]
        assert parsed["Bcc"] is None
        assert "secret-bcc@example.com" not in parsed.as_string()
        assert parsed["Subject"] == "Weekly Report"
        assert "to@example.com" in parsed["To"]
        assert "cc@example.com" in parsed["Cc"]
        body_html = parsed.get_body(preferencelist=("html",)).get_content()
        assert "<script" not in body_html and "javascript:" not in body_html
        assert "<strong>Team</strong>" in body_html
    finally:
        srv.close()


def test_revoked_or_updated_connection_blocks_pending_and_approved_sends(tmp_path):
    certs = _make_cert_bundle(tmp_path)
    srv = EphemeralSmtpServer(*certs["valid"], implicit_tls=True)
    try:
        env = _build_env(tmp_path, certs, server_port_map={465: srv.port})
        svc = env["service"]
        ctx_a = svc.context(env["admin_a_sess"], "comp-a")
        bot_ctx = svc.context(env["admin_a_sess"], "comp-a", room="room-a", bot="bot-a")

        conn = svc.create_connection(
            ctx_a,
            {
                "name": "Revoke Test",
                "host": "smtp.valid-test.example",
                "port": 465,
                "tlsMode": "implicit_tls",
                "username": "smtp-user",
                "password": "SuperSecret!99",
                "senderEmail": "noreply@starlidigital.ro",
            },
        )["connection"]
        draft = svc.prepare_draft(
            bot_ctx,
            {"connectionId": conn["id"], "to": ["rcpt@example.com"], "subject": "Hi", "textBody": "Body"},
            "rk-rev-1",
        )["draft"]
        appr = svc.request_approval(bot_ctx, {"draftId": draft["id"]}, "rk-rev-appr-1")["approval"]
        svc.decide_approval(
            svc.context(env["admin_a_sess"], "comp-a"),
            appr["id"],
            {"decision": "APPROVE", "expectedReviewHash": appr["reviewHash"]},
        )

        # Revoke connection before send
        rev = svc.revoke_connection(ctx_a, conn["id"], conn["revision"])["connection"]
        assert rev["status"] == "REVOKED" and rev["passwordConfigured"] is False

        with pytest.raises(SmtpFault) as err:
            asyncio.run(svc.send_approved(bot_ctx, appr["id"], idempotency_key="send-after-revoke"))
        assert err.value.code == "SMTP_CONNECTION_REVOKED"
        assert srv.data_count == 0 and srv.received == []

        # Updating a connection bumps revision and invalidates prior pending approvals
        conn2 = svc.create_connection(
            ctx_a,
            {
                "name": "Update Rev Test",
                "host": "smtp.valid-test.example",
                "port": 465,
                "tlsMode": "implicit_tls",
                "username": "smtp-user",
                "password": "SuperSecret!99",
                "senderEmail": "noreply@starlidigital.ro",
            },
        )["connection"]
        d2 = svc.prepare_draft(bot_ctx, {"connectionId": conn2["id"], "to": ["rcpt@example.com"], "subject": "Hi2", "textBody": "Body2"}, "rk-upd-1")["draft"]
        a2 = svc.request_approval(bot_ctx, {"draftId": d2["id"]}, "rk-upd-a1")["approval"]
        updated = svc.update_connection(
            ctx_a,
            conn2["id"],
            {
                "expectedRevision": conn2["revision"],
                "name": "Updated Name",
                "host": "smtp.valid-test.example",
                "port": 465,
                "tlsMode": "implicit_tls",
                "username": "smtp-user",
                "senderEmail": "noreply@starlidigital.ro",
            },
        )["connection"]
        assert updated["revision"] == 2
        with pytest.raises(SmtpFault) as err_upd:
            asyncio.run(svc.send_approved(bot_ctx, a2["id"], idempotency_key="send-after-update"))
        assert err_upd.value.code == "SMTP_CONNECTION_REVOKED"
        assert srv.data_count == 0
    finally:
        srv.close()


def test_human_review_fence_rejected_expired_and_tampered_hash(tmp_path):
    certs = _make_cert_bundle(tmp_path)
    srv = EphemeralSmtpServer(*certs["valid"], implicit_tls=True)
    try:
        env = _build_env(tmp_path, certs, server_port_map={465: srv.port})
        svc = env["service"]
        ctx_a = svc.context(env["admin_a_sess"], "comp-a")
        bot_ctx = svc.context(env["admin_a_sess"], "comp-a", room="room-a", bot="bot-a")

        conn = svc.create_connection(
            ctx_a,
            {
                "name": "Review Gates",
                "host": "smtp.valid-test.example",
                "port": 465,
                "tlsMode": "implicit_tls",
                "username": "smtp-user",
                "password": "SuperSecret!99",
                "senderEmail": "noreply@starlidigital.ro",
            },
        )["connection"]

        # 1) Rejected approval sends nothing & bot cannot approve
        d1 = svc.prepare_draft(bot_ctx, {"connectionId": conn["id"], "to": ["a@example.com"], "subject": "S1", "textBody": "B1"}, "rk-rej-d")["draft"]
        a1 = svc.request_approval(bot_ctx, {"draftId": d1["id"]}, "rk-rej-a")["approval"]
        with pytest.raises(SmtpFault) as bot_dec_err:
            svc.decide_approval(bot_ctx, a1["id"], {"decision": "APPROVE", "expectedReviewHash": a1["reviewHash"]})
        assert bot_dec_err.value.code == "SMTP_HUMAN_REVIEW_REQUIRED"

        with pytest.raises(SmtpFault) as hash_err:
            svc.decide_approval(ctx_a, a1["id"], {"decision": "APPROVE", "expectedReviewHash": "0" * 64})
        assert hash_err.value.code == "SMTP_REVIEW_CHANGED"

        rej = svc.decide_approval(ctx_a, a1["id"], {"decision": "REJECT", "expectedReviewHash": a1["reviewHash"], "note": "Do not send"})["approval"]
        assert rej["state"] == "REJECTED"
        with pytest.raises(SmtpFault) as rej_send_err:
            asyncio.run(svc.send_approved(bot_ctx, a1["id"], idempotency_key="send-rej"))
        assert rej_send_err.value.code == "SMTP_APPROVAL_REJECTED"

        # Verify tool returns blocked response (sent=False) and sends nothing
        tool_rej = asyncio.run(
            env["runtime"].company_tools.execute(
                _make_bound(env, call_id="c-rej"),
                "company_smtp_send",
                {"approvalId": a1["id"], "idempotencyKey": "send-rej-tool"},
            )
        )
        assert tool_rej["ok"] is False and tool_rej["sent"] is False and tool_rej["errorCode"] == "SMTP_APPROVAL_REJECTED"

        # 2) Expired approval sends nothing
        d2 = svc.prepare_draft(bot_ctx, {"connectionId": conn["id"], "to": ["b@example.com"], "subject": "S2", "textBody": "B2"}, "rk-exp-d")["draft"]
        a2 = svc.request_approval(bot_ctx, {"draftId": d2["id"]}, "rk-exp-a")["approval"]
        svc.decide_approval(ctx_a, a2["id"], {"decision": "APPROVE", "expectedReviewHash": a2["reviewHash"]})
        env["clock"][0] += 901.0
        with pytest.raises(SmtpFault) as exp_err:
            asyncio.run(svc.send_approved(bot_ctx, a2["id"], idempotency_key="send-exp"))
        assert exp_err.value.code == "SMTP_APPROVAL_EXPIRED"
        assert svc.send_status(bot_ctx, a2["id"])["approval"]["state"] == "EXPIRED"
        assert srv.data_count == 0 and srv.received == []
    finally:
        srv.close()


def test_uncertain_send_never_retries_even_across_restart(tmp_path):
    certs = _make_cert_bundle(tmp_path)
    srv = EphemeralSmtpServer(*certs["valid"], implicit_tls=True)
    srv.drop_after_data = True
    try:
        env = _build_env(tmp_path, certs, server_port_map={465: srv.port})
        svc = env["service"]
        ctx_a = svc.context(env["admin_a_sess"], "comp-a")
        bot_ctx = svc.context(env["admin_a_sess"], "comp-a", room="room-a", bot="bot-a")

        conn = svc.create_connection(
            ctx_a,
            {
                "name": "Drop Relay",
                "host": "smtp.valid-test.example",
                "port": 465,
                "tlsMode": "implicit_tls",
                "username": "smtp-user",
                "password": "SuperSecret!99",
                "senderEmail": "noreply@starlidigital.ro",
            },
        )["connection"]
        draft = svc.prepare_draft(bot_ctx, {"connectionId": conn["id"], "to": ["c@example.com"], "subject": "Uncertain", "textBody": "Check"}, "rk-u-d")["draft"]
        appr = svc.request_approval(bot_ctx, {"draftId": draft["id"]}, "rk-u-a")["approval"]
        svc.decide_approval(ctx_a, appr["id"], {"decision": "APPROVE", "expectedReviewHash": appr["reviewHash"]})

        with pytest.raises(SmtpFault) as err1:
            asyncio.run(svc.send_approved(bot_ctx, appr["id"], idempotency_key="idem-u-1"))
        assert err1.value.code == "SMTP_SEND_UNCERTAIN"
        assert err1.value.receipt["status"] == "UNCERTAIN"
        assert err1.value.receipt["smtpAccepted"] is None
        assert err1.value.receipt["deliveryVerified"] is False
        assert srv.data_count == 1

        # Even if server recovers and caller uses SAME OR NEW idempotency key or tool, NEVER retry
        srv.drop_after_data = False
        for key in ("idem-u-1", "idem-u-new"):
            with pytest.raises(SmtpFault) as err2:
                asyncio.run(svc.send_approved(bot_ctx, appr["id"], idempotency_key=key))
            assert err2.value.code == "SMTP_SEND_UNCERTAIN_NO_RETRY"
        tool_retry = asyncio.run(
            env["runtime"].company_tools.execute(
                _make_bound(env, call_id="c-unc-retry"),
                "company_smtp_send",
                {"approvalId": appr["id"], "idempotencyKey": "idem-u-tool-retry"},
            )
        )
        assert tool_retry["ok"] is False and tool_retry["sent"] is False and tool_retry["errorCode"] == "SMTP_SEND_UNCERTAIN_NO_RETRY"
        assert srv.data_count == 1  # Strictly one DATA attempt total!

        # Simulate process restart during SENDING -> recover() turns SENDING into UNCERTAIN
        d2 = svc.prepare_draft(bot_ctx, {"connectionId": conn["id"], "to": ["d@example.com"], "subject": "Crash", "textBody": "Restart"}, "rk-crash-d")["draft"]
        a2 = svc.request_approval(bot_ctx, {"draftId": d2["id"]}, "rk-crash-a")["approval"]
        svc.decide_approval(ctx_a, a2["id"], {"decision": "APPROVE", "expectedReviewHash": a2["reviewHash"]})
        with env["store"].db() as db:
            db.execute(
                "INSERT INTO cs_smtp_sends VALUES('s-crash','comp-a',?,?,?,1,'room-a','bot-a','admin-a','admin-a',?,'idem-crash','SENDING',NULL,0,1,NULL,NULL,NULL,NULL,NULL,NULL,NULL,100.0,NULL)",
                (a2["id"], d2["id"], conn["id"], a2["reviewHash"]),
            )
            db.execute("UPDATE cs_smtp_approvals SET state='SENDING' WHERE id=?", (a2["id"],))
        svc.recover()
        st = svc.send_status(bot_ctx, a2["id"])
        assert st["approval"]["state"] == "UNCERTAIN"
        assert st["receipt"]["errorCode"] == "SMTP_INTERRUPTED_ON_RESTART"
        with pytest.raises(SmtpFault) as err3:
            asyncio.run(svc.send_approved(bot_ctx, a2["id"], idempotency_key="idem-crash-retry"))
        assert err3.value.code == "SMTP_SEND_UNCERTAIN_NO_RETRY"
    finally:
        srv.close()


def test_http_safe_route_guards_and_html_sanitizer(tmp_path):
    certs = _make_cert_bundle(tmp_path)
    srv = EphemeralSmtpServer(*certs["valid"], implicit_tls=True)
    try:
        env = _build_env(tmp_path, certs, server_port_map={465: srv.port})
        client = env["client"]

        assert client.get("/api/v1/starli/companies/comp-a/integrations/smtp/connections").status_code == 401
        r_cross = client.post(
            "/api/v1/starli/companies/comp-a/integrations/smtp/connections",
            headers={"Authorization": "Bearer admin-a", "Sec-Fetch-Site": "cross-site"},
            json={},
        )
        assert r_cross.status_code == 403
        assert r_cross.headers["cache-control"] == "no-store"

        r_origin = client.post(
            "/api/v1/starli/companies/comp-a/integrations/smtp/connections",
            headers={"Authorization": "Bearer admin-a", "Origin": "https://evil.example"},
            json={},
        )
        assert r_origin.status_code == 403

        r_dup = client.post(
            "/api/v1/starli/companies/comp-a/integrations/smtp/connections",
            headers={"Authorization": "Bearer admin-a", "Origin": "https://starlidigital.ro", "Content-Type": "application/json"},
            content=b'{"name":"a","name":"b"}',
        )
        assert r_dup.status_code == 422

        cleaned = sanitize_html_body('<p>Hi</p><iframe src="http://x">bad</iframe><img src=x onerror=alert(1)><a href="JaVaScRiPt:alert(1)">link</a>')
        assert "<iframe" not in cleaned and "<img" not in cleaned and "onerror" not in cleaned and "javascript:" not in cleaned.lower()
        assert html_to_text(cleaned).startswith("Hi")

        # Catalog advertises starli.company-smtp cleanly while leaving n8n emailSend NOT_EXECUTABLE
        from contextlib import contextmanager
        from starli_integration_catalog.native import install as install_catalog

        @contextmanager
        def gw_access(ctx, permission="read"):
            with env["store"].db(readonly=(permission == "read")) as db:
                yield db

        gw = SimpleNamespace(
            access=gw_access,
            context=lambda principal, company, room=None, bot=None, native_scope=None: env["service"].context(principal, company, room, bot, native_scope),
        )
        env["app"].state.starli_automations = gw
        cat_info = install_catalog(env["app"], env["runtime"])
        assert cat_info["metadataOnly"] is True

        r1 = client.get(
            "/api/v1/starli/companies/comp-a/automations/integrations/catalog",
            headers={"Authorization": "Bearer admin-a"},
        )
        assert r1.status_code == 200
        conns1 = {c["id"]: c for c in r1.json()["connectors"]}
        assert conns1["starli.company-smtp"]["executionStatus"] == "CONNECTION_REQUIRED"
        assert conns1["n8n-nodes-base.emailSend"]["executionStatus"] == "NOT_EXECUTABLE"

        ctx_a = env["service"].context(env["admin_a_sess"], "comp-a")
        env["service"].create_connection(
            ctx_a,
            {
                "name": "Catalog Ready",
                "host": "smtp.valid-test.example",
                "port": 465,
                "tlsMode": "implicit_tls",
                "username": "smtp-user",
                "password": "SuperSecret!99",
                "senderEmail": "noreply@starlidigital.ro",
            },
        )
        r2 = client.get(
            "/api/v1/starli/companies/comp-a/automations/integrations/catalog",
            headers={"Authorization": "Bearer admin-a"},
        )
        assert r2.status_code == 200
        conns2 = {c["id"]: c for c in r2.json()["connectors"]}
        assert conns2["starli.company-smtp"]["executionStatus"] == "AVAILABLE"
        assert conns2["starli.company-smtp"]["source"] == "NATIVE_VERIFIED_EXECUTOR"
        assert conns2["n8n-nodes-base.emailSend"]["executionStatus"] == "NOT_EXECUTABLE"
    finally:
        srv.close()
