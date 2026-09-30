import { ImapFlow, type FetchMessageObject } from "imapflow";
import { simpleParser } from "mailparser";
import { isDateTimeError, parseRfc5322DateTime } from "strictdatetime";
import type { Message, RawRecord } from "../../types/message";
import type { IngestResult } from "../adapter";
import { hashPayload } from "../hash";
import { quarantine } from "../quarantine";

export interface ImapConnectionConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  /** OAuth2 access token — preferred whenever the provider supports it: revocable, scoped, and not something an abuser who knows the account password would also have. */
  accessToken?: string;
  /** App-specific password, for providers without OAuth2. Never the account's main password — the UI's job is to make that the only thing offered here, not this reader's. */
  appPassword?: string;
  mailbox?: string;
}

/**
 * Opens an IMAP connection. Exactly one of accessToken / appPassword must
 * be set; this function can't tell an app password from the account's real
 * password, so that boundary is enforced by the onboarding UI never
 * offering a plain-password field, not by anything checkable here.
 */
export async function connectImap(config: ImapConnectionConfig): Promise<ImapFlow> {
  if (!config.accessToken && !config.appPassword) {
    throw new Error("connectImap requires either accessToken or appPassword");
  }

  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      ...(config.accessToken ? { accessToken: config.accessToken } : { pass: config.appPassword! }),
    },
    logger: false,
  });

  await client.connect();
  await client.mailboxOpen(config.mailbox ?? "INBOX");
  return client;
}

/** The slice of ImapFlow that fetchNewMessages actually needs — narrow on purpose so tests don't need a real IMAP connection to exercise the normalization logic. */
export interface MessageFetcher {
  fetch(
    range: string,
    query: { uid: boolean; source: boolean; envelope: boolean },
  ): AsyncGenerator<FetchMessageObject, false | void, undefined>;
}

/**
 * Fetches messages with UID greater than `sinceUid` from senders the user
 * selected during onboarding. The raw RFC822 source is preserved verbatim
 * as the RawRecord payload — for IMAP, unlike chat.db, "raw bytes" really
 * does mean the wire-format email, not a serialized query result.
 */
export async function* fetchNewMessages(
  client: MessageFetcher,
  selectedSenders: string[],
  sinceUid: number,
): AsyncGenerator<IngestResult> {
  if (selectedSenders.length === 0) return;
  const normalizedSelected = new Set(selectedSenders.map((s) => s.toLowerCase()));

  const range = `${sinceUid + 1}:*`;
  for await (const msg of client.fetch(range, { uid: true, source: true, envelope: true })) {
    const result = await normalizeMessage(msg, normalizedSelected);
    if (result) yield result;
  }
}

async function normalizeMessage(
  msg: FetchMessageObject,
  normalizedSelectedSenders: Set<string>,
): Promise<IngestResult | undefined> {
  if (!msg.source) return undefined;

  const senderAddress = msg.envelope?.from?.[0]?.address?.toLowerCase();
  if (!senderAddress || !normalizedSelectedSenders.has(senderAddress)) return undefined;

  const raw: RawRecord = {
    id: msg.envelope?.messageId ?? `imap-uid-${msg.uid}`,
    source: "imap",
    payload: msg.source,
    acquiredAt: new Date(),
    hash: hashPayload(msg.source),
    parserVersion: "1",
  };

  try {
    const parsed = await simpleParser(msg.source);
    const text = parsed.text;
    if (text === undefined) {
      return {
        kind: "quarantined",
        raw,
        quarantine: quarantine(raw, "imap", "message has no plain-text body (HTML-only or empty)"),
      };
    }

    const sentAt = readDateHeader(parsed.headerLines);
    if (typeof sentAt === "string") {
      return { kind: "quarantined", raw, quarantine: quarantine(raw, "imap", sentAt) };
    }

    const message: Message = {
      id: raw.id,
      rawRecordHash: raw.hash,
      source: "imap",
      threadId: senderAddress,
      sender: senderAddress,
      fromSelf: false,
      text,
      sentAt,
      provenance: "live",
    };
    return { kind: "message", raw, message };
  } catch (err) {
    return {
      kind: "quarantined",
      raw,
      quarantine: quarantine(raw, "imap", `MIME parse failed: ${(err as Error).message}`),
    };
  }
}

/**
 * The message's Date header, read from the raw header line rather than
 * mailparser's `date`: mailparser returns the current time for a Date
 * header it can't read, which would record the import time as the send
 * time with nothing to show it happened. The header must be a valid
 * RFC 5322 date; `Date.parse` would also guess at strings that aren't.
 * The old zone names ("GMT", "EST") are accepted, since many mailers
 * still send them and their meaning is fixed. Returns the quarantine
 * reason as a string when there's no usable date.
 */
function readDateHeader(headerLines: ReadonlyArray<{ key: string; line: string }>): Date | string {
  const line = headerLines.find((h) => h.key === "date")?.line;
  if (line === undefined) return "no Date header, so the send time is unknown";
  const value = line.slice(line.indexOf(":") + 1).trim();
  try {
    return new Date(parseRfc5322DateTime(value, { allowObsoleteZones: true }).epochMilliseconds);
  } catch (err) {
    if (!isDateTimeError(err)) throw err;
    return `unreadable Date header (${err.message}): ${JSON.stringify(value)}`;
  }
}
