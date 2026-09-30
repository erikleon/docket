import { el, ipcErrorMessage, mount, showToast } from "../dom.js";
import { createEditor, createToolbar, DEFAULT_POLICY, sanitize, sanitizeToFragment, type Editor, type SanitizePolicy } from "../vendor/minisiwyg-editor.js";

/**
 * What the log's editor allows: paragraphs, emphasis, lists, and quotes.
 * No links (a URL stays plain text, and nothing in an entry can navigate
 * the app window), no images, no headings. Applied when typing, on paste,
 * before saving, and again every time an entry is shown.
 */
const LOG_POLICY: SanitizePolicy = {
  tags: { p: [], br: [], strong: [], em: [], u: [], ul: [], ol: [], li: [], blockquote: [] },
  strip: false,
  maxDepth: DEFAULT_POLICY.maxDepth,
  maxLength: 200_000,
  protocols: [],
};

const TOOLBAR_ACTIONS = ["bold", "italic", "underline", "|", "unorderedList", "orderedList", "|", "blockquote"];

type View = { kind: "list" } | { kind: "new" } | { kind: "entry"; id: string; updating: boolean };

/**
 * A log of incidents no message records: a visit, a call, a missed
 * exchange, being followed. Entries are never deleted or overwritten; an
 * update adds a revision and the earlier text stays in the history
 * (vault/incident-log.ts). The time an incident happened is resolved in
 * the main process (time/local-time.ts), which reports a time that
 * happened twice or never happened around a clock change, so this screen
 * can ask instead of guessing.
 */
export async function renderIncidentLogScreen(container: Element): Promise<void> {
  let entries = await window.docket.incidentLog.list();
  const people = [...new Set((await window.docket.knownAccounts.list()).map((a) => a.personLabel))].sort();
  let view: View = { kind: "list" };
  let editor: Editor | undefined;

  function go(next: View): void {
    editor?.destroy();
    editor = undefined;
    view = next;
    draw();
  }

  async function reload(next: View): Promise<void> {
    entries = await window.docket.incidentLog.list();
    go(next);
  }

  /** The editor plus its toolbar, optionally starting from an entry's current text. */
  function editorField(labelText: string, initialHtml: string | undefined, onInput: () => void): HTMLElement {
    const id = `incident-editor-${Date.now()}`;
    const surface = el("div", { class: "rich-editor", id, role: "textbox", "aria-multiline": "true", "aria-label": labelText });
    if (initialHtml) surface.append(sanitizeToFragment(initialHtml, LOG_POLICY));
    const toolbarSlot = el("div", { class: "rich-editor-toolbar" });
    editor = createEditor(surface, { policy: LOG_POLICY, onChange: onInput });
    createToolbar(editor, { actions: TOOLBAR_ACTIONS, element: toolbarSlot });
    onInput();
    return el("div", { class: "field" }, [el("label", { for: id }, [labelText]), el("div", { class: "rich-editor-frame" }, [toolbarSlot, surface])]);
  }

  function editorContent(): { html: string; text: string } {
    const html = sanitize(editor?.getHTML() ?? "", LOG_POLICY);
    return { html, text: (editor?.getText() ?? "").trim() };
  }

  function drawList(pane: HTMLElement): void {
    pane.append(
      el("h1", {}, ["Incident log"]),
      el("p", {}, [
        "Write down what happened when it isn't in a message: a visit, a call, a missed exchange, being followed. Each entry keeps when you wrote it and every change you make later. Entries can't be deleted.",
      ]),
    );
    const newBtn = el("button", { type: "button", class: "btn btn--primary btn--inline" }, ["New entry"]);
    newBtn.addEventListener("click", () => go({ kind: "new" }));
    pane.append(newBtn);

    if (entries.length === 0) {
      pane.append(el("div", { class: "empty-state" }, ["No entries yet."]));
      return;
    }
    const list = el("div", { class: "list-block" });
    for (const entry of entries) {
      const latest = entry.revisions[entry.revisions.length - 1]!;
      const row = el("button", { type: "button", class: "list-block-row list-block-row--button" });
      const meta = [entry.involving, entry.revisions.length > 1 ? `updated ${entry.revisions.length - 1} time${entry.revisions.length === 2 ? "" : "s"}` : undefined]
        .filter((v): v is string => v !== undefined)
        .join(" · ");
      row.append(
        el("span", { class: "list-block-row-title" }, [formatOccurred(entry)]),
        ...(meta ? [el("span", { class: "list-block-row-sub" }, [meta])] : []),
        el("span", { class: "list-block-row-sub incident-preview" }, [latest.text]),
      );
      row.addEventListener("click", () => go({ kind: "entry", id: entry.id, updating: false }));
      list.append(row);
    }
    pane.append(list);
  }

  function drawNew(pane: HTMLElement): void {
    pane.append(el("h1", {}, ["New entry"]));

    let time: LocalTimeResolution | undefined;
    let choice: "earlier" | "later" | undefined;
    const timeNote = el("div", { class: "field-note", "aria-live": "polite" });

    const whenInput = el("input", { type: "datetime-local", id: "incident-when", max: toLocalInputValue(new Date()) }) as HTMLInputElement;
    whenInput.value = toLocalInputValue(new Date());
    const involvingInput = el("input", { type: "text", id: "incident-involving", list: "incident-people", autocomplete: "off" }) as HTMLInputElement;
    const peopleList = el("datalist", { id: "incident-people" }, people.map((p) => el("option", { value: p })));

    const saveBtn = el("button", { type: "button", class: "btn btn--primary btn--inline" }, ["Save entry"]) as HTMLButtonElement;
    const revalidate = () => {
      const timeUsable = time?.status === "ok" || (time?.status === "ambiguous" && choice !== undefined);
      saveBtn.disabled = !timeUsable || editorContent().text.length === 0;
    };

    async function checkTime(): Promise<void> {
      choice = undefined;
      time = await window.docket.incidentLog.resolveTime(whenInput.value);
      timeNote.replaceChildren();
      if (time.status === "nonexistent") {
        timeNote.append(el("p", { class: "field-error" }, ["That time didn't happen that night: the clocks skipped forward over it. Choose another time."]));
      } else if (time.status === "invalid") {
        timeNote.append(el("p", { class: "field-error" }, ["Enter a date and time."]));
      } else if (time.status === "ambiguous") {
        const group = el("div", { class: "choice-group", role: "radiogroup", "aria-labelledby": "incident-time-question" }, [
          el("p", { id: "incident-time-question", class: "choice-question" }, ["That time happened twice that night, when the clocks went back. Which one?"]),
        ]);
        for (const [key, option] of [["earlier", time.earlier], ["later", time.later]] as const) {
          const radio = el("input", { type: "radio", name: "incident-time-choice", value: key }) as HTMLInputElement;
          radio.addEventListener("change", () => {
            choice = key;
            revalidate();
          });
          group.append(
            el("label", { class: "choice" }, [radio, el("span", {}, [`${formatZoned(option)}${key === "earlier" ? " (the first time)" : " (after the clocks went back)"}`])]),
          );
        }
        timeNote.append(group);
      }
      revalidate();
    }
    whenInput.addEventListener("change", () => void checkTime());

    pane.append(
      el("div", { class: "field" }, [el("label", { for: "incident-when" }, ["When did it happen?"]), whenInput, timeNote]),
      el("div", { class: "field" }, [el("label", { for: "incident-involving" }, ["Who was involved? (optional)"]), involvingInput, peopleList]),
      editorField("What happened", undefined, revalidate),
    );

    const cancel = el("button", { type: "button", class: "btn btn--inline" }, ["Cancel"]);
    cancel.addEventListener("click", () => go({ kind: "list" }));
    saveBtn.addEventListener("click", async () => {
      saveBtn.disabled = true;
      const content = editorContent();
      const input: NewIncidentInput = { occurredLocal: whenInput.value, ...content };
      if (choice) input.choice = choice;
      const involving = involvingInput.value.trim();
      if (involving) input.involving = involving;
      try {
        const saved = await window.docket.incidentLog.add(input);
        showToast("Entry saved");
        await reload({ kind: "entry", id: saved.id, updating: false });
      } catch (err) {
        showToast(`Couldn't save: ${ipcErrorMessage(err)}`);
        revalidate();
      }
    });
    pane.append(el("div", { class: "button-row" }, [saveBtn, cancel]));
    void checkTime();
  }

  function drawEntry(pane: HTMLElement, id: string, updating: boolean): void {
    const entry = entries.find((e) => e.id === id);
    if (!entry) {
      go({ kind: "list" });
      return;
    }
    const latest = entry.revisions[entry.revisions.length - 1]!;
    const first = entry.revisions[0]!;
    pane.append(
      el("h1", {}, [formatOccurred(entry)]),
      el("p", {}, [
        [
          entry.involving ? `Involving ${entry.involving}.` : undefined,
          `Written ${formatInstant(first.writtenAt)}.`,
          entry.revisions.length > 1 ? `Last updated ${formatInstant(latest.writtenAt)}.` : undefined,
        ]
          .filter(Boolean)
          .join(" "),
      ]),
    );

    if (updating) {
      const saveBtn = el("button", { type: "button", class: "btn btn--primary btn--inline" }, ["Save update"]) as HTMLButtonElement;
      const revalidate = () => {
        saveBtn.disabled = editorContent().text.length === 0;
      };
      pane.append(editorField("What happened", latest.html, revalidate));
      revalidate();
      saveBtn.addEventListener("click", async () => {
        saveBtn.disabled = true;
        const { html, text } = editorContent();
        try {
          await window.docket.incidentLog.revise(entry.id, html, text);
          showToast("Update saved. The earlier text is kept in the history.");
          await reload({ kind: "entry", id: entry.id, updating: false });
        } catch (err) {
          showToast(`Couldn't save: ${ipcErrorMessage(err)}`);
          revalidate();
        }
      });
      const cancel = el("button", { type: "button", class: "btn btn--inline" }, ["Cancel"]);
      cancel.addEventListener("click", () => go({ kind: "entry", id: entry.id, updating: false }));
      pane.append(el("div", { class: "button-row" }, [saveBtn, cancel]));
    } else {
      pane.append(el("div", { class: "rich-text" }, [sanitizeToFragment(latest.html, LOG_POLICY)]));
      const update = el("button", { type: "button", class: "btn btn--inline" }, ["Add an update"]);
      update.addEventListener("click", () => go({ kind: "entry", id: entry.id, updating: true }));
      pane.append(update);
    }

    if (entry.revisions.length > 1) {
      const history = el("details", { class: "revision-history" }, [
        el("summary", {}, [`History (${entry.revisions.length} versions)`]),
      ]);
      for (const revision of [...entry.revisions].reverse()) {
        history.append(
          el("div", { class: "revision" }, [
            el("div", { class: "list-block-row-sub" }, [`Version ${revision.revision} · written ${formatInstant(revision.writtenAt)}`]),
            el("div", { class: "rich-text" }, [sanitizeToFragment(revision.html, LOG_POLICY)]),
          ]),
        );
      }
      pane.append(history);
    }

    const back = el("button", { type: "button", class: "link-button" }, ["← Back to the log"]);
    back.addEventListener("click", () => go({ kind: "list" }));
    pane.append(back);
  }

  function draw(): void {
    const pane = el("div", { class: "content-pane" });
    if (view.kind === "list") drawList(pane);
    else if (view.kind === "new") drawNew(pane);
    else drawEntry(pane, view.id, view.updating);
    mount(container, pane);
  }

  draw();
}

/** "YYYY-MM-DDTHH:MM" for a datetime-local input, on this machine's calendar. */
function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** The IANA zone at the end of a zoned string: "…-05:00[America/New_York]" → "America/New_York". */
function zoneOf(zoned: string): string | undefined {
  return /\[([^\]]+)\]$/.exec(zoned)?.[1];
}

/** When an incident happened, shown in the zone it was entered in, with the zone's abbreviation so "1:30 AM EDT" and "1:30 AM EST" stay distinct. */
function formatOccurred(entry: IncidentEntry): string {
  return formatZoned({ instant: entry.occurredAt, zoned: entry.occurredLocal });
}

function formatZoned(value: ResolvedLocalTime): string {
  const timeZone = zoneOf(value.zoned);
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    ...(timeZone ? { timeZone } : {}),
  }).format(value.instant);
}

function formatInstant(date: Date): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}
