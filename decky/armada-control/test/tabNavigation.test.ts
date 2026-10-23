import assert from "node:assert/strict";
import test from "node:test";
import { adjacentTab } from "../src/lib/tabNavigation.ts";

test("navigation wraps across both ends of the visible tab list", () => {
  const tabs = [{ id: "games" }, { id: "profiles" }, { id: "about" }];
  assert.equal(adjacentTab(tabs, "games", -1).id, "about");
  assert.equal(adjacentTab(tabs, "about", 1).id, "games");
  assert.equal(adjacentTab(tabs, "profiles", 1).id, "about");
});

test("unsupported tabs are skipped using the same filtered registry", () => {
  const tabs = ["games", "profiles", "rgb", "controller", "experimental", "about"]
    .filter((id) => id !== "rgb").map((id) => ({ id }));
  assert.equal(adjacentTab(tabs, "profiles", 1).id, "controller");
  assert.equal(adjacentTab(tabs, "controller", -1).id, "profiles");
});
