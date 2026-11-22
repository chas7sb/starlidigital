# New product asset notices

Preserve these notices together with `product/LICENSE.upstream` and the scoped root LICENSE/NOTICE. The product base asset manifest records original hashes; no font/emoji asset was modified by this audit.

| Included product files | Notice |
| --- | --- |
| `product/static/assets/fonts/Archivo-Variable.ttf` | `Archivo-OFL.txt` |
| `product/static/assets/fonts/InstrumentSerif-Regular.ttf`, `InstrumentSerif-Italic.ttf` | `InstrumentSerif-OFL.txt` |
| `product/static/assets/fonts/Inter-Variable.ttf` | `Inter-OFL.txt` |
| `product/static/assets/fonts/Mona-Sans.woff2` | `MonaSans-OFL.txt` |
| `product/static/assets/emojis/*.svg` | Retain Twemoji project attribution and `../Twemoji-CC-BY-4.0.txt`; original artwork is from the Twemoji project (https://github.com/twitter/twemoji). No artwork change in extraction. |

Official font license texts were recovered from Google Fonts and GitHub Mona Sans. Retrieval URLs, commit IDs and hashes are in `retrieval-manifest.json`; exact local font hashes and TTF embedded notices are in `font-metadata.json`. Exact source revision of each font binary remains unverified and disclosed, without treating that alone as a publication blocker. The WOFF2 metadata was not decoded; official Mona Sans notice is retained.

`product/static/sheets/THIRD_PARTY_NOTICES.txt` already contains the embedded Sheets dependency notices; retain it with the Sheets JS/CSS. The two noVNC source TGZs under `product/static/vendor/` retain their own root license, MPL/OFL/BSD texts and pako notice inside each archive; retain those archive contents. These vendored assets are actually bundled, unlike separately installed npm/pip dependencies. Root Apache 2.0 does not replace any of these terms.

This is a factual notice map; it does not invent licenses for brand/audio/video content or provide a legal compatibility opinion. Brand/audio/video origins and file hashes are recorded in the base-asset manifest. The owner's Apache choice for Starli-owned code does not assign a license to third-party media.
