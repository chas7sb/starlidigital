# QA tooling

Run from the project root with Python 3.11+:

    python qa/source_contract.py --output qa/results/source-contract.json
    python qa/source_contract.py --base-url http://127.0.0.1:8080 --output qa/results/local-smoke.json

The first command is offline/read-only against extracted dashboard source. The second additionally fetches only root, auth and config on localhost; it never signs in, changes data, sends messages or reaches production. Exit 1 means a missing source/action/route or failed HTTP smoke. Reports always say NOT_VERIFIED: a passing source contract is not feature parity. Reworked source can require reviewed baseline updates rather than blind symbol preservation.

Source evidence was collected read-only from the active dashboard on 2026-11-22. backend-routes.json includes 708 literal Python route declarations; local paths require mount-prefix resolution. panels.json covers all 29 Starli panel components. ui-files.txt is the exact observed route/Starli component file list. No production data, customer records or credentials are included. Manual and clean-install acceptance is in docs/feature-parity.md.
