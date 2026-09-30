import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeTestDir } from "../helpers/tmp-dir";

/**
 * The incident log end to end: writing an entry with formatting, the
 * clock-change questions for a typed time, updates that keep history,
 * and pasted HTML being cleaned. The app runs in New York time so the
 * 2026 clock changes are real; Windows ignores TZ, so those two tests
 * skip there.
 *
 * Needs `npm run build` to have run first.
 */
test.describe("incident log", () => {
  let userDataDir: string;

  test.beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), "docket-e2e-incidents-"));
  });

  test.afterEach(() => {
    removeTestDir(userDataDir);
  });

  async function open(): Promise<{ close: () => Promise<void>; window: Page }> {
    const app = await electron.launch({ args: [".", `--user-data-dir=${userDataDir}`], env: { ...process.env, TZ: "America/New_York" } });
    const window = await app.firstWindow();
    await window.locator("#pass").fill("correct horse battery staple");
    await window.locator('button[type="submit"]').click();
    await window.locator('.app-nav a[aria-label="Incident log"]').click();
    return { window, close: () => app.close() };
  }

  test("an entry at a time that happened twice asks which one, then keeps every update", async () => {
    test.skip(process.platform === "win32", "Windows ignores TZ, so there's no clock change to test");
    const { window, close } = await open();

    await expect(window.getByText("No entries yet.")).toBeVisible();
    await window.getByRole("button", { name: "New entry" }).click();

    await window.getByLabel("When did it happen?").fill("2026-11-01T01:30");
    await window.getByLabel("When did it happen?").dispatchEvent("change");
    await expect(window.getByText("That time happened twice that night")).toBeVisible();

    const editor = window.getByRole("textbox", { name: "What happened" });
    await editor.click();
    await editor.pressSequentially("Came to the house at night. ");
    // Bold with no text selected applies to what is typed next.
    await window.getByRole("button", { name: "Bold" }).click();
    await expect(window.getByRole("button", { name: "Bold" })).toHaveAttribute("aria-pressed", "true");
    await editor.pressSequentially("Would not leave.");
    await window.getByLabel("Who was involved? (optional)").fill("Jordan");

    const save = window.getByRole("button", { name: "Save entry" });
    await expect(save).toBeDisabled();
    await window.getByLabel(/after the clocks went back/).check();
    await expect(save).toBeEnabled();
    await save.click();

    await expect(window.locator("h1")).toContainText("EST");
    await expect(window.locator(".rich-text strong")).toHaveText("Would not leave.");
    await expect(window.getByText("Involving Jordan.")).toBeVisible();

    await window.getByRole("button", { name: "Add an update" }).click();
    const updateEditor = window.getByRole("textbox", { name: "What happened" });
    await updateEditor.click();
    await window.keyboard.press("End");
    await updateEditor.pressSequentially(" Police were called at 2 AM.");
    await window.getByRole("button", { name: "Save update" }).click();
    await expect(window.locator(".rich-text").first()).toContainText("Police were called");
    await window.locator("summary", { hasText: "History (2 versions)" }).click();
    await expect(window.locator(".revision")).toHaveCount(2);

    await window.getByRole("button", { name: "← Back to the log" }).click();
    await expect(window.locator(".list-block-row--button")).toContainText("updated 1 time");
    await close();
  });

  test("a time the clocks skipped over is refused", async () => {
    test.skip(process.platform === "win32", "Windows ignores TZ, so there's no clock change to test");
    const { window, close } = await open();
    await window.getByRole("button", { name: "New entry" }).click();
    await window.getByLabel("When did it happen?").fill("2026-03-08T02:30");
    await window.getByLabel("When did it happen?").dispatchEvent("change");
    await expect(window.getByText("That time didn't happen that night")).toBeVisible();
    await window.getByRole("textbox", { name: "What happened" }).pressSequentially("Something happened.");
    await expect(window.getByRole("button", { name: "Save entry" })).toBeDisabled();
    await close();
  });

  test("pasted HTML keeps its text and loses scripts, images, and links", async () => {
    const { window, close } = await open();
    await window.getByRole("button", { name: "New entry" }).click();
    const editor = window.getByRole("textbox", { name: "What happened" });
    await editor.click();
    // Runs in the page. test/'s tsconfig has no DOM types, so the two
    // browser classes are typed by hand here.
    await editor.evaluate((node, html) => {
      const page = globalThis as unknown as {
        DataTransfer: new () => { setData(type: string, value: string): void };
        ClipboardEvent: new (type: string, init: object) => unknown;
      };
      const data = new page.DataTransfer();
      data.setData("text/html", html);
      (node as unknown as { dispatchEvent(event: unknown): boolean }).dispatchEvent(
        new page.ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
      );
    }, '<p>Pasted <strong>text</strong><img src=x onerror="window.pwned=1"><a href="javascript:window.pwned=1">a link</a><script>window.pwned=1</script></p>');
    await expect(editor).toContainText("Pasted text");
    await expect(editor).toContainText("a link");
    expect(await editor.locator("img, a, script").count()).toBe(0);
    await expect(editor.locator("strong")).toHaveText("text");
    expect(await window.evaluate(() => (window as unknown as { pwned?: number }).pwned)).toBeUndefined();

    await window.getByRole("button", { name: "Save entry" }).click();
    await expect(window.locator(".rich-text")).toContainText("Pasted text");
    expect(await window.locator(".rich-text img, .rich-text a").count()).toBe(0);
    await close();
  });
});
