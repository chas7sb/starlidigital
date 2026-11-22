# QA tooling

Run from the project root with Python 3.11+:

    python qa/source_contract.py --output qa/results/source-contract.json
    python qa/source_contract.py --base-url http://127.0.0.1:8080 --output qa/results/local-smoke.json

The first command is offline/read-only against extracted dashboard source. The second additionally fetches only root, auth and config on localhost; it never signs in, changes data, sends messages or reaches production. Exit 1 means a missing source/action/route or failed HTTP smoke. Reports always say NOT_VERIFIED: a passing source contract is not feature parity. Reworked source can require reviewed baseline updates rather than blind symbol preservation.

## Disposable actual feature checks

After AgentX10 successfully retains a fresh onboarding/qa_e2e.py --serve instance on18280/18281:

    python qa/disposable_features.py --state work/onboarding-e2e-INSTANCE --video-render

This reads credentials through onboarding's private-file helper and signs in in memory. It requires successful disposable core/serve evidence and the exact two test origins. It creates uniquely named synthetic CRM/project/hosted-agent/video records, verifies actual readback, project file hashes/CAS and optional tiny local video output; it only reads unconfigured billing/mail/social states. It never invokes mail/social/provider sends, inference, publication or billing actions. It leaves records inside the disposable instance for review and does not retry uncertain mutations. Raw receipts and PNGs use protected private storage; the public report has selected evidence only. All reports remain NOT_VERIFIED for overall parity.

Read qa/action-failures.md for observed owner-specific blockers. Catalog subprocess diagnosis can run with qa/diagnose_tool_bridge.py --state same-directory; --systemroot tests Windows initialization separately without changing application source. Raw process output remains private. Never pass passwords/tokens as CLI arguments or print credential files.

Independent backend actions use `python qa/disposable_node_features.py --state work/onboarding-e2e-INSTANCE`. They authenticate with an in-memory cookie jar against Node18281, create synthetic CRM and draft hosted-agent configuration, cross-check dashboard CRM readback and generate a tiny240x240 local video without external inputs. This does not substitute for a failing dashboard tool bridge. `python qa/verify_video_artifact.py --artifact-dir work/onboarding-e2e-INSTANCE/feature-smoke-ID` validates private PNG dimensions and fully decodes the actual downloaded MP4 with FFmpeg; ffprobe metadata is recorded when available. Public reports contain selected results, no cookies/passwords/tokens; full receipts/media remain private. See action-failures.md for executed results and metadata discrepancy.

Latest representative dashboard checks all passed after owner source fixes/reload. `--catalog-only` performs auth+catalog without mutations; `--preview-project vproj-ID` retries validation+PNG for an existing synthetic test video with the required operationKey. `python qa/aggregate_features.py` combines the actual base execution and targeted preview correction only when project/origin match, preserving source-report attribution and historical failure. It does not execute tests or certify full parity. Overall status remains NOT_VERIFIED for untested feature/OS/UI/VM surfaces.

Final validation is now a single complete10/10 dashboard execution; aggregation uses only that successful full report. `verify_video_artifact.py --dashboard --artifact-dir ...` verifies that run's actual downloaded media and its private tool-detail receipt metadata against canvas. All initially diagnosed app blockers are closed by actual execution; earlier failed attempts remain documented as history in action-failures.md.

Source evidence was collected read-only from the active dashboard on 2026-11-22. backend-routes.json includes 708 literal Python route declarations; local paths require mount-prefix resolution. panels.json covers all 29 Starli panel components. ui-files.txt is the exact observed route/Starli component file list. No production data, customer records or credentials are included. Manual and clean-install acceptance is in docs/feature-parity.md.
