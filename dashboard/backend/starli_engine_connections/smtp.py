"""Company-owned SMTP integration: TLS-only transport, Vault secrets, RBAC, human review & idempotent receipts."""
from __future__ import annotations

import asyncio
from contextlib import contextmanager
from dataclasses import dataclass
from email.message import EmailMessage
from email.utils import formataddr, make_msgid, parseaddr
import hashlib
from html import escape, unescape
from html.parser import HTMLParser
import ipaddress
import json
import re
import smtplib
import socket
import ssl
import time
from typing import Any, Callable
import uuid

from starli_automations.common import Fault

VERSION = "starli.company-smtp.v1"
SUPPORTED_PORTS = {465: "implicit_tls", 587: "required_starttls"}
APPROVAL_TTL_SECONDS = 900.0
DEFAULT_TIMEOUT_SECONDS = 15.0

_IDENT_RE = re.compile(r"^[A-Za-z0-9._:/-]{1,260}$")
_HOST_LABEL_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")
_EMAIL_RE = re.compile(
    r"^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@"
    r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?"
    r"(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$"
)
_CTRL_RE = re.compile(r"[\x00-\x1f\x7f]")
_INTERNAL_SUFFIXES = (
    ".local",
    ".internal",
    ".localhost",
    ".localdomain",
    ".home.arpa",
    ".intranet",
    ".corp",
    ".lan",
)
_CGNAT_NET = ipaddress.ip_network("100.64.0.0/10")
_ULA_NET = ipaddress.ip_network("fc00::/7")
_LINK_LOCAL_V6 = ipaddress.ip_network("fe80::/10")

_DROP_CONTENT_TAGS = frozenset(
    {
        "script",
        "style",
        "iframe",
        "object",
        "embed",
        "applet",
        "svg",
        "math",
        "noscript",
        "template",
        "form",
        "input",
        "button",
        "textarea",
        "select",
        "option",
        "link",
        "meta",
        "base",
        "head",
        "title",
    }
)
_ALLOWED_HTML_TAGS = frozenset(
    {
        "p",
        "br",
        "div",
        "span",
        "strong",
        "b",
        "em",
        "i",
        "u",
        "s",
        "blockquote",
        "pre",
        "code",
        "ul",
        "ol",
        "li",
        "h1",
        "h2",
        "h3",
        "h4",
        "hr",
        "a",
        "table",
        "thead",
        "tbody",
        "tr",
        "th",
        "td",
    }
)
_VOID_HTML_TAGS = frozenset({"br", "hr"})
_BLOCK_HTML_TAGS = frozenset({"p", "div", "li", "h1", "h2", "h3", "h4", "blockquote", "pre", "tr"})


class SmtpFault(Fault):
    """Domain fault with explicit safe code, HTTP status, and optional persisted receipt."""

    def __init__(self, code: str, status: int = 403, *, receipt: dict[str, Any] | None = None):
        super().__init__(code, status)
        self.code = code
        self.status = status
        self.receipt = receipt


def need(cond: Any, code: str, status: int = 403) -> None:
    if not cond:
        raise SmtpFault(code, status)


def exact(value: Any, required: tuple[str, ...], optional: tuple[str, ...] = ()) -> dict[str, Any]:
    need(isinstance(value, dict), "SMTP_INVALID_INPUT", 422)
    keys = set(value.keys())
    need(set(required) <= keys and keys <= (set(required) | set(optional)), "SMTP_INVALID_INPUT", 422)
    return value


def encoded(value: Any) -> str:
    return json.dumps(value, separators=(",", ":"), sort_keys=True, allow_nan=False)


def digest(value: Any) -> str:
    return hashlib.sha256(encoded(value).encode("utf-8")).hexdigest()


def envelope(company: str, **payload: Any) -> dict[str, Any]:
    return {"version": VERSION, "companyId": company, **payload}


def _check_ident(value: Any, code: str = "SMTP_INVALID_ID") -> str:
    need(isinstance(value, str) and _IDENT_RE.fullmatch(value) is not None, code, 422)
    return value


def _check_non_secret_line(value: Any, max_len: int, code: str, *, allow_empty: bool = False) -> str:
    need(isinstance(value, str), code, 422)
    cleaned = value.strip()
    if not allow_empty:
        need(len(cleaned) >= 1, code, 422)
    need(len(cleaned) <= max_len, code, 422)
    need(_CTRL_RE.search(cleaned) is None, code, 422)
    return cleaned


def is_public_ip(ip_obj: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    """Return True only when an IP (and any mapped IPv4) is globally routable public internet."""
    if isinstance(ip_obj, ipaddress.IPv6Address):
        if ip_obj.ipv4_mapped is not None:
            return is_public_ip(ip_obj.ipv4_mapped)
        if ip_obj.sixtofour is not None and not is_public_ip(ip_obj.sixtofour):
            return False
        if ip_obj in _ULA_NET or ip_obj in _LINK_LOCAL_V6:
            return False
    else:
        if ip_obj in _CGNAT_NET:
            return False
    return bool(
        ip_obj.is_global
        and not ip_obj.is_private
        and not ip_obj.is_loopback
        and not ip_obj.is_link_local
        and not ip_obj.is_multicast
        and not ip_obj.is_reserved
        and not ip_obj.is_unspecified
    )


def clean_host(raw: Any) -> str:
    """Validate an external SMTP DNS hostname and reject private/internal/literal destinations."""
    need(isinstance(raw, str), "SMTP_HOST_INVALID", 422)
    host = raw.strip().rstrip(".").lower()
    need(1 <= len(host) <= 253 and _CTRL_RE.search(host) is None, "SMTP_HOST_INVALID", 422)
    need(not any(ch in host for ch in " \t/@?#\\"), "SMTP_HOST_INVALID", 422)
    candidate_ip = raw.strip().strip("[]").split("%", 1)[0]
    try:
        ip_obj = ipaddress.ip_address(candidate_ip)
    except ValueError:
        ip_obj = None
    if ip_obj is not None:
        if not is_public_ip(ip_obj):
            raise SmtpFault("PRIVATE_DESTINATION_DENIED", 403)
        raise SmtpFault("SMTP_HOSTNAME_REQUIRED", 422)
    need(not any(ch in host for ch in ":[]"), "SMTP_HOST_INVALID", 422)
    if host in {"localhost", "ip6-localhost", "ip6-loopback"} or any(
        host.endswith(suffix) for suffix in _INTERNAL_SUFFIXES
    ):
        raise SmtpFault("PRIVATE_DESTINATION_DENIED", 403)
    try:
        ascii_host = host.encode("idna").decode("ascii").lower()
    except UnicodeError as exc:
        raise SmtpFault("SMTP_HOST_INVALID", 422) from exc
    labels = ascii_host.split(".")
    need(len(labels) >= 2 and all(_HOST_LABEL_RE.fullmatch(lbl) is not None for lbl in labels), "SMTP_HOST_INVALID", 422)
    need(not labels[-1].isdigit(), "SMTP_HOST_INVALID", 422)
    return ascii_host


def validate_port_tls(port: Any, tls_mode: Any) -> tuple[int, str]:
    """Enforce port 465 <-> implicit_tls and port 587 <-> required_starttls only."""
    need(type(port) is int and port in SUPPORTED_PORTS, "SMTP_TLS_POLICY_DENIED", 422)
    expected = SUPPORTED_PORTS[port]
    need(tls_mode == expected, "SMTP_TLS_POLICY_DENIED", 422)
    return port, str(tls_mode)


def clean_email(raw: Any, code: str = "SMTP_EMAIL_INVALID") -> str:
    value = _check_non_secret_line(raw, 320, code)
    parsed_name, addr = parseaddr(value)
    need(parsed_name == "" and addr == value, code, 422)
    need(_EMAIL_RE.fullmatch(addr) is not None, code, 422)
    local, domain = addr.rsplit("@", 1)
    try:
        ascii_domain = domain.encode("idna").decode("ascii").lower()
    except UnicodeError as exc:
        raise SmtpFault(code, 422) from exc
    return f"{local}@{ascii_domain}"


def clean_recipients(items: Any, code: str, *, required: bool = False) -> list[str]:
    if items is None and not required:
        return []
    need(isinstance(items, list), code, 422)
    seen: list[str] = []
    seen_set: set[str] = set()
    for raw in items:
        addr = clean_email(raw, code)
        key = addr.lower()
        if key not in seen_set:
            seen_set.add(key)
            seen.append(addr)
    if required:
        need(len(seen) >= 1, code, 422)
    need(len(seen) <= 50, "SMTP_RECIPIENT_LIMIT", 422)
    return seen


def _is_safe_href(raw: str) -> str | None:
    cleaned = unescape(raw or "").strip()
    cleaned = "".join(ch for ch in cleaned if ord(ch) > 32 and ord(ch) != 127)
    if not cleaned:
        return None
    lower = cleaned.lower()
    if lower.startswith(("https://", "http://", "mailto:")) and len(cleaned) <= 2048:
        return cleaned
    return None


class _SafeHtmlSanitizer(HTMLParser):
    """Allowlist HTML sanitizer removing scripts, styles, event handlers, and unsafe URIs."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=False)
        self.parts: list[str] = []
        self.stack: list[str] = []
        self.drop_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag_l = tag.lower()
        if tag_l in _DROP_CONTENT_TAGS:
            self.drop_depth += 1
            return
        if self.drop_depth > 0 or tag_l not in _ALLOWED_HTML_TAGS:
            return
        attr_text = ""
        if tag_l == "a":
            href_val = None
            title_val = None
            for k, v in attrs:
                kl = k.lower()
                if kl == "href" and v is not None:
                    href_val = _is_safe_href(v)
                elif kl == "title" and v is not None and _CTRL_RE.search(v) is None:
                    title_val = v[:200]
            built: list[str] = []
            if href_val:
                built.append(f'href="{escape(href_val, quote=True)}"')
                built.append('rel="noopener noreferrer"')
            if title_val:
                built.append(f'title="{escape(title_val, quote=True)}"')
            if built:
                attr_text = " " + " ".join(built)
        elif tag_l in ("td", "th"):
            built_cells: list[str] = []
            for k, v in attrs:
                kl = k.lower()
                if kl in ("colspan", "rowspan") and v is not None and v.isdigit() and 1 <= int(v) <= 20:
                    built_cells.append(f'{kl}="{v}"')
            if built_cells:
                attr_text = " " + " ".join(built_cells)
        self.parts.append(f"<{tag_l}{attr_text}>")
        if tag_l not in _VOID_HTML_TAGS:
            self.stack.append(tag_l)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag_l = tag.lower()
        if tag_l in _VOID_HTML_TAGS and self.drop_depth == 0:
            self.parts.append(f"<{tag_l}>")

    def handle_endtag(self, tag: str) -> None:
        tag_l = tag.lower()
        if tag_l in _DROP_CONTENT_TAGS:
            if self.drop_depth > 0:
                self.drop_depth -= 1
            return
        if self.drop_depth > 0 or tag_l not in _ALLOWED_HTML_TAGS or tag_l in _VOID_HTML_TAGS:
            return
        while self.stack:
            top = self.stack.pop()
            self.parts.append(f"</{top}>")
            if top == tag_l:
                break

    def handle_data(self, data: str) -> None:
        if self.drop_depth == 0:
            self.parts.append(escape(data, quote=False))

    def handle_entityref(self, name: str) -> None:
        if self.drop_depth == 0 and re.fullmatch(r"[A-Za-z0-9]{1,32}", name):
            self.parts.append(f"&{name};")

    def handle_charref(self, name: str) -> None:
        if self.drop_depth == 0 and re.fullmatch(r"(?:x[0-9A-Fa-f]{1,6}|[0-9]{1,7})", name):
            self.parts.append(f"&#{name};")

    def finish(self) -> str:
        while self.stack:
            self.parts.append(f"</{self.stack.pop()}>")
        return "".join(self.parts).strip()


class _HtmlTextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.chunks: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tl = tag.lower()
        if tl in _BLOCK_HTML_TAGS or tl in ("br", "hr"):
            self.chunks.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() in _BLOCK_HTML_TAGS:
            self.chunks.append("\n")

    def handle_data(self, data: str) -> None:
        self.chunks.append(data)

    def finish(self) -> str:
        lines = [line.strip() for line in "".join(self.chunks).splitlines()]
        out: list[str] = []
        for line in lines:
            if line or (out and out[-1] != ""):
                out.append(line)
        return "\n".join(out).strip()


def sanitize_html_body(raw_html: str) -> str:
    need(isinstance(raw_html, str) and len(raw_html) <= 80000, "SMTP_HTML_BODY_TOO_LARGE", 422)
    need("\x00" not in raw_html, "SMTP_HTML_BODY_INVALID", 422)
    parser = _SafeHtmlSanitizer()
    parser.feed(raw_html)
    parser.close()
    return parser.finish()


def html_to_text(safe_html: str) -> str:
    extractor = _HtmlTextExtractor()
    extractor.feed(safe_html)
    extractor.close()
    return extractor.finish()


def default_ssl_context() -> ssl.SSLContext:
    ctx = ssl.create_default_context()
    ctx.check_hostname = True
    ctx.verify_mode = ssl.CERT_REQUIRED
    ctx.minimum_version = ssl.TLSVersion.TLSv1_2
    return ctx


def resolve_public_smtp(host: str, port: int) -> tuple[str, int]:
    """Resolve DNS cleanly and pin one validated public IP (blocks SSRF/private/rebinding)."""
    ascii_host = clean_host(host)
    port_i, _ = validate_port_tls(port, SUPPORTED_PORTS.get(port))
    try:
        infos = socket.getaddrinfo(ascii_host, port_i, type=socket.SOCK_STREAM)
    except OSError as exc:
        raise SmtpFault("SMTP_DNS_RESOLUTION_FAILED", 502) from exc
    need(bool(infos), "SMTP_DNS_RESOLUTION_FAILED", 502)
    chosen: str | None = None
    for family, _socktype, _proto, _canon, sockaddr in infos:
        if family not in (socket.AF_INET, socket.AF_INET6) or not sockaddr:
            continue
        raw_ip = sockaddr[0].split("%", 1)[0]
        try:
            ip_obj = ipaddress.ip_address(raw_ip)
        except ValueError as exc:
            raise SmtpFault("PRIVATE_DESTINATION_DENIED", 403) from exc
        if not is_public_ip(ip_obj):
            raise SmtpFault("PRIVATE_DESTINATION_DENIED", 403)
        if chosen is None:
            chosen = str(ip_obj)
    need(chosen is not None, "SMTP_DNS_RESOLUTION_FAILED", 502)
    return str(chosen), port_i


class _PinnedSMTP(smtplib.SMTP):
    """smtplib.SMTP pinned to an already-verified IP while preserving SNI/hostname verification."""

    def __init__(self, pinned_ip: str, sni_host: str, connect_port: int, timeout: float):
        self._pinned_ip = pinned_ip
        self._sni_host = sni_host
        self._connect_port = connect_port
        self._data_entered = False
        super().__init__(host=sni_host, port=connect_port, timeout=timeout)

    def _get_socket(self, host: str, port: int, timeout: float):
        return socket.create_connection((self._pinned_ip, self._connect_port), timeout, self.source_address)

    def data(self, msg):
        self._data_entered = True
        return super().data(msg)


class _PinnedSMTPSSL(smtplib.SMTP_SSL):
    """smtplib.SMTP_SSL pinned to a verified IP with SNI/hostname check on port 465."""

    def __init__(self, pinned_ip: str, sni_host: str, connect_port: int, timeout: float, context: ssl.SSLContext):
        self._pinned_ip = pinned_ip
        self._sni_host = sni_host
        self._connect_port = connect_port
        self._data_entered = False
        super().__init__(host=sni_host, port=connect_port, timeout=timeout, context=context)

    def _get_socket(self, host: str, port: int, timeout: float):
        sock = socket.create_connection((self._pinned_ip, self._connect_port), timeout, self.source_address)
        try:
            return self.context.wrap_socket(sock, server_hostname=self._sni_host)
        except BaseException:
            try:
                sock.close()
            except OSError:
                pass
            raise

    def data(self, msg):
        self._data_entered = True
        return super().data(msg)


def _sanitized_smtp_text(raw: Any) -> str:
    if isinstance(raw, bytes):
        text = raw.decode("utf-8", errors="replace")
    else:
        text = str(raw or "")
    text = re.sub(r"[\r\n\x00]+", " ", text).strip()
    return text[:260]


class SmtpNetworkClient:
    """Strict TLS-only synchronous SMTP probe & send executor."""

    def __init__(
        self,
        *,
        resolver: Callable[[str, int], tuple[str, int]] = resolve_public_smtp,
        ssl_context_factory: Callable[[], ssl.SSLContext] = default_ssl_context,
        timeout: float = DEFAULT_TIMEOUT_SECONDS,
    ):
        self.resolver = resolver
        self.ssl_context_factory = ssl_context_factory
        self.timeout = timeout

    def _connect_and_auth(
        self,
        *,
        host: str,
        port: int,
        tls_mode: str,
        username: str,
        password: str,
    ) -> tuple[_PinnedSMTP | _PinnedSMTPSSL, str, str | None, str | None]:
        validate_port_tls(port, tls_mode)
        resolved_ip, connect_port = self.resolver(host, port)
        ssl_ctx = self.ssl_context_factory()
        need(
            ssl_ctx.check_hostname is True and ssl_ctx.verify_mode == ssl.CERT_REQUIRED,
            "TLS_POLICY_MISCONFIGURED",
            500,
        )
        client: _PinnedSMTP | _PinnedSMTPSSL | None = None
        try:
            if tls_mode == "implicit_tls":
                client = _PinnedSMTPSSL(resolved_ip, host, connect_port, self.timeout, ssl_ctx)
                client.set_debuglevel(0)
                client.ehlo_or_helo_if_needed()
            else:
                client = _PinnedSMTP(resolved_ip, host, connect_port, self.timeout)
                client.set_debuglevel(0)
                client.ehlo()
                if not client.has_extn("starttls"):
                    raise SmtpFault("SMTP_STARTTLS_REQUIRED", 502)
                code, _ = client.starttls(context=ssl_ctx)
                need(200 <= int(code) < 300, "SMTP_STARTTLS_REQUIRED", 502)
                client.ehlo()
            need(isinstance(client.sock, ssl.SSLSocket), "SMTP_TLS_REQUIRED", 502)
            tls_version = client.sock.version()
            cipher = client.sock.cipher()
            tls_cipher = cipher[0] if cipher else None
            client.login(username, password)
            return client, resolved_ip, tls_version, tls_cipher
        except SmtpFault:
            self._safe_close(client)
            raise
        except ssl.SSLCertVerificationError as exc:
            self._safe_close(client)
            raise SmtpFault("TLS_CERTIFICATE_INVALID", 502) from exc
        except ssl.SSLError as exc:
            self._safe_close(client)
            raise SmtpFault("SMTP_TLS_HANDSHAKE_FAILED", 502) from exc
        except smtplib.SMTPAuthenticationError as exc:
            self._safe_close(client)
            raise SmtpFault("SMTP_AUTH_FAILED", 502) from exc
        except smtplib.SMTPNotSupportedError as exc:
            self._safe_close(client)
            raise SmtpFault("SMTP_STARTTLS_REQUIRED", 502) from exc
        except (TimeoutError, socket.timeout) as exc:
            self._safe_close(client)
            raise SmtpFault("SMTP_CONNECT_TIMEOUT", 504) from exc
        except (smtplib.SMTPException, OSError) as exc:
            self._safe_close(client)
            raise SmtpFault("SMTP_CONNECT_FAILED", 502) from exc

    @staticmethod
    def _safe_close(client: _PinnedSMTP | _PinnedSMTPSSL | None) -> None:
        if client is None:
            return
        try:
            client.quit()
        except Exception:
            try:
                client.close()
            except Exception:
                pass

    def test_connection(
        self,
        *,
        host: str,
        port: int,
        tls_mode: str,
        username: str,
        password: str,
    ) -> dict[str, Any]:
        """Verify DNS/SSRF, TLS cert, and SMTP authentication without MAIL/RCPT/DATA."""
        client, resolved_ip, tls_proto, tls_cipher = self._connect_and_auth(
            host=host,
            port=port,
            tls_mode=tls_mode,
            username=username,
            password=password,
        )
        try:
            code, resp = client.noop()
            return {
                "tested": True,
                "messageSent": False,
                "resolvedIp": resolved_ip,
                "tlsProtocol": tls_proto,
                "tlsCipher": tls_cipher,
                "smtpCode": int(code),
                "smtpMessage": _sanitized_smtp_text(resp),
            }
        finally:
            self._safe_close(client)

    def send_email(
        self,
        *,
        host: str,
        port: int,
        tls_mode: str,
        username: str,
        password: str,
        sender_email: str,
        sender_name: str,
        to_addrs: list[str],
        cc_addrs: list[str],
        bcc_addrs: list[str],
        subject: str,
        text_body: str,
        html_body: str | None,
        preflight: Callable[[], None],
    ) -> dict[str, Any]:
        """Connect, re-verify preflight right before MAIL FROM, and transmit email once."""
        domain = sender_email.rsplit("@", 1)[1]
        message_id = make_msgid(domain=domain)
        msg = EmailMessage()
        msg["From"] = formataddr((sender_name, sender_email)) if sender_name else sender_email
        msg["To"] = ", ".join(to_addrs)
        if cc_addrs:
            msg["Cc"] = ", ".join(cc_addrs)
        # Never expose Bcc in headers; pass Bcc recipients strictly via SMTP RCPT TO envelope.
        msg["Subject"] = subject
        msg["Message-ID"] = message_id
        msg.set_content(text_body, subtype="plain", charset="utf-8")
        if html_body:
            wrapped = (
                "<!DOCTYPE html><html><head><meta charset=\"utf-8\"></head>"
                f"<body>{html_body}</body></html>"
            )
            msg.add_alternative(wrapped, subtype="html", charset="utf-8")

        client: _PinnedSMTP | _PinnedSMTPSSL | None = None
        resolved_ip: str | None = None
        tls_proto: str | None = None
        tls_cipher: str | None = None
        try:
            client, resolved_ip, tls_proto, tls_cipher = self._connect_and_auth(
                host=host,
                port=port,
                tls_mode=tls_mode,
                username=username,
                password=password,
            )
        except SmtpFault as exc:
            return {
                "state": "FAILED_PRE_SEND",
                "smtpAccepted": False,
                "deliveryVerified": False,
                "errorCode": exc.code,
                "httpStatus": exc.status,
                "messageIdHeader": message_id,
                "resolvedIp": resolved_ip,
                "tlsProtocol": tls_proto,
                "tlsCipher": tls_cipher,
                "smtpCode": None,
                "smtpMessage": None,
            }

        try:
            preflight()
        except SmtpFault as exc:
            self._safe_close(client)
            return {
                "state": "FAILED_PRE_SEND",
                "smtpAccepted": False,
                "deliveryVerified": False,
                "errorCode": exc.code,
                "httpStatus": exc.status,
                "messageIdHeader": message_id,
                "resolvedIp": resolved_ip,
                "tlsProtocol": tls_proto,
                "tlsCipher": tls_cipher,
                "smtpCode": None,
                "smtpMessage": None,
            }

        envelope_rcpts = [*to_addrs, *cc_addrs, *bcc_addrs]
        try:
            refused = client.send_message(msg, from_addr=sender_email, to_addrs=envelope_rcpts)
            if refused:
                return {
                    "state": "UNCERTAIN",
                    "smtpAccepted": None,
                    "deliveryVerified": False,
                    "errorCode": "SMTP_PARTIAL_RECIPIENT_REFUSAL",
                    "httpStatus": 502,
                    "messageIdHeader": message_id,
                    "resolvedIp": resolved_ip,
                    "tlsProtocol": tls_proto,
                    "tlsCipher": tls_cipher,
                    "smtpCode": None,
                    "smtpMessage": None,
                }
            return {
                "state": "SMTP_ACCEPTED",
                "smtpAccepted": True,
                "deliveryVerified": False,
                "errorCode": None,
                "httpStatus": 200,
                "messageIdHeader": message_id,
                "resolvedIp": resolved_ip,
                "tlsProtocol": tls_proto,
                "tlsCipher": tls_cipher,
                "smtpCode": 250,
                "smtpMessage": "SMTP server accepted message for relay; inbox delivery is not verified by SMTP.",
            }
        except (smtplib.SMTPSenderRefused, smtplib.SMTPRecipientsRefused) as exc:
            if getattr(client, "_data_entered", False):
                return {
                    "state": "UNCERTAIN",
                    "smtpAccepted": None,
                    "deliveryVerified": False,
                    "errorCode": "SMTP_SEND_UNCERTAIN",
                    "httpStatus": 504,
                    "messageIdHeader": message_id,
                    "resolvedIp": resolved_ip,
                    "tlsProtocol": tls_proto,
                    "tlsCipher": tls_cipher,
                    "smtpCode": None,
                    "smtpMessage": None,
                }
            smtp_code = int(getattr(exc, "smtp_code", 550) or 550)
            return {
                "state": "SMTP_REFUSED",
                "smtpAccepted": False,
                "deliveryVerified": False,
                "errorCode": "SMTP_RECIPIENTS_REFUSED",
                "httpStatus": 502,
                "messageIdHeader": message_id,
                "resolvedIp": resolved_ip,
                "tlsProtocol": tls_proto,
                "tlsCipher": tls_cipher,
                "smtpCode": smtp_code,
                "smtpMessage": _sanitized_smtp_text(getattr(exc, "smtp_error", "")),
            }
        except smtplib.SMTPDataError as exc:
            return {
                "state": "SMTP_REFUSED",
                "smtpAccepted": False,
                "deliveryVerified": False,
                "errorCode": "SMTP_DATA_REFUSED",
                "httpStatus": 502,
                "messageIdHeader": message_id,
                "resolvedIp": resolved_ip,
                "tlsProtocol": tls_proto,
                "tlsCipher": tls_cipher,
                "smtpCode": int(getattr(exc, "smtp_code", 550) or 550),
                "smtpMessage": _sanitized_smtp_text(getattr(exc, "smtp_error", "")),
            }
        except (
            smtplib.SMTPServerDisconnected,
            smtplib.SMTPException,
            TimeoutError,
            socket.timeout,
            ssl.SSLError,
            OSError,
        ):
            return {
                "state": "UNCERTAIN",
                "smtpAccepted": None,
                "deliveryVerified": False,
                "errorCode": "SMTP_SEND_UNCERTAIN",
                "httpStatus": 504,
                "messageIdHeader": message_id,
                "resolvedIp": resolved_ip,
                "tlsProtocol": tls_proto,
                "tlsCipher": tls_cipher,
                "smtpCode": None,
                "smtpMessage": None,
            }
        finally:
            self._safe_close(client)


SCHEMA = """
CREATE TABLE IF NOT EXISTS cs_smtp_connections(
    id TEXT PRIMARY KEY,
    company TEXT NOT NULL,
    name TEXT NOT NULL,
    host TEXT NOT NULL,
    port INTEGER NOT NULL,
    tls_mode TEXT NOT NULL,
    username TEXT NOT NULL,
    secret BLOB,
    sender_email TEXT NOT NULL,
    sender_name TEXT NOT NULL,
    state TEXT NOT NULL,
    revision INTEGER NOT NULL,
    created_by TEXT NOT NULL,
    created_binding TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    last_test_status TEXT,
    last_test_code TEXT,
    last_test_at REAL,
    revoked_by TEXT,
    revoked_at REAL,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cs_smtp_conn_company ON cs_smtp_connections(company, state, created_at);

CREATE TABLE IF NOT EXISTS cs_smtp_drafts(
    id TEXT PRIMARY KEY,
    company TEXT NOT NULL,
    connection_id TEXT NOT NULL,
    connection_revision INTEGER NOT NULL,
    room TEXT NOT NULL,
    bot TEXT NOT NULL,
    actor TEXT NOT NULL,
    actor_binding TEXT NOT NULL,
    sender_email TEXT NOT NULL,
    sender_name TEXT NOT NULL,
    to_addrs TEXT NOT NULL,
    cc_addrs TEXT NOT NULL,
    bcc_addrs TEXT NOT NULL,
    subject TEXT NOT NULL,
    text_body TEXT NOT NULL,
    html_body TEXT,
    review_hash TEXT NOT NULL,
    state TEXT NOT NULL,
    revision INTEGER NOT NULL,
    request_key TEXT NOT NULL,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL,
    UNIQUE(company, request_key)
);

CREATE TABLE IF NOT EXISTS cs_smtp_approvals(
    id TEXT PRIMARY KEY,
    company TEXT NOT NULL,
    draft_id TEXT NOT NULL,
    draft_revision INTEGER NOT NULL,
    connection_id TEXT NOT NULL,
    connection_revision INTEGER NOT NULL,
    room TEXT NOT NULL,
    bot TEXT NOT NULL,
    actor TEXT NOT NULL,
    actor_binding TEXT NOT NULL,
    assistant_message TEXT,
    review_hash TEXT NOT NULL,
    state TEXT NOT NULL,
    approver TEXT,
    approver_binding TEXT,
    decision_note TEXT,
    decided_at REAL,
    expires_at REAL NOT NULL,
    request_key TEXT NOT NULL,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL,
    UNIQUE(company, request_key)
);
CREATE INDEX IF NOT EXISTS idx_cs_smtp_appr_company ON cs_smtp_approvals(company, created_at);

CREATE TABLE IF NOT EXISTS cs_smtp_sends(
    id TEXT PRIMARY KEY,
    company TEXT NOT NULL,
    approval_id TEXT NOT NULL UNIQUE,
    draft_id TEXT NOT NULL,
    connection_id TEXT NOT NULL,
    connection_revision INTEGER NOT NULL,
    room TEXT NOT NULL,
    bot TEXT NOT NULL,
    actor TEXT NOT NULL,
    approver TEXT NOT NULL,
    review_hash TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    state TEXT NOT NULL,
    smtp_accepted INTEGER,
    delivery_verified INTEGER NOT NULL DEFAULT 0,
    attempt_count INTEGER NOT NULL DEFAULT 1,
    smtp_code INTEGER,
    smtp_message TEXT,
    error_code TEXT,
    message_id_header TEXT,
    resolved_ip TEXT,
    tls_protocol TEXT,
    tls_cipher TEXT,
    created_at REAL NOT NULL,
    completed_at REAL,
    UNIQUE(company, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_cs_smtp_send_company ON cs_smtp_sends(company, created_at);
"""


@dataclass(frozen=True)
class SmtpContext:
    company: str
    actor: str
    binding: str
    session: Any
    room: str | None = None
    bot: str | None = None
    native_scope: Any = None


class CompanySmtpService:
    """Company-owned SMTP credential manager, approval gate, and idempotent sender."""

    def __init__(
        self,
        store: Any,
        permission: Callable[[Any, Any, str], Any],
        vault: Any,
        *,
        network: SmtpNetworkClient | None = None,
        clock: Callable[[], float] = time.time,
        approval_ttl: float = APPROVAL_TTL_SECONDS,
    ):
        need(vault is not None, "VAULT_MASTER_KEY_REQUIRED", 503)
        self.store = store
        self.permission = permission
        self.vault = vault
        self.network = network or SmtpNetworkClient()
        self.clock = clock
        self.approval_ttl = approval_ttl
        self._projection_installed = False
        with self.store.db() as db:
            db.executescript(SCHEMA)

    def recover(self) -> None:
        """Mark interrupted in-flight SENDING attempts UNCERTAIN on startup; never auto-retry."""
        now = self.clock()
        with self.store.db() as db:
            db.execute(
                "UPDATE cs_smtp_sends SET state='UNCERTAIN', error_code=COALESCE(error_code,'SMTP_INTERRUPTED_ON_RESTART'), completed_at=COALESCE(completed_at,?) WHERE state='SENDING'",
                (now,),
            )
            db.execute(
                "UPDATE cs_smtp_approvals SET state='UNCERTAIN', updated_at=? WHERE state='SENDING'",
                (now,),
            )

    def context(self, session: Any, company: str, room: str | None = None, bot: str | None = None, native_scope: Any = None) -> SmtpContext:
        need(getattr(session, "kind", None) == "jwt", "NATIVE_JWT_REQUIRED", 401)
        with self.store.access(session, company, room) as (db, member, _):
            ctx = SmtpContext(member.company_id, member.user_id, member.binding, session, room, bot, native_scope)
            self.permission(ctx, db, "read")
            return ctx

    @contextmanager
    def access(self, ctx: SmtpContext, permission: str = "read", room: str | None = None):
        target_room = room if room is not None else ctx.room
        with self.store.access(ctx.session, ctx.company, target_room) as (db, member, _):
            need((member.user_id, member.binding) == (ctx.actor, ctx.binding), "MEMBERSHIP_CHANGED", 403)
            self.permission(ctx, db, permission)
            if ctx.bot:
                self.store.agent(db, member, target_room, ctx.bot)
            yield db, member
            self.permission(ctx, db, permission)

    @staticmethod
    def _vault_resource(conn_id: str, revision: int) -> str:
        return f"smtp:{conn_id}:{revision}"

    def _seal_secret(self, company: str, conn_id: str, revision: int, password: str) -> bytes:
        return bytes(self.vault.seal(company, self._vault_resource(conn_id, revision), {"password": password}))

    def _open_secret(self, row: Any) -> str:
        secret = row["secret"]
        need(secret is not None and row["state"] == "ACTIVE", "SMTP_CONNECTION_REVOKED", 409)
        data = self.vault.open(row["company"], self._vault_resource(row["id"], int(row["revision"])), bytes(secret))
        password = data.get("password") if isinstance(data, dict) else None
        need(isinstance(password, str) and len(password) >= 1, "CREDENTIAL_BINDING_INVALID", 403)
        return password

    @staticmethod
    def _conn_admin_dto(row: Any) -> dict[str, Any]:
        return {
            "id": row["id"],
            "connectionId": row["id"],
            "name": row["name"],
            "host": row["host"],
            "port": int(row["port"]),
            "tlsMode": row["tls_mode"],
            "username": row["username"],
            "passwordConfigured": row["secret"] is not None and row["state"] == "ACTIVE",
            "senderEmail": row["sender_email"],
            "senderName": row["sender_name"],
            "status": row["state"],
            "revision": int(row["revision"]),
            "lastTestStatus": row["last_test_status"],
            "lastTestCode": row["last_test_code"],
            "lastTestAt": row["last_test_at"],
            "revokedAt": row["revoked_at"],
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        }

    @staticmethod
    def _conn_bot_dto(row: Any) -> dict[str, Any]:
        """Bot-facing connection metadata: never exposes password or raw SMTP username."""
        return {
            "id": row["id"],
            "connectionId": row["id"],
            "name": row["name"],
            "host": row["host"],
            "port": int(row["port"]),
            "tlsMode": row["tls_mode"],
            "senderEmail": row["sender_email"],
            "senderName": row["sender_name"],
            "status": row["state"],
            "revision": int(row["revision"]),
            "lastTestStatus": row["last_test_status"],
            "updatedAt": row["updated_at"],
        }

    @staticmethod
    def _draft_dto(row: Any) -> dict[str, Any]:
        return {
            "id": row["id"],
            "draftId": row["id"],
            "connectionId": row["connection_id"],
            "connectionRevision": int(row["connection_revision"]),
            "sourceConversationId": row["room"],
            "botId": row["bot"],
            "actorUserId": row["actor"],
            "senderEmail": row["sender_email"],
            "senderName": row["sender_name"],
            "to": json.loads(row["to_addrs"]),
            "cc": json.loads(row["cc_addrs"]),
            "bcc": json.loads(row["bcc_addrs"]),
            "subject": row["subject"],
            "textBody": row["text_body"],
            "htmlBody": row["html_body"],
            "hasHtml": bool(row["html_body"]),
            "reviewHash": row["review_hash"],
            "state": row["state"],
            "revision": int(row["revision"]),
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        }

    @staticmethod
    def _receipt_dto(row: Any | None) -> dict[str, Any] | None:
        if row is None:
            return None
        smtp_acc = row["smtp_accepted"]
        return {
            "id": row["id"],
            "receiptId": row["id"],
            "approvalId": row["approval_id"],
            "draftId": row["draft_id"],
            "connectionId": row["connection_id"],
            "connectionRevision": int(row["connection_revision"]),
            "sourceConversationId": row["room"],
            "botId": row["bot"],
            "actorUserId": row["actor"],
            "approverUserId": row["approver"],
            "reviewHash": row["review_hash"],
            "idempotencyKey": row["idempotency_key"],
            "status": row["state"],
            "smtpAccepted": None if smtp_acc is None else bool(smtp_acc),
            "deliveryVerified": bool(row["delivery_verified"]),
            "retryAllowed": False,
            "attemptCount": int(row["attempt_count"]),
            "smtpCode": row["smtp_code"],
            "smtpMessage": row["smtp_message"],
            "errorCode": row["error_code"],
            "messageIdHeader": row["message_id_header"],
            "resolvedIp": row["resolved_ip"],
            "tlsProtocol": row["tls_protocol"],
            "tlsCipher": row["tls_cipher"],
            "createdAt": row["created_at"],
            "completedAt": row["completed_at"],
        }

    def _approval_dto(self, db: Any, appr_row: Any, draft_row: Any | None = None, receipt_row: Any | None = None) -> dict[str, Any]:
        if draft_row is None:
            draft_row = db.execute("SELECT * FROM cs_smtp_drafts WHERE id=? AND company=?", (appr_row["draft_id"], appr_row["company"])).fetchone()
        if receipt_row is None:
            receipt_row = db.execute("SELECT * FROM cs_smtp_sends WHERE approval_id=? AND company=?", (appr_row["id"], appr_row["company"])).fetchone()
        conn_row = db.execute(
            "SELECT name,host,port,tls_mode,state,revision FROM cs_smtp_connections WHERE id=? AND company=?",
            (appr_row["connection_id"], appr_row["company"]),
        ).fetchone()
        draft_data = self._draft_dto(draft_row) if draft_row is not None else None
        now = self.clock()
        state = appr_row["state"]
        if state in ("PENDING", "APPROVED") and float(appr_row["expires_at"]) <= now:
            state = "EXPIRED"
        return {
            "id": appr_row["id"],
            "approvalId": appr_row["id"],
            "companyId": appr_row["company"],
            "draftId": appr_row["draft_id"],
            "draftRevision": int(appr_row["draft_revision"]),
            "connectionId": appr_row["connection_id"],
            "connectionRevision": int(appr_row["connection_revision"]),
            "connectionName": conn_row["name"] if conn_row else "",
            "connectionHost": conn_row["host"] if conn_row else "",
            "connectionPort": int(conn_row["port"]) if conn_row else None,
            "connectionTlsMode": conn_row["tls_mode"] if conn_row else "",
            "connectionActive": bool(conn_row and conn_row["state"] == "ACTIVE" and int(conn_row["revision"]) == int(appr_row["connection_revision"])),
            "sourceConversationId": appr_row["room"],
            "botId": appr_row["bot"],
            "actorUserId": appr_row["actor"],
            "assistantMessageId": appr_row["assistant_message"],
            "reviewHash": appr_row["review_hash"],
            "state": state,
            "approverUserId": appr_row["approver"],
            "decisionNote": appr_row["decision_note"],
            "decidedAt": appr_row["decided_at"],
            "expiresAt": appr_row["expires_at"],
            "createdAt": appr_row["created_at"],
            "updatedAt": appr_row["updated_at"],
            "draft": draft_data,
            "receipt": self._receipt_dto(receipt_row),
            "deliveryVerified": False,
        }

    def _card_payload(self, dto: dict[str, Any]) -> dict[str, Any]:
        draft = dto.get("draft") or {}
        return {
            "version": VERSION,
            "kind": "smtp_approval",
            "companyId": dto["companyId"],
            "sourceConversationId": dto["sourceConversationId"],
            "approvalId": dto["id"],
            "draftId": dto["draftId"],
            "connectionId": dto["connectionId"],
            "connectionRevision": dto["connectionRevision"],
            "connectionName": dto.get("connectionName", ""),
            "requestingBotId": dto["botId"],
            "actorUserId": dto["actorUserId"],
            "assistantMessageId": dto.get("assistantMessageId"),
            "reviewHash": dto["reviewHash"],
            "state": dto["state"],
            "expiresAt": dto["expiresAt"],
            "senderEmail": draft.get("senderEmail", ""),
            "senderName": draft.get("senderName", ""),
            "to": draft.get("to", []),
            "cc": draft.get("cc", []),
            "bcc": draft.get("bcc", []),
            "subject": draft.get("subject", ""),
            "textBody": draft.get("textBody", ""),
            "htmlBody": draft.get("htmlBody"),
            "approverUserId": dto.get("approverUserId"),
            "receipt": dto.get("receipt"),
            "deliveryVerified": False,
        }

    def _sync_assistant_card(self, db: Any, dto: dict[str, Any]) -> None:
        assistant = dto.get("assistantMessageId")
        room = dto["sourceConversationId"]
        bot = dto["botId"]
        if not assistant:
            return
        origin = db.execute("SELECT kind,speaker,deleted FROM cm_messages WHERE id=? AND room=?", (assistant, room)).fetchone()
        if not origin or origin["kind"] != "agent" or origin["speaker"] != bot or origin["deleted"]:
            return
        raw = db.execute("SELECT data FROM message WHERE id=? AND channel_id=?", (assistant, room)).fetchone()
        if raw is None:
            return
        data = json.loads(raw[0] or "{}")
        if not isinstance(data, dict):
            data = {}
        data["starliSmtpApproval"] = self._card_payload(dto)
        db.execute("UPDATE message SET data=? WHERE id=? AND channel_id=?", (encoded(data), assistant, room))
        db.execute("UPDATE cm_messages SET revision=revision+1 WHERE id=?", (assistant,))
        self.store.event(db, room, "message.updated", assistant)

    def install_card_projection(self) -> None:
        if self._projection_installed:
            return
        import types

        original = self.store.message_dto

        def dto(store, db, room, message):
            result = original(db, room, message)
            if result.get("deleted"):
                return result
            origin = db.execute(
                "SELECT company,bot,room FROM cs_smtp_approvals WHERE room=? AND assistant_message=? ORDER BY created_at DESC LIMIT 1",
                (room, message),
            ).fetchone()
            if origin and result.get("speaker") == {"kind": "agent", "id": origin["bot"]}:
                row = db.execute("SELECT data FROM message WHERE id=? AND channel_id=?", (message, room)).fetchone()
                value = json.loads(row["data"] or "{}").get("starliSmtpApproval") if row else None
                if isinstance(value, dict) and (
                    value.get("version"),
                    value.get("companyId"),
                    value.get("sourceConversationId"),
                    value.get("assistantMessageId"),
                ) == (VERSION, origin["company"], room, message):
                    result["data"] = {**(result.get("data") or {}), "starliSmtpApproval": value}
            return result

        self.store.message_dto = types.MethodType(dto, self.store)
        self._projection_installed = True

    @staticmethod
    def _is_person_scope(scope: Any) -> bool:
        kind = scope.get("kind") if isinstance(scope, dict) else getattr(scope, "kind", None)
        return kind == "person"

    def _require_admin(self, ctx: SmtpContext, db: Any) -> None:
        need(ctx.bot is None and ctx.native_scope is None, "SMTP_ADMIN_HUMAN_REQUIRED", 403)
        scope = self.permission(ctx, db, "connections.manage")
        need(self._is_person_scope(scope), "SMTP_ADMIN_HUMAN_REQUIRED", 403)
        self.permission(ctx, db, "integrations.install")

    # ---- Admin connection operations ----

    def list_admin_connections(self, ctx: SmtpContext) -> dict[str, Any]:
        with self.access(ctx) as (db, _):
            self._require_admin(ctx, db)
            conns = db.execute(
                "SELECT * FROM cs_smtp_connections WHERE company=? ORDER BY created_at DESC",
                (ctx.company,),
            ).fetchall()
            approvals = db.execute(
                "SELECT * FROM cs_smtp_approvals WHERE company=? ORDER BY created_at DESC LIMIT 25",
                (ctx.company,),
            ).fetchall()
            sends = db.execute(
                "SELECT * FROM cs_smtp_sends WHERE company=? ORDER BY created_at DESC LIMIT 25",
                (ctx.company,),
            ).fetchall()
            return envelope(
                ctx.company,
                connections=[self._conn_admin_dto(r) for r in conns],
                approvals=[self._approval_dto(db, r) for r in approvals],
                receipts=[self._receipt_dto(r) for r in sends],
                actions={"canManage": True},
                policy={
                    "supportedPorts": [465, 587],
                    "tlsModes": ["implicit_tls", "required_starttls"],
                    "plaintextAllowed": False,
                },
            )

    def create_connection(self, ctx: SmtpContext, form: dict[str, Any]) -> dict[str, Any]:
        exact(
            form,
            ("name", "host", "port", "tlsMode", "username", "password", "senderEmail"),
            ("senderName",),
        )
        name = _check_non_secret_line(form["name"], 120, "SMTP_NAME_INVALID")
        host = clean_host(form["host"])
        port, tls_mode = validate_port_tls(form["port"], form["tlsMode"])
        username = _check_non_secret_line(form["username"], 320, "SMTP_USERNAME_INVALID")
        password = form["password"]
        need(isinstance(password, str) and 1 <= len(password) <= 512 and "\x00" not in password, "SMTP_PASSWORD_INVALID", 422)
        sender_email = clean_email(form["senderEmail"], "SMTP_SENDER_EMAIL_INVALID")
        sender_name = _check_non_secret_line(form.get("senderName", ""), 120, "SMTP_SENDER_NAME_INVALID", allow_empty=True)

        conn_id = str(uuid.uuid4())
        revision = 1
        sealed = self._seal_secret(ctx.company, conn_id, revision, password)
        now = self.clock()
        with self.access(ctx, "write") as (db, _):
            self._require_admin(ctx, db)
            db.execute(
                "INSERT INTO cs_smtp_connections VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,NULL,NULL,NULL,?,?)",
                (
                    conn_id,
                    ctx.company,
                    name,
                    host,
                    port,
                    tls_mode,
                    username,
                    sealed,
                    sender_email,
                    sender_name,
                    "ACTIVE",
                    revision,
                    ctx.actor,
                    ctx.binding,
                    ctx.actor,
                    now,
                    now,
                ),
            )
            row = db.execute("SELECT * FROM cs_smtp_connections WHERE id=? AND company=?", (conn_id, ctx.company)).fetchone()
            return envelope(ctx.company, connection=self._conn_admin_dto(row))

    def update_connection(self, ctx: SmtpContext, conn_id: str, form: dict[str, Any]) -> dict[str, Any]:
        _check_ident(conn_id)
        exact(
            form,
            ("expectedRevision", "name", "host", "port", "tlsMode", "username", "senderEmail"),
            ("password", "senderName"),
        )
        expected_rev = form["expectedRevision"]
        need(type(expected_rev) is int and expected_rev >= 1, "SMTP_REVISION_INVALID", 422)
        name = _check_non_secret_line(form["name"], 120, "SMTP_NAME_INVALID")
        host = clean_host(form["host"])
        port, tls_mode = validate_port_tls(form["port"], form["tlsMode"])
        username = _check_non_secret_line(form["username"], 320, "SMTP_USERNAME_INVALID")
        sender_email = clean_email(form["senderEmail"], "SMTP_SENDER_EMAIL_INVALID")
        sender_name = _check_non_secret_line(form.get("senderName", ""), 120, "SMTP_SENDER_NAME_INVALID", allow_empty=True)
        new_password = form.get("password")
        if new_password is not None and new_password != "":
            need(isinstance(new_password, str) and 1 <= len(new_password) <= 512 and "\x00" not in new_password, "SMTP_PASSWORD_INVALID", 422)
        else:
            new_password = None

        now = self.clock()
        with self.access(ctx, "write") as (db, _):
            self._require_admin(ctx, db)
            row = db.execute("SELECT * FROM cs_smtp_connections WHERE id=? AND company=?", (conn_id, ctx.company)).fetchone()
            need(row is not None, "SMTP_CONNECTION_NOT_FOUND", 404)
            need(row["state"] == "ACTIVE", "SMTP_CONNECTION_REVOKED", 409)
            need(int(row["revision"]) == expected_rev, "REVISION_CONFLICT", 409)
            effective_pw = new_password if new_password is not None else self._open_secret(row)
            next_rev = expected_rev + 1
            sealed = self._seal_secret(ctx.company, conn_id, next_rev, effective_pw)
            db.execute(
                "UPDATE cs_smtp_connections SET name=?,host=?,port=?,tls_mode=?,username=?,secret=?,sender_email=?,sender_name=?,revision=?,updated_by=?,last_test_status=NULL,last_test_code=NULL,last_test_at=NULL,updated_at=? WHERE id=? AND company=?",
                (name, host, port, tls_mode, username, sealed, sender_email, sender_name, next_rev, ctx.actor, now, conn_id, ctx.company),
            )
            db.execute(
                "UPDATE cs_smtp_drafts SET state='SUPERSEDED',updated_at=? WHERE company=? AND connection_id=? AND state IN ('DRAFT','PENDING_APPROVAL','APPROVED')",
                (now, ctx.company, conn_id),
            )
            stale = db.execute(
                "SELECT * FROM cs_smtp_approvals WHERE company=? AND connection_id=? AND state IN ('PENDING','APPROVED')",
                (ctx.company, conn_id),
            ).fetchall()
            db.execute(
                "UPDATE cs_smtp_approvals SET state='CANCELLED',decision_note='CREDENTIAL_REVISION_CHANGED',updated_at=? WHERE company=? AND connection_id=? AND state IN ('PENDING','APPROVED')",
                (now, ctx.company, conn_id),
            )
            for item in stale:
                refreshed = db.execute("SELECT * FROM cs_smtp_approvals WHERE id=?", (item["id"],)).fetchone()
                self._sync_assistant_card(db, self._approval_dto(db, refreshed))
            updated = db.execute("SELECT * FROM cs_smtp_connections WHERE id=? AND company=?", (conn_id, ctx.company)).fetchone()
            return envelope(ctx.company, connection=self._conn_admin_dto(updated))

    def revoke_connection(self, ctx: SmtpContext, conn_id: str, expected_rev: Any) -> dict[str, Any]:
        _check_ident(conn_id)
        need(type(expected_rev) is int and expected_rev >= 1, "SMTP_REVISION_INVALID", 422)
        now = self.clock()
        with self.access(ctx, "write") as (db, _):
            self._require_admin(ctx, db)
            row = db.execute("SELECT * FROM cs_smtp_connections WHERE id=? AND company=?", (conn_id, ctx.company)).fetchone()
            need(row is not None, "SMTP_CONNECTION_NOT_FOUND", 404)
            need(int(row["revision"]) == expected_rev, "REVISION_CONFLICT", 409)
            next_rev = expected_rev + 1
            db.execute(
                "UPDATE cs_smtp_connections SET state='REVOKED',secret=NULL,revision=?,updated_by=?,revoked_by=?,revoked_at=?,updated_at=? WHERE id=? AND company=?",
                (next_rev, ctx.actor, ctx.actor, now, now, conn_id, ctx.company),
            )
            db.execute(
                "UPDATE cs_smtp_drafts SET state='SUPERSEDED',updated_at=? WHERE company=? AND connection_id=? AND state IN ('DRAFT','PENDING_APPROVAL','APPROVED')",
                (now, ctx.company, conn_id),
            )
            stale = db.execute(
                "SELECT * FROM cs_smtp_approvals WHERE company=? AND connection_id=? AND state IN ('PENDING','APPROVED')",
                (ctx.company, conn_id),
            ).fetchall()
            db.execute(
                "UPDATE cs_smtp_approvals SET state='CANCELLED',decision_note='CONNECTION_REVOKED',updated_at=? WHERE company=? AND connection_id=? AND state IN ('PENDING','APPROVED')",
                (now, ctx.company, conn_id),
            )
            for item in stale:
                refreshed = db.execute("SELECT * FROM cs_smtp_approvals WHERE id=?", (item["id"],)).fetchone()
                self._sync_assistant_card(db, self._approval_dto(db, refreshed))
            updated = db.execute("SELECT * FROM cs_smtp_connections WHERE id=? AND company=?", (conn_id, ctx.company)).fetchone()
            return envelope(ctx.company, connection=self._conn_admin_dto(updated))

    async def test_connection(self, ctx: SmtpContext, conn_id: str) -> dict[str, Any]:
        _check_ident(conn_id)
        with self.access(ctx, "write") as (db, _):
            self._require_admin(ctx, db)
            row = db.execute("SELECT * FROM cs_smtp_connections WHERE id=? AND company=?", (conn_id, ctx.company)).fetchone()
            need(row is not None, "SMTP_CONNECTION_NOT_FOUND", 404)
            need(row["state"] == "ACTIVE", "SMTP_CONNECTION_REVOKED", 409)
            password = self._open_secret(row)
            cfg = {
                "host": row["host"],
                "port": int(row["port"]),
                "tls_mode": row["tls_mode"],
                "username": row["username"],
                "password": password,
                "revision": int(row["revision"]),
            }
        now = self.clock()
        try:
            probe = await asyncio.to_thread(
                self.network.test_connection,
                host=cfg["host"],
                port=cfg["port"],
                tls_mode=cfg["tls_mode"],
                username=cfg["username"],
                password=cfg["password"],
            )
        except SmtpFault as exc:
            with self.access(ctx, "write") as (db, _):
                self._require_admin(ctx, db)
                db.execute(
                    "UPDATE cs_smtp_connections SET last_test_status='FAILED',last_test_code=?,last_test_at=?,updated_at=? WHERE id=? AND company=? AND revision=?",
                    (exc.code, now, now, conn_id, ctx.company, cfg["revision"]),
                )
            raise
        with self.access(ctx, "write") as (db, _):
            self._require_admin(ctx, db)
            db.execute(
                "UPDATE cs_smtp_connections SET last_test_status='PASSED',last_test_code='OK',last_test_at=?,updated_at=? WHERE id=? AND company=? AND revision=?",
                (now, now, conn_id, ctx.company, cfg["revision"]),
            )
            row = db.execute("SELECT * FROM cs_smtp_connections WHERE id=? AND company=?", (conn_id, ctx.company)).fetchone()
            return envelope(ctx.company, connection=self._conn_admin_dto(row), test=probe)

    # ---- Bot / native runtime operations ----

    def list_bot_connections(self, ctx: SmtpContext) -> dict[str, Any]:
        with self.access(ctx, "integrations.run") as (db, _):
            rows = db.execute(
                "SELECT * FROM cs_smtp_connections WHERE company=? AND state='ACTIVE' ORDER BY created_at DESC",
                (ctx.company,),
            ).fetchall()
            return envelope(ctx.company, connections=[self._conn_bot_dto(r) for r in rows])

    def prepare_draft(self, ctx: SmtpContext, args: dict[str, Any], request_key: str) -> dict[str, Any]:
        need(bool(ctx.room), "SMTP_CONVERSATION_REQUIRED", 422)
        if ctx.native_scope is not None:
            need(bool(ctx.bot), "SMTP_BOT_REQUIRED", 403)
        exact(args, ("connectionId", "to", "subject"), ("cc", "bcc", "textBody", "htmlBody"))
        conn_id = _check_ident(args["connectionId"])
        _check_ident(request_key)
        to_addrs = clean_recipients(args["to"], "SMTP_TO_REQUIRED", required=True)
        cc_addrs = clean_recipients(args.get("cc"), "SMTP_CC_INVALID", required=False)
        bcc_addrs = clean_recipients(args.get("bcc"), "SMTP_BCC_INVALID", required=False)
        need(len(to_addrs) + len(cc_addrs) + len(bcc_addrs) <= 50, "SMTP_RECIPIENT_LIMIT", 422)
        subject = _check_non_secret_line(args["subject"], 998, "SMTP_SUBJECT_INVALID")
        raw_text = args.get("textBody")
        raw_html = args.get("htmlBody")
        need(raw_text is None or isinstance(raw_text, str), "SMTP_TEXT_BODY_INVALID", 422)
        need(raw_html is None or isinstance(raw_html, str), "SMTP_HTML_BODY_INVALID", 422)
        safe_html = sanitize_html_body(raw_html) if raw_html and raw_html.strip() else None
        text_body = (raw_text or "").replace("\x00", "").strip()
        if not text_body and safe_html:
            text_body = html_to_text(safe_html)
        need(1 <= len(text_body) <= 50000, "SMTP_BODY_REQUIRED", 422)

        with self.access(ctx, "integrations.run") as (db, _):
            conn = db.execute("SELECT * FROM cs_smtp_connections WHERE id=? AND company=?", (conn_id, ctx.company)).fetchone()
            need(conn is not None, "SMTP_CONNECTION_NOT_FOUND", 404)
            need(conn["state"] == "ACTIVE" and conn["secret"] is not None, "SMTP_CONNECTION_REVOKED", 409)
            bot_id = ctx.bot or ""
            review_payload = {
                "companyId": ctx.company,
                "connectionId": conn["id"],
                "connectionRevision": int(conn["revision"]),
                "sourceConversationId": ctx.room,
                "botId": bot_id,
                "actorUserId": ctx.actor,
                "senderEmail": conn["sender_email"],
                "senderName": conn["sender_name"],
                "to": to_addrs,
                "cc": cc_addrs,
                "bcc": bcc_addrs,
                "subject": subject,
                "textBody": text_body,
                "htmlBody": safe_html,
            }
            review_hash = digest(review_payload)
            prior = db.execute("SELECT * FROM cs_smtp_drafts WHERE company=? AND request_key=?", (ctx.company, request_key)).fetchone()
            if prior is not None:
                need(prior["review_hash"] == review_hash, "SMTP_DRAFT_KEY_CONFLICT", 409)
                return envelope(ctx.company, draft=self._draft_dto(prior))
            draft_id = str(uuid.uuid4())
            now = self.clock()
            db.execute(
                "INSERT INTO cs_smtp_drafts VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'DRAFT',1,?,?,?)",
                (
                    draft_id,
                    ctx.company,
                    conn["id"],
                    int(conn["revision"]),
                    ctx.room,
                    bot_id,
                    ctx.actor,
                    ctx.binding,
                    conn["sender_email"],
                    conn["sender_name"],
                    encoded(to_addrs),
                    encoded(cc_addrs),
                    encoded(bcc_addrs),
                    subject,
                    text_body,
                    safe_html,
                    review_hash,
                    request_key,
                    now,
                    now,
                ),
            )
            row = db.execute("SELECT * FROM cs_smtp_drafts WHERE id=?", (draft_id,)).fetchone()
            return envelope(ctx.company, draft=self._draft_dto(row))

    def request_approval(self, ctx: SmtpContext, args: dict[str, Any], request_key: str) -> dict[str, Any]:
        need(bool(ctx.room), "SMTP_CONVERSATION_REQUIRED", 422)
        exact(args, ("draftId",), ("expectedRevision", "note"))
        draft_id = _check_ident(args["draftId"])
        _check_ident(request_key)
        note = _check_non_secret_line(args.get("note", ""), 500, "SMTP_NOTE_INVALID", allow_empty=True)
        with self.access(ctx, "integrations.run") as (db, _):
            draft = db.execute("SELECT * FROM cs_smtp_drafts WHERE id=? AND company=?", (draft_id, ctx.company)).fetchone()
            need(draft is not None, "SMTP_DRAFT_NOT_FOUND", 404)
            need(draft["room"] == ctx.room, "SOURCE_CONVERSATION_CHANGED", 404)
            need(draft["bot"] == (ctx.bot or "") and draft["actor"] == ctx.actor, "SMTP_DRAFT_BINDING_MISMATCH", 403)
            if "expectedRevision" in args:
                need(type(args["expectedRevision"]) is int and int(draft["revision"]) == args["expectedRevision"], "REVISION_CONFLICT", 409)
            prior = db.execute("SELECT * FROM cs_smtp_approvals WHERE company=? AND request_key=?", (ctx.company, request_key)).fetchone()
            if prior is not None:
                need(prior["draft_id"] == draft_id and prior["review_hash"] == draft["review_hash"], "SMTP_APPROVAL_KEY_CONFLICT", 409)
                return envelope(ctx.company, approval=self._approval_dto(db, prior, draft))
            need(draft["state"] == "DRAFT", "SMTP_DRAFT_NOT_EDITABLE", 409)
            conn = db.execute("SELECT * FROM cs_smtp_connections WHERE id=? AND company=?", (draft["connection_id"], ctx.company)).fetchone()
            need(conn is not None and conn["state"] == "ACTIVE" and conn["secret"] is not None, "SMTP_CONNECTION_REVOKED", 409)
            need(int(conn["revision"]) == int(draft["connection_revision"]), "CREDENTIAL_REVISION_CHANGED", 409)

            assistant_msg = getattr(ctx.native_scope, "assistant_message_id", None) if ctx.native_scope is not None else None
            if assistant_msg:
                origin = db.execute("SELECT kind,speaker,deleted FROM cm_messages WHERE id=? AND room=?", (assistant_msg, ctx.room)).fetchone()
                need(origin is not None and origin["kind"] == "agent" and origin["speaker"] == ctx.bot and not origin["deleted"], "ASSISTANT_ORIGIN_CHANGED", 409)
            now = self.clock()
            appr_id = str(uuid.uuid4())
            expires = now + self.approval_ttl
            db.execute(
                "UPDATE cs_smtp_drafts SET state='PENDING_APPROVAL',revision=revision+1,updated_at=? WHERE id=?",
                (now, draft_id),
            )
            db.execute(
                "INSERT INTO cs_smtp_approvals VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'PENDING',NULL,NULL,?,NULL,?,?,?,?)",
                (
                    appr_id,
                    ctx.company,
                    draft_id,
                    int(draft["revision"]) + 1,
                    draft["connection_id"],
                    int(draft["connection_revision"]),
                    ctx.room,
                    draft["bot"],
                    draft["actor"],
                    draft["actor_binding"],
                    assistant_msg,
                    draft["review_hash"],
                    note or None,
                    expires,
                    request_key,
                    now,
                    now,
                ),
            )
            appr = db.execute("SELECT * FROM cs_smtp_approvals WHERE id=?", (appr_id,)).fetchone()
            fresh_draft = db.execute("SELECT * FROM cs_smtp_drafts WHERE id=?", (draft_id,)).fetchone()
            dto = self._approval_dto(db, appr, fresh_draft)
            self._sync_assistant_card(db, dto)
            return envelope(ctx.company, approval=dto)

    # ---- Human review & single-flight send ----

    def get_approval(self, ctx: SmtpContext, approval_id: str) -> dict[str, Any]:
        _check_ident(approval_id)
        with self.access(ctx, "read") as (db, member):
            row = db.execute("SELECT * FROM cs_smtp_approvals WHERE id=? AND company=?", (approval_id, ctx.company)).fetchone()
            need(row is not None, "SMTP_APPROVAL_NOT_FOUND", 404)
            self.store.room(db, member, row["room"])
            if ctx.room is not None:
                need(row["room"] == ctx.room, "SOURCE_CONVERSATION_CHANGED", 404)
            return envelope(ctx.company, approval=self._approval_dto(db, row))

    def decide_approval(self, ctx: SmtpContext, approval_id: str, form: dict[str, Any]) -> dict[str, Any]:
        _check_ident(approval_id)
        exact(form, ("decision", "expectedReviewHash"), ("sourceConversationId", "note"))
        need(ctx.bot is None and ctx.native_scope is None and ctx.session.kind == "jwt", "SMTP_HUMAN_REVIEW_REQUIRED", 403)
        decision = form["decision"]
        need(decision in ("APPROVE", "REJECT"), "SMTP_DECISION_INVALID", 422)
        expected_hash = form["expectedReviewHash"]
        need(isinstance(expected_hash, str) and len(expected_hash) == 64, "SMTP_REVIEW_HASH_INVALID", 422)
        note = _check_non_secret_line(form.get("note", ""), 500, "SMTP_NOTE_INVALID", allow_empty=True)
        now = self.clock()
        expired_error = False
        result_dto: dict[str, Any] | None = None

        with self.access(ctx, "integrations.run") as (db, member):
            caller_scope = self.permission(ctx, db, "integrations.run")
            need(self._is_person_scope(caller_scope), "SMTP_HUMAN_REVIEW_REQUIRED", 403)
            self.permission(ctx, db, "messages.send")
            row = db.execute("SELECT * FROM cs_smtp_approvals WHERE id=? AND company=?", (approval_id, ctx.company)).fetchone()
            need(row is not None, "SMTP_APPROVAL_NOT_FOUND", 404)
            self.store.room(db, member, row["room"])
            if "sourceConversationId" in form:
                need(form["sourceConversationId"] == row["room"], "SOURCE_CONVERSATION_CHANGED", 409)
            need(row["review_hash"] == expected_hash, "SMTP_REVIEW_CHANGED", 409)
            need(row["state"] == "PENDING", "SMTP_APPROVAL_NOT_PENDING", 409)
            if float(row["expires_at"]) <= now:
                db.execute("UPDATE cs_smtp_approvals SET state='EXPIRED',updated_at=? WHERE id=?", (now, approval_id))
                db.execute("UPDATE cs_smtp_drafts SET state='EXPIRED',updated_at=? WHERE id=?", (now, row["draft_id"]))
                refreshed = db.execute("SELECT * FROM cs_smtp_approvals WHERE id=?", (approval_id,)).fetchone()
                self._sync_assistant_card(db, self._approval_dto(db, refreshed))
                expired_error = True
            else:
                if decision == "APPROVE":
                    conn = db.execute("SELECT * FROM cs_smtp_connections WHERE id=? AND company=?", (row["connection_id"], ctx.company)).fetchone()
                    need(conn is not None and conn["state"] == "ACTIVE" and conn["secret"] is not None, "SMTP_CONNECTION_REVOKED", 409)
                    need(int(conn["revision"]) == int(row["connection_revision"]), "CREDENTIAL_REVISION_CHANGED", 409)
                new_state = "APPROVED" if decision == "APPROVE" else "REJECTED"
                db.execute(
                    "UPDATE cs_smtp_approvals SET state=?,approver=?,approver_binding=?,decision_note=?,decided_at=?,updated_at=? WHERE id=?",
                    (new_state, ctx.actor, ctx.binding, note or row["decision_note"], now, now, approval_id),
                )
                db.execute("UPDATE cs_smtp_drafts SET state=?,updated_at=? WHERE id=?", (new_state, now, row["draft_id"]))
                refreshed = db.execute("SELECT * FROM cs_smtp_approvals WHERE id=?", (approval_id,)).fetchone()
                result_dto = self._approval_dto(db, refreshed)
                self._sync_assistant_card(db, result_dto)

        if expired_error:
            raise SmtpFault("SMTP_APPROVAL_EXPIRED", 409)
        assert result_dto is not None
        return envelope(ctx.company, approval=result_dto)

    def send_status(self, ctx: SmtpContext, approval_id: str) -> dict[str, Any]:
        _check_ident(approval_id)
        now = self.clock()
        with self.access(ctx, "integrations.run") as (db, member):
            row = db.execute("SELECT * FROM cs_smtp_approvals WHERE id=? AND company=?", (approval_id, ctx.company)).fetchone()
            need(row is not None, "SMTP_APPROVAL_NOT_FOUND", 404)
            self.store.room(db, member, row["room"])
            if ctx.room is not None:
                need(row["room"] == ctx.room, "SOURCE_CONVERSATION_CHANGED", 404)
            if row["state"] in ("PENDING", "APPROVED") and float(row["expires_at"]) <= now:
                db.execute("UPDATE cs_smtp_approvals SET state='EXPIRED',updated_at=? WHERE id=?", (now, approval_id))
                db.execute("UPDATE cs_smtp_drafts SET state='EXPIRED',updated_at=? WHERE id=?", (now, row["draft_id"]))
                row = db.execute("SELECT * FROM cs_smtp_approvals WHERE id=?", (approval_id,)).fetchone()
                self._sync_assistant_card(db, self._approval_dto(db, row))
            dto = self._approval_dto(db, row)
            return envelope(ctx.company, approval=dto, receipt=dto["receipt"], deliveryVerified=False)

    async def send_approved(
        self,
        ctx: SmtpContext,
        approval_id: str,
        *,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        _check_ident(approval_id)
        key = idempotency_key if idempotency_key is not None else f"approval:{approval_id}"
        _check_ident(key, "SMTP_IDEMPOTENCY_KEY_INVALID")

        now = self.clock()
        early_fault: SmtpFault | None = None
        replay_payload: dict[str, Any] | None = None
        claimed: dict[str, Any] | None = None

        with self.access(ctx, "integrations.run") as (db, member):
            if ctx.bot is None:
                caller_scope = self.permission(ctx, db, "integrations.run")
                need(self._is_person_scope(caller_scope), "SMTP_HUMAN_OR_AUTHORIZED_BOT_REQUIRED", 403)
                self.permission(ctx, db, "messages.send")

            row = db.execute("SELECT * FROM cs_smtp_approvals WHERE id=? AND company=?", (approval_id, ctx.company)).fetchone()
            need(row is not None, "SMTP_APPROVAL_NOT_FOUND", 404)
            self.store.room(db, member, row["room"])
            if ctx.room is not None:
                need(row["room"] == ctx.room, "SOURCE_CONVERSATION_CHANGED", 404)
            if ctx.bot is not None:
                need(row["bot"] == ctx.bot, "SMTP_BOT_BINDING_MISMATCH", 403)

            by_key = db.execute("SELECT * FROM cs_smtp_sends WHERE company=? AND idempotency_key=?", (ctx.company, key)).fetchone()
            if by_key is not None and by_key["approval_id"] != approval_id:
                raise SmtpFault("SMTP_IDEMPOTENCY_KEY_CONFLICT", 409)

            existing = db.execute("SELECT * FROM cs_smtp_sends WHERE approval_id=? AND company=?", (approval_id, ctx.company)).fetchone()
            if existing is not None:
                rec = self._receipt_dto(existing)
                appr_dto = self._approval_dto(db, row, receipt_row=existing)
                if existing["state"] == "SMTP_ACCEPTED":
                    if existing["idempotency_key"] == key:
                        replay_payload = envelope(
                            ctx.company,
                            approval=appr_dto,
                            receipt=rec,
                            idempotentReplay=True,
                            deliveryVerified=False,
                        )
                    else:
                        early_fault = SmtpFault("SMTP_APPROVAL_ALREADY_SENT", 409, receipt=rec)
                elif existing["state"] in ("SENDING", "UNCERTAIN"):
                    early_fault = SmtpFault("SMTP_SEND_UNCERTAIN_NO_RETRY", 409, receipt=rec)
                else:
                    early_fault = SmtpFault("SMTP_APPROVAL_CLOSED", 409, receipt=rec)
            elif row["state"] == "REJECTED":
                early_fault = SmtpFault("SMTP_APPROVAL_REJECTED", 409)
            elif row["state"] == "EXPIRED":
                early_fault = SmtpFault("SMTP_APPROVAL_EXPIRED", 409)
            elif row["state"] == "CANCELLED":
                early_fault = SmtpFault("SMTP_CONNECTION_REVOKED", 409)
            elif row["state"] == "PENDING":
                if float(row["expires_at"]) <= now:
                    db.execute("UPDATE cs_smtp_approvals SET state='EXPIRED',updated_at=? WHERE id=?", (now, approval_id))
                    db.execute("UPDATE cs_smtp_drafts SET state='EXPIRED',updated_at=? WHERE id=?", (now, row["draft_id"]))
                    refreshed = db.execute("SELECT * FROM cs_smtp_approvals WHERE id=?", (approval_id,)).fetchone()
                    self._sync_assistant_card(db, self._approval_dto(db, refreshed))
                    early_fault = SmtpFault("SMTP_APPROVAL_EXPIRED", 409)
                else:
                    early_fault = SmtpFault("SMTP_APPROVAL_REQUIRED", 409)
            elif row["state"] != "APPROVED":
                early_fault = SmtpFault("SMTP_APPROVAL_NOT_SENDABLE", 409)
            elif float(row["expires_at"]) <= now:
                db.execute("UPDATE cs_smtp_approvals SET state='EXPIRED',updated_at=? WHERE id=?", (now, approval_id))
                db.execute("UPDATE cs_smtp_drafts SET state='EXPIRED',updated_at=? WHERE id=?", (now, row["draft_id"]))
                refreshed = db.execute("SELECT * FROM cs_smtp_approvals WHERE id=?", (approval_id,)).fetchone()
                self._sync_assistant_card(db, self._approval_dto(db, refreshed))
                early_fault = SmtpFault("SMTP_APPROVAL_EXPIRED", 409)
            else:
                need(row["approver"] is not None and row["approver_binding"] is not None, "SMTP_APPROVAL_REQUIRED", 409)
                approver_member = self.store.authority.require_member(row["approver"], ctx.company)
                need(approver_member.binding == row["approver_binding"], "SMTP_APPROVER_REVOKED", 403)
                approver_ctx = SmtpContext(ctx.company, row["approver"], approver_member.binding, None, row["room"], None, None)
                approver_scope = self.permission(approver_ctx, db, "integrations.run")
                need(self._is_person_scope(approver_scope), "SMTP_APPROVER_REVOKED", 403)
                self.permission(approver_ctx, db, "messages.send")

                orig_actor = self.store.authority.require_member(row["actor"], ctx.company)
                need(orig_actor.binding == row["actor_binding"], "SMTP_ACTOR_REVOKED", 403)
                orig_ctx = SmtpContext(ctx.company, row["actor"], orig_actor.binding, None, row["room"], row["bot"] or None, None)
                self.permission(orig_ctx, db, "integrations.run")
                if row["bot"]:
                    self.store.agent(db, orig_actor, row["room"], row["bot"])

                draft = db.execute("SELECT * FROM cs_smtp_drafts WHERE id=? AND company=?", (row["draft_id"], ctx.company)).fetchone()
                need(draft is not None and draft["review_hash"] == row["review_hash"], "SMTP_REVIEW_CHANGED", 409)

                conn = db.execute("SELECT * FROM cs_smtp_connections WHERE id=? AND company=?", (row["connection_id"], ctx.company)).fetchone()
                if conn is None or conn["state"] != "ACTIVE" or conn["secret"] is None:
                    early_fault = SmtpFault("SMTP_CONNECTION_REVOKED", 409)
                elif int(conn["revision"]) != int(row["connection_revision"]):
                    early_fault = SmtpFault("CREDENTIAL_REVISION_CHANGED", 409)
                else:
                    password = self._open_secret(conn)
                    send_id = str(uuid.uuid4())
                    db.execute(
                        "INSERT INTO cs_smtp_sends VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'SENDING',NULL,0,1,NULL,NULL,NULL,NULL,NULL,NULL,NULL,?,NULL)",
                        (
                            send_id,
                            ctx.company,
                            approval_id,
                            row["draft_id"],
                            conn["id"],
                            int(conn["revision"]),
                            row["room"],
                            row["bot"],
                            row["actor"],
                            row["approver"],
                            row["review_hash"],
                            key,
                            now,
                        ),
                    )
                    db.execute("UPDATE cs_smtp_approvals SET state='SENDING',updated_at=? WHERE id=?", (now, approval_id))
                    claimed = {
                        "send_id": send_id,
                        "conn_id": conn["id"],
                        "conn_rev": int(conn["revision"]),
                        "host": conn["host"],
                        "port": int(conn["port"]),
                        "tls_mode": conn["tls_mode"],
                        "username": conn["username"],
                        "password": password,
                        "sender_email": draft["sender_email"],
                        "sender_name": draft["sender_name"],
                        "to_addrs": json.loads(draft["to_addrs"]),
                        "cc_addrs": json.loads(draft["cc_addrs"]),
                        "bcc_addrs": json.loads(draft["bcc_addrs"]),
                        "subject": draft["subject"],
                        "text_body": draft["text_body"],
                        "html_body": draft["html_body"],
                        "room": row["room"],
                        "bot": row["bot"],
                        "actor": row["actor"],
                        "actor_binding": row["actor_binding"],
                        "approver": row["approver"],
                        "approver_binding": row["approver_binding"],
                    }

        if replay_payload is not None:
            return replay_payload
        if early_fault is not None:
            raise early_fault
        assert claimed is not None

        def preflight() -> None:
            with self.store.db(readonly=True) as db:
                conn_now = db.execute(
                    "SELECT state,revision,secret FROM cs_smtp_connections WHERE id=? AND company=?",
                    (claimed["conn_id"], ctx.company),
                ).fetchone()
                need(conn_now is not None and conn_now["state"] == "ACTIVE" and conn_now["secret"] is not None, "SMTP_CONNECTION_REVOKED", 409)
                need(int(conn_now["revision"]) == claimed["conn_rev"], "CREDENTIAL_REVISION_CHANGED", 409)
                appr_now = db.execute("SELECT state FROM cs_smtp_approvals WHERE id=? AND company=?", (approval_id, ctx.company)).fetchone()
                need(appr_now is not None and appr_now["state"] == "SENDING", "SMTP_APPROVAL_CHANGED", 409)
                appr_ctx = SmtpContext(ctx.company, claimed["approver"], claimed["approver_binding"], None, claimed["room"], None, None)
                self.permission(appr_ctx, db, "integrations.run")
                self.permission(appr_ctx, db, "messages.send")
                approver_now = self.store.authority.require_member(claimed["approver"], ctx.company)
                need(approver_now.binding == claimed["approver_binding"], "SMTP_APPROVER_REVOKED", 403)
                if ctx.native_scope is not None:
                    bot_ctx = SmtpContext(ctx.company, ctx.actor, ctx.binding, None, claimed["room"], ctx.bot, ctx.native_scope)
                    self.permission(bot_ctx, db, "integrations.run")

        try:
            outcome = await asyncio.to_thread(
                self.network.send_email,
                host=claimed["host"],
                port=claimed["port"],
                tls_mode=claimed["tls_mode"],
                username=claimed["username"],
                password=claimed["password"],
                sender_email=claimed["sender_email"],
                sender_name=claimed["sender_name"],
                to_addrs=claimed["to_addrs"],
                cc_addrs=claimed["cc_addrs"],
                bcc_addrs=claimed["bcc_addrs"],
                subject=claimed["subject"],
                text_body=claimed["text_body"],
                html_body=claimed["html_body"],
                preflight=preflight,
            )
        except BaseException:
            fail_time = self.clock()
            with self.store.db() as db:
                db.execute(
                    "UPDATE cs_smtp_sends SET state='UNCERTAIN',error_code='SMTP_INTERNAL_ERROR',completed_at=? WHERE id=? AND state='SENDING'",
                    (fail_time, claimed["send_id"]),
                )
                db.execute(
                    "UPDATE cs_smtp_approvals SET state='UNCERTAIN',updated_at=? WHERE id=? AND state='SENDING'",
                    (fail_time, approval_id),
                )
            raise

        done_at = self.clock()
        final_state = outcome["state"]
        with self.store.db() as db:
            smtp_acc_sql = None if outcome["smtpAccepted"] is None else (1 if outcome["smtpAccepted"] else 0)
            db.execute(
                "UPDATE cs_smtp_sends SET state=?,smtp_accepted=?,delivery_verified=0,smtp_code=?,smtp_message=?,error_code=?,message_id_header=?,resolved_ip=?,tls_protocol=?,tls_cipher=?,completed_at=? WHERE id=?",
                (
                    final_state,
                    smtp_acc_sql,
                    outcome["smtpCode"],
                    outcome["smtpMessage"],
                    outcome["errorCode"],
                    outcome["messageIdHeader"],
                    outcome["resolvedIp"],
                    outcome["tlsProtocol"],
                    outcome["tlsCipher"],
                    done_at,
                    claimed["send_id"],
                ),
            )
            db.execute("UPDATE cs_smtp_approvals SET state=?,updated_at=? WHERE id=?", (final_state, done_at, approval_id))
            appr_row = db.execute("SELECT * FROM cs_smtp_approvals WHERE id=?", (approval_id,)).fetchone()
            send_row = db.execute("SELECT * FROM cs_smtp_sends WHERE id=?", (claimed["send_id"],)).fetchone()
            appr_dto = self._approval_dto(db, appr_row, receipt_row=send_row)
            self._sync_assistant_card(db, appr_dto)
            rec_dto = appr_dto["receipt"]

        if final_state == "SMTP_ACCEPTED":
            return envelope(
                ctx.company,
                approval=appr_dto,
                receipt=rec_dto,
                idempotentReplay=False,
                deliveryVerified=False,
            )

        raise SmtpFault(
            outcome["errorCode"] or "SMTP_SEND_FAILED",
            int(outcome.get("httpStatus") or 502),
            receipt=rec_dto,
        )

    def has_active_connection(self, company: str) -> bool:
        with self.store.db(readonly=True) as db:
            row = db.execute(
                "SELECT 1 FROM cs_smtp_connections WHERE company=? AND state='ACTIVE' LIMIT 1",
                (company,),
            ).fetchone()
            return row is not None

    def list_receipts(self, ctx: SmtpContext, *, room_id: str | None = None) -> dict[str, Any]:
        with self.access(ctx) as (db, member):
            if room_id:
                _check_ident(room_id)
                self.store.room(db, member, room_id)
                self.permission(ctx, db, "integrations.run")
                rows = db.execute(
                    "SELECT * FROM cs_smtp_sends WHERE company=? AND room=? ORDER BY created_at DESC LIMIT 50",
                    (ctx.company, room_id),
                ).fetchall()
            else:
                self._require_admin(ctx, db)
                rows = db.execute(
                    "SELECT * FROM cs_smtp_sends WHERE company=? ORDER BY created_at DESC LIMIT 50",
                    (ctx.company,),
                ).fetchall()
            return envelope(ctx.company, receipts=[self._receipt_dto(r) for r in rows])
