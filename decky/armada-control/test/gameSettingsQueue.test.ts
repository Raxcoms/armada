import assert from "node:assert/strict";
import test from "node:test";
import { runGameSettingsMutation } from "../src/lib/gameSettingsQueue.ts";

test("native game-setting writes complete in order across callers", async () => {
  const completed: string[] = [];
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const first = runGameSettingsMutation(async () => { await pending; completed.push("first"); });
  const second = runGameSettingsMutation(async () => { completed.push("second"); });
  await Promise.resolve();
  assert.deepEqual(completed, []);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(completed, ["first", "second"]);
});

test("one failed native write does not block later profile operations", async () => {
  const first = runGameSettingsMutation(async () => { throw new Error("write failed"); });
  const second = runGameSettingsMutation(async () => "saved");
  await assert.rejects(first, /write failed/);
  assert.equal(await second, "saved");
});
