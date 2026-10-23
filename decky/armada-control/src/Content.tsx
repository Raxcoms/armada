import { Field, PanelSection, Tabs } from "@decky/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { getConfig, getInstalledGames, saveTweaks } from "./backend";
import { RgbLighting } from "./components/RgbLighting";
import { useDebouncedSave } from "./hooks/useDebouncedSave";
import { useLocale } from "./hooks/useLocale";
import { t } from "./i18n";
import { tabIcons } from "./icons";
import { currentGame } from "./lib/games";
import { styles } from "./styles";
import { Compatibility } from "./tabs/Compatibility";
import { Profiles } from "./tabs/Profiles";
import { Settings } from "./tabs/Settings";
import type { Config } from "./types";

export function Content() {
  useLocale();
  const [tab, setTab] = useState("Compatibility");
  const [config, setConfig] = useState<Config | null>(null);
  const [message, setMessage] = useState("Loading");
  const savedTweaksSnapshot = useRef("");
  const installedGamesRequested = useRef(false);
  const load = useCallback(async () => {
    try {
      const next = await getConfig();
      next.game = currentGame();
      next.selectedGame = next.game || null;
      savedTweaksSnapshot.current = JSON.stringify(next.tweaks);
      setConfig((current) => ({ ...next, installedGames: current?.installedGames || next.installedGames }));
    } catch (error) {
      setMessage(String(error));
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (!config || installedGamesRequested.current) return;
    installedGamesRequested.current = true;
    let cancelled = false;
    getInstalledGames()
      .then((installedGames) => {
        if (cancelled) return;
        setConfig((current) => (current ? { ...current, installedGames } : current));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [!!config]);
  useEffect(() => {
    if (!config) return;
    let cancelled = false;
    const refreshRuntime = async () => {
      try {
        const runtimeGame = currentGame();
        if (cancelled) return;
        setConfig((current) => {
          if (!current) return current;
          const currentApp = current.game?.appid || "";
          const nextApp = runtimeGame?.appid || "";
          const currentName = current.game?.name || "";
          const nextName = runtimeGame?.name || "";
          if (currentApp === nextApp && currentName === nextName) return current;
          return { ...current, game: runtimeGame };
        });
      } catch (error) {
      }
    };
    const timer = window.setInterval(refreshRuntime, 2000);
    refreshRuntime();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [!!config]);
  useDebouncedSave({ config, field: "tweaks", snapshot: savedTweaksSnapshot, save: saveTweaks, setConfig, onError: load });
  if (!config) return <PanelSection title="Armada Control"><Field label={message === "Loading" ? t("common.loading") : message} /></PanelSection>;
  const tabContent = (content: ReactNode) => (
    <div className="armada-control-tab-content">{content}</div>
  );
  return (
    <div className="armada-control-tabs">
      <style>{styles}</style>
      <Tabs
        activeTab={tab}
        onShowTab={setTab}
        tabs={[
          { id: "Compatibility", title: tabIcons.Compatibility, content: tabContent(<Compatibility config={config} setConfig={setConfig} />) },
          { id: "Profiles", title: tabIcons.Power, content: tabContent(<Profiles config={config} setConfig={setConfig} />) },
          ...(config.rgbSupported ? [
            { id: "RGB", title: tabIcons.RGB, content: tabContent(<RgbLighting />) },
          ] : []),
          { id: "Advanced", title: tabIcons.Advanced, content: tabContent(<Settings config={config} setConfig={setConfig} />) },
        ]}
      />
    </div>
  );
}
