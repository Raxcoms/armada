import type { GameTweak } from "../types";
import { FOLLOW_STEAM_COMPAT, USE_DEFAULT_COMPAT, type CompatState } from "./steamCompat";

export function gameProfileEnabled(settings: GameTweak, tool: string, resolution: string): boolean {
  if (typeof settings.enabled === "boolean") return settings.enabled;
  if (Object.keys(settings).some((key) => key !== "name")) return true;
  return resolution !== "Default" || !!tool && tool !== USE_DEFAULT_COMPAT && tool !== FOLLOW_STEAM_COMPAT;
}

interface SteamGameSettings {
  readCompat: () => Promise<CompatState | null>;
  readResolution: () => Promise<string>;
  selectCompat: (selection: string) => Promise<void>;
  restoreCompat: (state: CompatState) => Promise<void>;
  writeResolution: (resolution: string) => Promise<void>;
  compatSelection: (state: CompatState) => string;
}

export async function changeGameProfile(
  settings: GameTweak,
  enabled: boolean,
  steam: SteamGameSettings,
): Promise<Pick<GameTweak, "enabled" | "steamCompatTool" | "steamResolution">> {
  const [compat, resolution] = await Promise.all([steam.readCompat(), steam.readResolution()]);
  if (!compat) throw new Error("Steam compatibility settings are unavailable");
  const currentTool = settings.steamCompatTool && compat.priority >= 250 && compat.tool === settings.steamCompatTool
    ? settings.steamCompatTool : steam.compatSelection(compat);
  const patch = {
    enabled,
    steamCompatTool: enabled ? settings.steamCompatTool ?? USE_DEFAULT_COMPAT : currentTool,
    steamResolution: enabled ? settings.steamResolution ?? "Default" : resolution || "Default",
  };
  try {
    await steam.selectCompat(enabled ? patch.steamCompatTool : USE_DEFAULT_COMPAT);
    await steam.writeResolution(enabled ? patch.steamResolution : "Default");
  } catch (error) {
    const restored = await Promise.allSettled([
      steam.restoreCompat(compat),
      steam.writeResolution(resolution || "Default"),
    ]);
    if (restored.some((result) => result.status === "rejected")) {
      throw new Error(`${String(error)}; Steam settings could not be restored`);
    }
    throw error;
  }
  return patch;
}
