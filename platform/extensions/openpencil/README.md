# StarliDigital OpenPencil installation

OpenPencil 0.16.0 web editor and official `@open-pencil/mcp@0.16.0`.

Run on the VPS as root:

```bash
bash /srv/starlidigital/mcp-workspace/openpencil/deploy/install-root.sh
```

Then open https://starlidigital.ro/openpencil/ using the username and password printed by the command. The installer adds one location to the existing HTTPS virtual host, validates Nginx before reload, backs up its original configuration, and enables two unprivileged systemd services.

The web editor listens on 127.0.0.1:17601; authenticated MCP listens on 127.0.0.1:17600. Keep the editor open when using MCP. This is a shared editor workspace with browser-local tabs and recovery; it is not the OpenPencil Cloud multi-account service. Server-saved designs live in `documents/` as editable `.fig` files. MCP file operations are restricted to this folder. The eval tool remains disabled.

The browser build includes a small integration for the `/openpencil/` route, authenticated browser-to-MCP WebSocket proxy, and saving documents to the VPS. The actual MCP bearer token stays on the server. Browser login is separate from the StarliDigital account login. Third-party AI providers still require their own credentials if used.

The VPS connector can call MCP without exposing its token:

```bash
python3 /srv/starlidigital/mcp-workspace/openpencil/runtime/mcp-call.py --list
python3 /srv/starlidigital/mcp-workspace/openpencil/runtime/mcp-call.py list_documents '{}'
```

Service status and logs:

```bash
systemctl status openpencil-web openpencil-mcp --no-pager
journalctl -u openpencil-web -u openpencil-mcp -n 60 --no-pager
```

Validation completed before activation: production editor build; installation archive SHA-256; HTTP authentication and scoped file operations; MCP initialization and 132 registered tools; shell and Python syntax. Public HTTPS and the live browser connection must be checked after the root activation command.

Backup `documents/` and `state/config.json` securely. The distribution archive contains no credentials, user documents, dependency cache, or browser history. Upstream source: https://github.com/open-pencil/open-pencil/tree/v0.16.0 (MIT).
