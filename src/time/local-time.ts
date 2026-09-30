import {
  createZonedDateTime,
  isDateTimeError,
  parsePlainDate,
  parsePlainDateTime,
  plainDateOf,
  projectInstant,
  resolveZonedDateTime,
  toPlainDateString,
  toZonedDateTimeString,
  zonedDateTimeFromPlainDate,
} from "strictdatetime";

/**
 * The few places docket needs a person's local calendar, not just an
 * instant: a boundary date they picked, the local day a message was sent
 * on, and the local time an evidence export records. Everything else in
 * the app stores and compares plain instants, where a Date is enough.
 *
 * Main process only. The renderer has no bundler, so it can't import an
 * npm package; it sends a "YYYY-MM-DD" string and the main process does
 * the time-zone work here.
 */

/** The time zone of this machine, as an IANA name ("America/New_York"). Throws if the host can't name one, rather than quietly assuming UTC. */
export function localTimeZone(): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  // Validates the name the same way every other call here will.
  createZonedDateTime({ epochMilliseconds: 0, timeZone: zone });
  return zone;
}

/**
 * The first instant of a calendar date in a time zone. "2026-09-24" in
 * New York is 04:00 UTC, not 00:00 UTC — reading the string with
 * `new Date()` gets that wrong for anyone not in UTC.
 *
 * Throws DateTimeError for anything that isn't a real YYYY-MM-DD date
 * ("2026-02-30", "09/24/2026").
 */
export function startOfLocalDay(isoDate: string, timeZone: string): Date {
  // Where clocks skip midnight, the day starts at the first real time after
  // it; where midnight happens twice, at the first one.
  return new Date(zonedDateTimeFromPlainDate(parsePlainDate(isoDate), timeZone).epochMilliseconds);
}

/**
 * The local calendar date ("2026-09-23") an instant falls on in a time
 * zone. Before 1970, which named zones can't represent here, it's the UTC
 * date marked " UTC" — a wrong or corrupt timestamp shouldn't fail the
 * screen that shows it.
 */
export function localDateString(instant: Date, timeZone: string): string {
  try {
    return toPlainDateString(plainDateOf(projectInstant(instant.getTime(), timeZone)));
  } catch (err) {
    if (isDateTimeError(err) && err.code === "OUT_OF_RANGE") return `${instant.toISOString().slice(0, 10)} UTC`;
    throw err;
  }
}

/**
 * An instant written with its local offset and zone name, e.g.
 * "2026-09-23T21:00:00.000-04:00[America/New_York]": the exact instant and
 * the wall-clock time the person saw, in one string.
 *
 * Returns undefined for an instant before 1970, which named time zones
 * can't represent here. Callers keep the UTC timestamp, so nothing is lost.
 */
export function zonedTimestamp(instant: Date, timeZone: string): string | undefined {
  try {
    return toZonedDateTimeString(createZonedDateTime({ epochMilliseconds: instant.getTime(), timeZone }));
  } catch (err) {
    if (isDateTimeError(err) && err.code === "OUT_OF_RANGE") return undefined;
    throw err;
  }
}

/** One real instant a typed local time can mean. */
export interface ResolvedLocalTime {
  instant: Date;
  /** The instant with offset and zone, e.g. "2026-11-01T01:30:00.000-04:00[America/New_York]". */
  zoned: string;
}

export type LocalTimeResolution =
  | ({ status: "ok" } & ResolvedLocalTime)
  /** The time happened twice, when clocks went back. The person has to say which one; the app doesn't guess. */
  | { status: "ambiguous"; earlier: ResolvedLocalTime; later: ResolvedLocalTime }
  /** The time never happened, because clocks skipped forward over it. */
  | { status: "nonexistent" }
  | { status: "invalid" };

/**
 * Resolves a local date and time someone typed ("2026-11-01T01:30", the
 * format of an HTML datetime-local input) to an instant in `timeZone`.
 * Around a clock change, a typed time can be ambiguous or not exist at
 * all. Those come back as their own statuses rather than being quietly
 * shifted, so the person can choose: for evidence, "which 1:30 AM" is
 * their call. `choice` answers an earlier "ambiguous" result.
 */
export function resolveLocalDateTime(local: string, timeZone: string, choice?: "earlier" | "later"): LocalTimeResolution {
  let plain;
  try {
    // Also takes "HH:MM", which a datetime-local input sends when seconds are zero.
    plain = parsePlainDateTime(local);
  } catch (err) {
    if (isDateTimeError(err)) return { status: "invalid" };
    throw err;
  }

  const at = (disambiguation: "reject" | "earlier" | "later"): ResolvedLocalTime => {
    const zoned = resolveZonedDateTime(plain, timeZone, { disambiguation });
    return { instant: new Date(zoned.epochMilliseconds), zoned: toZonedDateTimeString(zoned) };
  };
  // Always "reject" first: `choice` only picks between the two real
  // instants of a repeated time. It must never move a skipped time.
  try {
    return { status: "ok", ...at("reject") };
  } catch (err) {
    if (!isDateTimeError(err)) throw err;
    if (err.code === "AMBIGUOUS_TIME") {
      return choice ? { status: "ok", ...at(choice) } : { status: "ambiguous", earlier: at("earlier"), later: at("later") };
    }
    if (err.code === "NONEXISTENT_TIME") return { status: "nonexistent" };
    if (err.code === "OUT_OF_RANGE") return { status: "invalid" };
    throw err;
  }
}

