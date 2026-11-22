# Extraction review tools

Run with Python 3 on Windows, macOS or Linux; no packages, network, server mutations or application startup are required.

```sh
python security/scan.py PATH_TO_STAGED_EXTRACTION > security/local-scan.json
python security/dependency_inventory.py PATH_TO_PACKAGE_LOCK > security/dependency-inventory.json
python -m unittest discover -s security -p test_scan.py
```

The scanner exits 1 when review candidates exist, 0 when no configured patterns match, and 2 for invalid CLI usage. Exit 1 is an audit result, not a scanner crash. Outputs include relative paths and finding types, never matched source lines or values. Paths themselves may be identifying: keep reports internal until reviewed.

Scan covers readable UTF-8 files up to 2 MB. It excludes dependency trees and VCS history, does not follow symlinks, and reports skipped binary/large files. It cannot certify absence of secrets or customer data. Email patterns, test credentials, schema SQL and placeholders can be false positives. Review source privately; do not paste matched values into issues or reports. File names and credential patterns do not identify every secret format.

For large trees, `--progress` writes relative paths only to stderr. Scan selected source roots separately to keep local VM images, vendor installs and test runtime state out of source-review counts. Local scan reports deliberately include generated data if present so packaging exclusions can be checked. `build_dispositions.py` materializes this audit's reviewed decisions; it is an audit record generator, not a general automatic secret-clearance policy. Reusing decisions requires reviewing source changes and fingerprints again.

`deployed-api-scan.json` is the full API release report. `deployed-dashboard-scan.json` contains dashboard counts and only the first 25 findings; `dashboard-priority-review.json` retains all provider-token, credential-literal, credential-file and runtime/archive candidates from that scan. Re-run on the final local extraction for a complete untruncated report.

Release boundary: copy selected application source, schemas, synthetic fixtures, manifests and required notices. Exclude environment files, credentials, private keys, real databases/dumps, uploads, user workspaces, sessions, browser profiles, recordings, logs, operational memory/ledgers, customer email/CRM/proposals and deployment backups. Do not copy `/srv/starlidigital/mcp-workspace` wholesale. Rebuild generated bundles from reviewed source. Review vendored Pyodide archives, fonts, media and their notices separately. Keep schema SQL only after verifying it contains schema rather than customer rows.

Before publication: resolve all findings against the final staged tree; inventory dependency and asset notices (including Python and bundled binaries); retain the exact upstream LICENSE; decide the license for original Starli changes with the rights holder; review Git history and the final archive separately. No release gate is passed by a clean pattern scan alone.
