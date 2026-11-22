// studio-delivery.ts
import { createHash as createHash2 } from "node:crypto";
import nodemailer from "nodemailer";

// server/src/mailbox/mime.ts
import { createHash, randomUUID } from "node:crypto";
function parseAddressList(headerValue) {
  if (!headerValue || typeof headerValue !== "string") return [];
  const results = [];
  const parts = headerValue.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const match = /(?:"?([^"]*)"?\s*)?<([^>]+)>/i.exec(trimmed);
    if (match) {
      const name = (match[1] || "").trim();
      const address = match[2].trim().toLowerCase();
      results.push({ address, ...name ? { name } : {} });
    } else {
      const plain = trimmed.replace(/[<>]/g, "").trim().toLowerCase();
      if (plain.includes("@")) {
        results.push({ address: plain });
      }
    }
  }
  return results;
}
function parseSingleAddress(headerValue) {
  const list = parseAddressList(headerValue);
  return list[0] || { address: "unknown@starlidigital.ro" };
}
function extractMessageIds(headerValue) {
  if (!headerValue) return [];
  const matches = headerValue.match(/<[^>]+>/g);
  if (!matches) {
    const trimmed = headerValue.trim();
    return trimmed ? [trimmed] : [];
  }
  return matches.map((m) => m.slice(1, -1).trim());
}
function decodeMimeWord(word) {
  const regex = /=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g;
  return word.replace(regex, (_, charset, encoding, text) => {
    try {
      const enc = encoding.toUpperCase();
      if (enc === "B") {
        const buf = Buffer.from(text, "base64");
        return buf.toString(charset.toLowerCase().includes("utf") ? "utf8" : "latin1");
      } else if (enc === "Q") {
        const hexDecoded = text.replace(/_/g, " ").replace(
          /=([0-9A-F]{2})/gi,
          (__, hex) => String.fromCharCode(parseInt(hex, 16))
        );
        return Buffer.from(hexDecoded, "binary").toString("utf8");
      }
    } catch {
      return text;
    }
    return text;
  });
}
function sanitizeHeaderValue(value) {
  return value.replace(/[\r\n]+/g, " ").trim();
}
function parseHeaders(rawHeaders) {
  const headers = /* @__PURE__ */ new Map();
  const unfolded = rawHeaders.replace(/\r?\n[ \t]+/g, " ");
  const lines = unfolded.split(/\r?\n/);
  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx > 0) {
      const key = line.slice(0, idx).trim().toLowerCase();
      const val = sanitizeHeaderValue(decodeMimeWord(line.slice(idx + 1).trim()));
      headers.set(key, val);
    }
  }
  return headers;
}
function parseRfc2822(rawEmail) {
  const rawStr = typeof rawEmail === "string" ? rawEmail : rawEmail.toString("utf8");
  const splitIdx = rawStr.indexOf("\r\n\r\n");
  const splitIdxAlt = splitIdx === -1 ? rawStr.indexOf("\n\n") : splitIdx;
  let headerPart = "";
  let bodyPart = "";
  if (splitIdxAlt !== -1) {
    headerPart = rawStr.slice(0, splitIdxAlt);
    const separatorLen = rawStr.startsWith("\r\n\r\n", splitIdxAlt) ? 4 : 2;
    bodyPart = rawStr.slice(splitIdxAlt + separatorLen);
  } else {
    headerPart = rawStr;
  }
  const headers = parseHeaders(headerPart);
  const rawMsgId = headers.get("message-id") || `<msg-${randomUUID()}@starlidigital.ro>`;
  const messageId = extractMessageIds(rawMsgId)[0] || rawMsgId.replace(/[<>]/g, "");
  const from = parseSingleAddress(headers.get("from"));
  const to = parseAddressList(headers.get("to"));
  const cc = parseAddressList(headers.get("cc"));
  const bcc = parseAddressList(headers.get("bcc"));
  const replyTo = headers.has("reply-to") ? parseSingleAddress(headers.get("reply-to")) : void 0;
  const subject = headers.get("subject") || "(F\u0103r\u0103 subiect)";
  const dateStr = headers.get("date");
  let date = (/* @__PURE__ */ new Date()).toISOString();
  if (dateStr) {
    const parsed = Date.parse(dateStr);
    if (!isNaN(parsed)) date = new Date(parsed).toISOString();
  }
  const inReplyTo = headers.has("in-reply-to") ? extractMessageIds(headers.get("in-reply-to"))[0] : void 0;
  const references = extractMessageIds(headers.get("references"));
  const contentType = headers.get("content-type") || "text/plain";
  const transferEncoding = headers.get("content-transfer-encoding") || "7bit";
  let textBody;
  let htmlBody;
  const attachments = [];
  const boundaryMatch = /boundary="?([^";\s]+)"?/i.exec(contentType);
  if (boundaryMatch) {
    const boundary = boundaryMatch[1];
    const parts = bodyPart.split(new RegExp(`--${boundary}(?:--)?`));
    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed || trimmed === "--") continue;
      const partParsed = parseRfc2822(trimmed);
      if (partParsed.textBody && !textBody) textBody = partParsed.textBody;
      if (partParsed.htmlBody && !htmlBody) htmlBody = partParsed.htmlBody;
      for (const att of partParsed.attachments) {
        attachments.push(att);
      }
    }
  } else {
    let decoded = bodyPart;
    const enc = transferEncoding.toLowerCase().trim();
    if (enc === "base64") {
      try {
        decoded = Buffer.from(bodyPart.replace(/\s+/g, ""), "base64").toString("utf8");
      } catch {
      }
    } else if (enc === "quoted-printable") {
      decoded = bodyPart.replace(/=\r?\n/g, "").replace(
        /=([0-9A-F]{2})/gi,
        (_, hex) => String.fromCharCode(parseInt(hex, 16))
      );
    }
    const contentDisposition = headers.get("content-disposition") || "";
    const isAttachment = /attachment/i.test(contentDisposition);
    const filenameMatch = /(?:filename|name)="?([^";\s]+)"?/i.exec(contentDisposition || contentType);
    if (isAttachment || filenameMatch) {
      const rawFilename = filenameMatch ? decodeMimeWord(filenameMatch[1]) : "attachment.bin";
      const filename = rawFilename.replace(/^.*[\\\/]/, "").replace(/[^a-zA-Z0-9_.-]/g, "_") || "attachment.bin";
      const buf = enc === "base64" ? Buffer.from(bodyPart.replace(/\s+/g, ""), "base64") : Buffer.from(decoded, "utf8");
      if (buf.length <= 25 * 1024 * 1024) {
        attachments.push({
          id: "att-" + randomUUID(),
          filename,
          mimeType: contentType.split(";")[0].trim().toLowerCase(),
          byteSize: buf.length,
          sha256: createHash("sha256").update(buf).digest("hex"),
          content: buf
        });
      }
    } else if (contentType.toLowerCase().includes("text/html")) {
      htmlBody = decoded;
    } else {
      textBody = decoded;
    }
  }
  return {
    messageId,
    inReplyTo,
    references,
    from,
    to,
    cc,
    bcc: bcc.length > 0 ? bcc : void 0,
    replyTo,
    subject,
    date,
    textBody: textBody?.trim(),
    htmlBody: htmlBody?.trim(),
    attachments
  };
}

// server/src/mailbox/sanitizer.ts
var ALLOWED_TAGS = /* @__PURE__ */ new Set([
  "p",
  "br",
  "div",
  "span",
  "blockquote",
  "pre",
  "code",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "dl",
  "dt",
  "dd",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
  "b",
  "strong",
  "i",
  "em",
  "u",
  "s",
  "strike",
  "del",
  "a",
  "img",
  "hr",
  "font",
  "small",
  "sub",
  "sup"
]);
var ALLOWED_ATTRS = /* @__PURE__ */ new Set([
  "href",
  "title",
  "alt",
  "src",
  "width",
  "height",
  "align",
  "valign",
  "border",
  "cellpadding",
  "cellspacing",
  "style",
  "class",
  "target",
  "data-original-src"
]);
var DANGEROUS_PROTOCOLS = /^(javascript|data|vbscript|file):/i;
function sanitizeHtml(html, options = {}) {
  if (!html || typeof html !== "string") {
    return { sanitizedHtml: "", hasRemoteImages: false, blockedTagsCount: 0 };
  }
  let hasRemoteImages = false;
  let blockedTagsCount = 0;
  let clean = html.replace(/<!--[\s\S]*?-->/g, "");
  clean = clean.replace(/<!DOCTYPE[\s\S]*?>/gi, "");
  for (const dangerous of ["script", "style", "iframe", "object", "embed", "applet", "meta", "link"]) {
    const reg = new RegExp(`<${dangerous}\\b[^>]*>[\\s\\S]*?<\\/${dangerous}>`, "gi");
    if (reg.test(clean)) {
      blockedTagsCount++;
      clean = clean.replace(reg, "");
    }
    const singleReg = new RegExp(`<${dangerous}\\b[^>]*\\/?>`, "gi");
    if (singleReg.test(clean)) {
      blockedTagsCount++;
      clean = clean.replace(singleReg, "");
    }
  }
  clean = clean.replace(/<\/?([a-zA-Z0-9_-]+)([^>]*)>/g, (match, tagName, attrsStr) => {
    const lowerTag = tagName.toLowerCase();
    const isClosing = match.startsWith("</");
    if (!ALLOWED_TAGS.has(lowerTag)) {
      blockedTagsCount++;
      return "";
    }
    if (isClosing) {
      return `</${lowerTag}>`;
    }
    const attrRegex = /([a-zA-Z0-9_-]+)(?:\s*=\s*(?:'([^']*)'|"([^"]*)"|([^\s>]+)))?/g;
    let attrMatch;
    const cleanAttrs = [];
    while ((attrMatch = attrRegex.exec(attrsStr)) !== null) {
      const attrName = attrMatch[1].toLowerCase();
      let attrVal = attrMatch[2] ?? attrMatch[3] ?? attrMatch[4] ?? "";
      if (attrName.startsWith("on")) {
        continue;
      }
      if (!ALLOWED_ATTRS.has(attrName)) {
        continue;
      }
      if (lowerTag === "img" && attrName === "src") {
        const isRemote = /^https?:\/\//i.test(attrVal.trim());
        if (isRemote) {
          hasRemoteImages = true;
          if (!options.allowRemoteImages) {
            cleanAttrs.push(`data-original-src="${escapeHtml(attrVal)}"`);
            cleanAttrs.push(`src="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='1' height='1'></svg>"`);
            continue;
          }
        }
      }
      if (attrName === "href" || attrName === "src" && lowerTag !== "img") {
        const decodedEntities = attrVal.replace(/&#x([0-9a-f]+);?/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16))).replace(/&#([0-9]+);?/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)));
        const decodedVal = decodedEntities.trim().replace(/[\u0000-\u001F\u007F-\u009F\s]/g, "");
        if (DANGEROUS_PROTOCOLS.test(decodedVal)) {
          attrVal = "#blocked-unsafe-url";
        }
      }
      if (attrName === "style") {
        if (/url\s*\(|expression|behavior|-moz-binding/i.test(attrVal)) {
          attrVal = attrVal.replace(/(?:background-image|background)\s*:[^;]+;?/gi, "").replace(/url\s*\([^)]*\)/gi, "").replace(/expression\([^)]*\)/gi, "");
        }
      }
      if (attrName === "target") {
        attrVal = "_blank";
      }
      cleanAttrs.push(`${attrName}="${escapeHtml(attrVal)}"`);
    }
    if (lowerTag === "a") {
      if (!cleanAttrs.some((a) => a.startsWith("rel="))) {
        cleanAttrs.push('rel="noopener noreferrer"');
      }
    }
    const attrsSerialized = cleanAttrs.length > 0 ? " " + cleanAttrs.join(" ") : "";
    return `<${lowerTag}${attrsSerialized}>`;
  });
  return {
    sanitizedHtml: clean.trim(),
    hasRemoteImages,
    blockedTagsCount
  };
}
function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// studio-delivery.ts
function deliveryDigest(input) {
  return createHash2("sha256").update(JSON.stringify({ envelope: input.envelope, rawMime: input.rawMime })).digest("hex");
}
var StudioDelivery = class {
  constructor(store, verifyApproval, verifyAccess) {
    this.store = store;
    this.verifyApproval = verifyApproval;
    this.verifyAccess = verifyAccess;
  }
  store;
  verifyApproval;
  verifyAccess;
  access(c, a) {
    const r = this.verifyAccess(c, a);
    if (r && typeof r.then === "function") throw Error("Synchronous current access verification required");
  }
  async deliver(input) {
    this.access(input.companyId, input.actorId);
    if (!input.operationId || input.operationId.length > 180 || Buffer.byteLength(input.rawMime) > 8 * 1024 * 1024) throw Error("Invalid operation");
    if (deliveryDigest(input) !== input.approvalDigest) throw Error("Exact MIME/envelope approval digest mismatch");
    if (!input.envelope.to.length || input.envelope.to.length > 100 || [input.envelope.from, ...input.envelope.to].some((v) => !/^[^\s<>@,;\r\n]+@[^\s<>@,;\r\n]+$/.test(v))) throw Error("Invalid envelope");
    const operationId = createHash2("sha256").update(JSON.stringify([input.companyId, input.operationId])).digest("hex");
    const old = this.store.get("company-mail-deliveries", operationId);
    if (old) {
      if (old.approvalDigest !== input.approvalDigest || old.actorId !== input.actorId) throw Error("Operation ID reused");
      return this.status(input.operationId, input.companyId, input.actorId);
    }
    const approved = await this.verifyApproval(input);
    this.access(input.companyId, input.actorId);
    const account = this.store.get("company-mail-accounts", approved.accountId);
    if (!account || account.companyId !== input.companyId || account.status !== "active" || !account.senderVerified || account.email !== input.envelope.from) throw Error("Sender connection denied");
    if (!approved.smtp.secure && !["127.0.0.1", "localhost", "::1"].includes(approved.smtp.host)) throw Error("External submission requires TLS");
    const receipt = { id: operationId, operationId: input.operationId, companyId: input.companyId, actorId: input.actorId, accountId: account.id, draftId: approved.draftId, revision: approved.revision, approvalDigest: input.approvalDigest, status: "PENDING", createdAt: (/* @__PURE__ */ new Date()).toISOString() };
    this.store.db.exec("BEGIN IMMEDIATE");
    try {
      if (this.store.get("company-mail-deliveries", operationId)) throw Error("Operation in progress");
      if (this.store.list("company-mail-deliveries").some((r) => r.companyId === input.companyId && r.accountId === account.id && r.draftId === approved.draftId && r.revision === approved.revision)) throw Error("Draft revision already submitted");
      this.store.put("company-mail-deliveries", receipt);
      this.store.db.exec("COMMIT");
    } catch (e) {
      this.store.db.exec("ROLLBACK");
      throw e;
    }
    let deliveryPhase = "authorization";
    try {
      this.access(input.companyId, input.actorId);
      const current = this.store.get("company-mail-accounts", account.id);
      if (current?.status !== "active" || current.revision !== account.revision) throw Error("Connection revoked");
      deliveryPhase = "transport";
      const transport = nodemailer.createTransport({ ...approved.smtp, logger: false, debug: false, tls: { rejectUnauthorized: true }, connectionTimeout: 2e4, socketTimeout: 3e4, disableFileAccess: true, disableUrlAccess: true });
      const result = await transport.sendMail({ envelope: input.envelope, raw: input.rawMime, disableFileAccess: true, disableUrlAccess: true });
      if (result.rejected?.length) throw Error("Partial delivery");
      deliveryPhase = "sent-filing";
      const prefix = "company-mail:" + JSON.stringify([input.companyId, account.id]) + ":";
      const parsed = parseRfc2822(input.rawMime), html = parsed.htmlBody ? sanitizeHtml(parsed.htmlBody).sanitizedHtml : void 0, time = (/* @__PURE__ */ new Date()).toISOString();
      const message = { id: "studio-sent-" + operationId, accountId: account.id, folder: "Sent", messageId: parsed.messageId, threadId: parsed.references[0] || parsed.inReplyTo || parsed.messageId, inReplyTo: parsed.inReplyTo, references: parsed.references, direction: "OUTBOUND", from: parsed.from, to: parsed.to, cc: parsed.cc, bcc: parsed.bcc, subject: parsed.subject, textBody: parsed.textBody, sanitizedHtmlBody: html, hasHtml: !!html, hasRemoteImages: false, snippet: (parsed.textBody || "").slice(0, 160), attachments: parsed.attachments.map(({ content, ...meta }) => meta), status: "ACCEPTED", isRead: true, isStarred: false, date: time, createdAt: time, updatedAt: time };
      this.store.db.exec("BEGIN IMMEDIATE");
      try {
        for (const a of parsed.attachments) if (a.content) this.store.put(prefix + "mailbox-blobs", { id: a.id, meta: { id: a.id, filename: a.filename, mimeType: a.mimeType, byteSize: a.byteSize, sha256: a.sha256 }, contentBase64: a.content.toString("base64") });
        this.store.put(prefix + "mailbox-messages", message);
        this.store.put("company-mail-deliveries", { ...receipt, status: "ACCEPTED", sentMessageId: message.id, completedAt: time });
        this.store.db.exec("COMMIT");
      } catch (e) {
        this.store.db.exec("ROLLBACK");
        throw e;
      }
    } catch (e) {
      this.store.put("company-mail-deliveries", { ...receipt, status: "NEEDS_REVIEW", reviewPhase: deliveryPhase, reviewCode: String(e?.code || (e?.message === "FORBIDDEN" ? "FORBIDDEN" : e?.message === "UNAVAILABLE" ? "UNAVAILABLE" : "DELIVERY_FAILURE")).replace(/[^A-Z0-9_]/g," ").trim().slice(0,40), reviewResponseCode: Number.isInteger(e?.responseCode) ? e.responseCode : null, reviewCommand: typeof e?.command === "string" ? e.command.split(" ")[0].replace(/[^A-Z]/g,"").slice(0,20) : null, completedAt: (/* @__PURE__ */ new Date()).toISOString() });
    }
    return this.status(input.operationId, input.companyId, input.actorId);
  }
  status(operationId, companyId, actorId) {
    this.access(companyId, actorId);
    const id = createHash2("sha256").update(JSON.stringify([companyId, operationId])).digest("hex");
    const r = this.store.get("company-mail-deliveries", id);
    if (!r || r.companyId !== companyId) throw Error("Receipt not found");
    return { operationId: r.operationId, status: r.status, accountId: r.accountId, sentMessageId: r.sentMessageId, createdAt: r.createdAt, completedAt: r.completedAt };
  }
};
export {
  StudioDelivery,
  deliveryDigest
};
