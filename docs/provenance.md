# Source provenance and extraction review

Observed read-only through StarliDigital source tools on 2026-11-22. This records deployed filesystem evidence, not a verified upstream Git revision or legal conclusion. No production files, services or ledgers were modified by this audit.

| Component | Resolved source | Observed metadata |
| --- | --- | --- |
| Starli platform/API | `/srv/starlidigital/releases/native-customer-oauth-dev-v34-20261118` via `/srv/starlidigital/current` | Root `starlidigital-platform` 0.1.0; private true; no root license field |
| Company dashboard | `/srv/starlidigital/webui-releases/native-company-mcp-always-v33-20261119` via `/srv/starlidigital/webui-current` | Root package `open-webui` 0.6.5; root LICENSE present |

The API root, CLI, device and web package manifests observed had no license field and declared private true. No LICENSE/NOTICE/COPYING file was found in the API scan outside dependency trees. On 2026-11-22 the user explicitly selected Apache License 2.0 for StarliDigital-owned code, as relayed by Prime. Prime owns the scoped root LICENSE/NOTICE integration. This choice does not relicense upstream code, fonts, artwork or dependencies; preserve their existing notices and terms.

The dashboard LICENSE names Timothy Jaeryang Baek, copyright 2023–2025, and contains redistribution conditions, attribution/non-endorsement text and a warranty disclaimer. Retain its exact full text with the extracted dashboard and applicable binary distribution documentation. The deployed file is evidence; upstream repository, exact commit/tag and local modifications have not been verified. Package version alone does not establish source identity. This audit does not assign an SPDX identifier or conclude license compatibility.

## Fingerprints of observed files

| Component/file | SHA-256 |
| --- | --- |
| API package.json | `c19df2d1c99168747637125895f869151b09d7a6a71ae0559d17a41717e0e8f2` |
| API package-lock.json | `68176af57c33f86aeb94adc5eb2d53efdcb6b79e003d590efafd0bd54501b162` |
| Dashboard LICENSE | `6c4b8d8034b9a5795643e1771716689a22638a7d6779d422136a008ecfaf3951` |
| Dashboard package.json | `b2e4640ecff3b1592a8ad834040b993d8a2b6ec4073c9f519fa2ba1555dad03b` |
| Dashboard package-lock.json | `b6ee060eee0ccd0921d35c1024efc3650d623e867e3e4c347ac85b557c132504` |
| Dashboard pyproject.toml | `6767f37b518c30b3e4a667bf5cd402bcbe34f7b0ba5323a78d6f68f140596665` |
| Dashboard backend/requirements.txt | `930e16bf62b78e22bb647a969aed0c6dc03d22b748af1b42fad24940ff6d8bc5` |

## Dependency and asset notice gaps

API npm lock contained 440 non-root package entries, including 10 without a license declaration. Dashboard lock contained 1,053 entries, including 709 without a declaration. Declared expressions include permissive, copyleft, font and attribution license strings; declarations are inventory evidence, not reviewed license texts. Python dependencies and vendored Pyodide, font and media notices remain unverified. Use `security/dependency_inventory.py` on staged lockfiles to enumerate individual packages; inspect installed distribution notices without importing application code. Preserve all required copyright and notice files. A new root license must not replace upstream/dependency notices.

## Scan results and boundaries

API scan: 334 files; 322 text scanned; 8 oversized; 4 binary. Dashboard scan: 10,318 files; 10,103 text scanned; 39 oversized; 176 binary. See `../security/` reports and README for limits and candidate paths. Dashboard scan produced 406 candidates: 54 email, 176 binary, 39 oversized, 116 credential-URL, 13 credential-literal, 7 runtime/archive and 1 provider-token pattern. These categories include tests and generated baseline bundles; no finding alone confirms a live secret.

Priority review includes `backend/tests/test_starli_result_status.py` (provider-token pattern), credential-like literals in tests and baseline bundles, and API `server/src/operator-auth.ts` and `server/src/oauth/index.ts`. Never include matched values in public reports. Scan the final extracted tree again after all agents finish; these reports concern deployed snapshots, not a final publication artifact.

Keep operational MCP workspaces, ledgers, customer runtime state, credentials and production config outside the copy boundary. Retain sanitized source and schema only. Marketing assets are outside the requested product scope. Source mapping, exact upstream revision, full third-party notices, manual data review, final local scan and final Git-history/archive review remain open release gates. The owner has now chosen Apache 2.0 specifically for StarliDigital-owned code.

## Local extraction review update

The local extraction includes the active MCP control-plane rooted at `/srv/starlidigital/releases/20261109-luna-openwebui-writes/control-plane`, not just the inactive control-plane in the base API release. AgentX 3 records this source selection in its extraction manifests. Extension sources include Mission Control, OpenPencil and SearXNG/search. Preserve their component-specific licenses/notices; earlier base-release scan counts do not cover these sources.

`security/local-dashboard-scan.json`, `security/local-platform-scan.json` and `security/local-supporting-scan.json` concern the extracted tree. `security/review-dispositions.json` binds reviewed candidates to file hashes and lists concrete owner actions. Test tokens were classified from test/mock/assertion context; token-prefix concatenation with random bytes is not an issued credential. No live secret was tested. Runtime files generated by installation/tests are present locally and must remain excluded from Git and archives.

Official Noto and Twemoji notices were recovered into `security/THIRD_PARTY_NOTICES/`. Exact font names, embedded copyright/version/license fields and file hashes are recorded in `font-metadata.json`; official notice retrievals are commit-pinned where possible. The ten Noto files explicitly embed OFL 1.1 declarations. Twemoji Mozilla 0.7.0 lacks embedded license metadata; official Mozilla/Twemoji notices are included, while exact binary-to-upstream-revision matching remains unverified. This resolves missing notice text, not every asset provenance question.

## Source publication readiness scope — supersedes broad gate wording above

The user authorized open-source publication and chose Apache 2.0 for StarliDigital-owned code. The release under review is a source repository/source ZIP. It does not bundle installed npm/pip dependency trees, model weights, VM images, native executable installers or container images. Lockfiles and requirements describe packages fetched separately by the install/build process. Completing an exhaustive notice inventory for those separately obtained packages is follow-up work for a future bundled distribution, not an identified missing-notice blocker for this source extraction.

Required evidence for this source publication is concrete: retain the scoped root LICENSE/NOTICE; preserve observed licenses/copyright notices for included third-party source; include recovered notices for bundled fonts; exclude runtime/customer data and credential files; remediate actionable embedded-secret findings; and ensure the published index/archive uses the reviewed bytes. These checks have no currently identified unresolved secret/customer-data or missing component-license finding in the reviewed snapshot. The index audit records its exact scope and fingerprint, so later source additions must be checked on their own merits.

Observed retained component texts include dashboard/LICENSE, the OpenPencil MIT license, and the SearXNG GNU Affero General Public License version 3 text. Those components keep their own notices and terms; root Apache 2.0 is not a blanket replacement. This is a factual notice inventory, not a legal compatibility conclusion.

Exact historical upstream commit recovery, fuller attribution indexing and exact font-binary-to-upstream-commit matching are desirable provenance improvements. Their absence is explicitly documented and does not, by itself, block publishing this authorized source extraction with applicable observed/recovered notice texts retained. No missing license should be invented to close a record.

Final artifact verification is a bounded packaging check: confirm its source manifest matches the intended reviewed index and includes the notice files, while containing no runtime/data/credential files. This does not require installation parity to be complete before a truthful source-development repository can be published. Native installers, runnable-product claims and future bundled binaries/images need the validation appropriate to those deliverables.
