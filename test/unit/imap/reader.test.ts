import { describe, expect, it } from "vitest";
import type { FetchMessageObject } from "imapflow";
import { fetchNewMessages, type MessageFetcher } from "../../../src/ingest/imap/reader";

function buildRawEmail(opts: { from: string; date: string; subject: string; body: string }): Buffer {
  return Buffer.from(
    `From: ${opts.from}\r\n` +
      `To: victim@example.com\r\n` +
      `Subject: ${opts.subject}\r\n` +
      `Date: ${opts.date}\r\n` +
      `Message-ID: <test-${Math.random().toString(36).slice(2)}@example.com>\r\n` +
      `Content-Type: text/plain\r\n\r\n` +
      `${opts.body}\r\n`,
    "utf8",
  );
}

function fakeFetcher(messages: Array<Partial<FetchMessageObject> & { uid: number }>): MessageFetcher {
  return {
    async *fetch() {
      for (const msg of messages) {
        yield msg as FetchMessageObject;
      }
      return false;
    },
  };
}

describe("fetchNewMessages", () => {
  it("normalizes a message from a selected sender", async () => {
    const source = buildRawEmail({
      from: "stalker@example.com",
      date: "Sun, 15 Feb 2026 10:00:00 +0000",
      subject: "hey",
      body: "I know where you work now",
    });
    const fetcher = fakeFetcher([
      { uid: 5, source, envelope: { from: [{ address: "stalker@example.com" }] } as never },
    ]);

    const results = [];
    for await (const r of fetchNewMessages(fetcher, ["stalker@example.com"], 0)) results.push(r);

    expect(results).toHaveLength(1);
    expect(results[0]?.kind).toBe("message");
    if (results[0]?.kind === "message") {
      expect(results[0].message.text?.trim()).toBe("I know where you work now");
      expect(results[0].message.sender).toBe("stalker@example.com");
      expect(results[0].message.threadId).toBe("stalker@example.com");
    }
  });

  it("skips messages from senders not selected by the user", async () => {
    const source = buildRawEmail({ from: "someone-else@example.com", date: "Sun, 15 Feb 2026 10:00:00 +0000", subject: "hi", body: "hello" });
    const fetcher = fakeFetcher([
      { uid: 5, source, envelope: { from: [{ address: "someone-else@example.com" }] } as never },
    ]);

    const results = [];
    for await (const r of fetchNewMessages(fetcher, ["stalker@example.com"], 0)) results.push(r);
    expect(results).toHaveLength(0);
  });

  it("matches sender case-insensitively", async () => {
    const source = buildRawEmail({ from: "Stalker@Example.com", date: "Sun, 15 Feb 2026 10:00:00 +0000", subject: "hi", body: "hello" });
    const fetcher = fakeFetcher([
      { uid: 5, source, envelope: { from: [{ address: "Stalker@Example.com" }] } as never },
    ]);

    const results = [];
    for await (const r of fetchNewMessages(fetcher, ["stalker@example.com"], 0)) results.push(r);
    expect(results).toHaveLength(1);
  });

  it("skips a message with no source bytes at all", async () => {
    const fetcher = fakeFetcher([{ uid: 5, envelope: { from: [{ address: "stalker@example.com" }] } as never }]);

    const results = [];
    for await (const r of fetchNewMessages(fetcher, ["stalker@example.com"], 0)) results.push(r);
    expect(results).toHaveLength(0);
  });

  it("returns nothing when no senders are selected, rather than fetching everything", async () => {
    const source = buildRawEmail({ from: "stalker@example.com", date: "Sun, 15 Feb 2026 10:00:00 +0000", subject: "hi", body: "hello" });
    const fetcher = fakeFetcher([{ uid: 5, source, envelope: { from: [{ address: "stalker@example.com" }] } as never }]);

    const results = [];
    for await (const r of fetchNewMessages(fetcher, [], 0)) results.push(r);
    expect(results).toHaveLength(0);
  });

  it("every raw record's hash is reproducible and equals the raw RFC822 bytes", async () => {
    const source = buildRawEmail({ from: "stalker@example.com", date: "Sun, 15 Feb 2026 10:00:00 +0000", subject: "hi", body: "verify me" });
    const fetcher = fakeFetcher([{ uid: 5, source, envelope: { from: [{ address: "stalker@example.com" }] } as never }]);

    const results = [];
    for await (const r of fetchNewMessages(fetcher, ["stalker@example.com"], 0)) results.push(r);

    const { hashPayload } = await import("../../../src/ingest/hash");
    expect(results[0]!.raw.payload).toEqual(source);
    expect(hashPayload(results[0]!.raw.payload)).toBe(results[0]!.raw.hash);
  });

  it("keeps the send time from the Date header", async () => {
    const source = buildRawEmail({ from: "stalker@example.com", date: "Mon, 16 Feb 2026 10:00:00 -0500", subject: "hi", body: "hello" });
    const fetcher = fakeFetcher([{ uid: 1, source, envelope: { from: [{ address: "stalker@example.com" }] } as never }]);
    const [result] = await collect(fetchNewMessages(fetcher, ["stalker@example.com"], 0));
    expect(result?.kind === "message" && result.message.sentAt.toISOString()).toBe("2026-02-16T15:00:00.000Z");
  });

  it("quarantines a message with no Date header instead of dating it at import time", async () => {
    const source = Buffer.from("From: stalker@example.com\r\nSubject: hi\r\nContent-Type: text/plain\r\n\r\nhello\r\n", "utf8");
    const fetcher = fakeFetcher([{ uid: 1, source, envelope: { from: [{ address: "stalker@example.com" }] } as never }]);
    const [result] = await collect(fetchNewMessages(fetcher, ["stalker@example.com"], 0));
    expect(result?.kind).toBe("quarantined");
    if (result?.kind === "quarantined") expect(result.quarantine.reason).toContain("no Date header");
  });

  async function readDate(date: string) {
    const source = buildRawEmail({ from: "stalker@example.com", date, subject: "hi", body: "hello" });
    const fetcher = fakeFetcher([{ uid: 1, source, envelope: { from: [{ address: "stalker@example.com" }] } as never }]);
    const [result] = await collect(fetchNewMessages(fetcher, ["stalker@example.com"], 0));
    return result;
  }

  it("quarantines a message whose Date header can't be read (mailparser would return the current time)", async () => {
    const result = await readDate("sometime last week");
    expect(result?.kind).toBe("quarantined");
    if (result?.kind === "quarantined") {
      expect(result.quarantine.reason).toMatch(/^unreadable Date header \(.+\): "sometime last week"$/);
    }
  });

  it("reads the forms real mailers send: old zone names and a trailing comment", async () => {
    for (const [date, iso] of [
      ["Mon, 16 Feb 2026 10:00:00 GMT", "2026-02-16T10:00:00.000Z"],
      ["Mon, 16 Feb 2026 10:00:00 EST", "2026-02-16T15:00:00.000Z"],
      ["Mon, 16 Feb 2026 10:00:00 +0000 (UTC)", "2026-02-16T10:00:00.000Z"],
      ["16 Feb 2026 10:00 -0500", "2026-02-16T15:00:00.000Z"],
    ] as const) {
      const result = await readDate(date);
      expect(result?.kind === "message" && result.message.sentAt.toISOString(), date).toBe(iso);
    }
  });

  it("quarantines dates that Date.parse would guess at", async () => {
    // A wrong day name, a two-digit year, and an ISO string: each is a sign the header isn't what it claims.
    for (const date of ["Tue, 16 Feb 2026 10:00:00 -0500", "Mon, 16 Feb 26 10:00:00 -0500", "2026-02-16 10:00"]) {
      expect(Number.isNaN(Date.parse(date)), date).toBe(false);
      expect((await readDate(date))?.kind, date).toBe("quarantined");
    }
  });
});

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}
