# Enterprise file editor: current native contract

Actual app files: `src/lib/components/enterprise/editors/enterpriseFileClient.ts` and `CodeFileEditor.svelte`. No old panel UI changes or package upgrades. Component props: canonical `resource:{scope:'company',ownerId,kind:'file',id}`, selected `companyId`, optional `readOnly`, optional native `tokenNow()`. Events `loaded`, `saved`, `revoked` include the exact ref/revision. Root owns the right-pane/message/file routing. Mount keyed by account + company + resource; destroy on account/company change. Never supply arbitrary URL/path/model-created ID as a file.

## Scoped routes actually used

- GET `/api/v1/panels/company/{company}/file/{id}/snapshot` → verified `{scope,ownerId,ref,revision,value:{id,company,kind,title,version,...}}`. Current Drive has no GET `/drive/{id}` metadata route.
- GET `/api/v1/companies/{company}/capabilities` → `{company_id,capabilities:[...]}`. `files.manage` is required for writes but is not a resource-owner grant.
- GET `/api/v1/companies/{company}/drive/{id}/content?version={revision}` → exact authorized immutable-revision bytes + MIME. A stale head rejects409.
- POST `/api/v1/companies/{company}/drive/{id}/versions`, JSON `{version:expectedRevision,data:base64Utf8,mime}` → `{contract:'starli.company-drive.v2',data:{id,company,kind:'file',version:expectedRevision+1,title,...}}`. Actual Drive7 transaction rechecks membership, resource ownership/channel ACL, quota, version CAS, private blob write and durable `file.updated` event. Storage failure507 remains visible; no automatic write retry.
- GET `/api/v1/panels/company/{company}/file/{id}/events?after={cursor}` and GET `/api/v1/companies/{company}/drive/events?after={cursor}` exist, but are polling endpoints, not WebSockets/SSE. Drive events filter inaccessible refs and return reset:true. No revocation tombstone can be trusted as complete. Editor therefore reauthorizes the exact metadata every3seconds; denial401/403/404 clears CodeMirror DOM, text/draft buffers and timers.

Knowledge `/drive/{id}/document` edits plain `knowledge.body` with metadata revision and is not this byte-file writer. Never send file bytes there.

## Supported now

CodeMirror6 installed dependencies supply JS/TS/JSX, XML, JSON and plain text modes. Only UTF-8 actual server file bytes are loaded; binary/PDF/image/audio/video/null-byte content is refused with a specialized-viewer message. Editor limit2MiB (server binary limit16MiB). Current native MIME allowlist accepts text/plain, text/markdown and application/octet-stream for this writer; do not silently rewrite a stored MIME type. JSON/XML/JS highlighting follows filename, because their uploaded bytes currently use those allowed MIME types. Save is explicit Ctrl/CmdS or button, based on the loaded revision. Failed409 preserves the draft and blocks silent rebasing. Clean remote revisions refresh; dirty remote revisions show a conflict. Edits made during a successful save stay dirty. Read-only and saving/loading states prevent duplicate writes. Drafts are in-memory only; switching scope destroys them, and failed saves retain them until explicit reload/discard.

This is persisted revision sync, not live keystroke coediting. Current `Drive.row(write=True)` permits resource owner binding only; a shared nonowner has read access even with files.manage. `Drive.member` requires a human session. Agents need a trusted runtime adapter with requesting human + bot/run/audience fences; raw model actor IDs must never become credentials.

## Audit of installed rich/PDF/collaboration dependencies

Installed: codemirror6 and JS/XML/JSON packages, TipTap2 + ProseMirror. No pdfjs-dist or Yjs found in the current app installation. TipTap presence alone does not define a durable rich-document schema or collaborative server. Native PDF can be fetched through the exact authenticated bytes route and displayed via a revocable local blob URL by a separate viewer; this does not implement PDF content/annotation editing. DOCX/rich-text conversion, immutable annotation versions and font-preserving PDF writes need their own domain adapters. No code execution, arbitrary HTML rendering or file-format conversion is implemented by this editor.

## Verification boundary

Focused local test uses copied actual current Authority + Drive7 + native Drive HTTP app against temporary SQLite, real stored file bytes/UUIDs and deterministic principal adapter; no mocked file rows or in-product fake IDs. Windows uses a real temporary filesystem storage adapter because the Linux SafeBlobs directory-fsync operation is unavailable on Windows; production Linux durability remains the existing Drive7 evidence. It checks persistent save/reopen, current shortcut recognition, concurrent actual revision conflict, reload, native access denial and session-change fence. Shortcut browser binding/right-pane journey awaits root integration; no claim of new browser acceptance. Targeted svelte-check on the two actual app files: zero errors/warnings. No bundle build or provider/model/SMTP calls.
