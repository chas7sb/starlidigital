# Bundled font notices

Applies to files under `dashboard/backend/open_webui/static/fonts/`. Keep this directory in source and binary distributions that contain these fonts. Original font files and their embedded metadata were not modified. Exact upstream binary commits have not been established; the evidence below combines embedded metadata from these exact files with official upstream license snapshots. Retrieval URLs are pinned to commits where applicable in `retrieval-manifest.json`; `font-metadata.json` binds each bundled file to its SHA-256 and extracted SFNT name-table records.

| Exact filenames | Embedded family/version | Applicable notice |
| --- | --- | --- |
| `NotoSans-Bold.ttf`, `NotoSans-Italic.ttf`, `NotoSans-Regular.ttf`, `NotoSans-Variable.ttf` | Noto Sans, 2.013 | `NotoSans-OFL.txt` |
| `NotoSansJP-Regular.ttf`, `NotoSansJP-Variable.ttf` | Noto Sans JP / Noto Sans JP Thin, 2.004-H2 | `NotoSansCJK-OFL.txt` plus copyright below |
| `NotoSansKR-Regular.ttf`, `NotoSansKR-Variable.ttf` | Noto Sans KR / Noto Sans KR Thin, 2.004-H2 | `NotoSansCJK-OFL.txt` plus copyright below |
| `NotoSansSC-Regular.ttf`, `NotoSansSC-Variable.ttf` | Noto Sans SC / Noto Sans SC Thin, 2.004-H2 | `NotoSansCJK-OFL.txt` plus copyright below |
| `Twemoji.ttf` | Twemoji Mozilla, 0.7.0 | `Twemoji-Mozilla-LICENSE.md`, `Twemoji-Apache-2.0.txt`, `Twemoji-CC-BY-4.0.txt` |

Noto Sans embedded copyright (all four files):

> Copyright 2022 The Noto Project Authors (https://github.com/notofonts/latin-greek-cyrillic)

CJK embedded copyright (all six JP/KR/SC files):

> (c) 2014-2021 Adobe (http://www.adobe.com/), with Reserved Font Name 'Source'.

All ten Noto files explicitly identify SIL Open Font License 1.1 in their embedded license field. Official texts recovered from [Noto Latin/Greek/Cyrillic](https://github.com/notofonts/latin-greek-cyrillic/blob/main/OFL.txt) and [Noto CJK Sans](https://github.com/notofonts/noto-cjk/blob/main/Sans/LICENSE).

The official [Twemoji Mozilla notice](https://github.com/mozilla/twemoji-colr/blob/master/LICENSE.md) names Mozilla Foundation (2016–2018), identifies Apache 2.0 for code, and identifies the emoji artwork as from [Twemoji](https://github.com/twitter/twemoji) under CC BY 4.0. Preserve attribution to Mozilla Foundation and the Twemoji project; retain links and the included license texts. Twemoji.ttf lacks an embedded license/copyright field, so exact release-to-binary matching remains unverified. No claim is made about changes made before this extraction.

These notices do not replace dashboard, SearXNG, OpenPencil, npm, Python or other asset notices. Apache 2.0 selected for StarliDigital-owned code does not relicense these fonts.
