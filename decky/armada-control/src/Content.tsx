import { PanelSection } from "@decky/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { getConfig, getInstalledGames, saveTweaks } from "./backend";
import { RgbLighting } from "./components/RgbLighting";
import { TabNavigation } from "./components/TabNavigation";
import { useDebouncedSave } from "./hooks/useDebouncedSave";
import { useLocale } from "./hooks/useLocale";
import { t } from "./i18n";
import { tabIcons } from "./icons";
import { currentGame } from "./lib/games";
import { ArmadaStyles } from "./components/ArmadaStyles";
import { LoadingState } from "./components/LoadingState";
import { ButtonRow, SupportingText } from "./components/widgets";
import { Compatibility } from "./tabs/Compatibility";
import { Profiles } from "./tabs/Profiles";
import { Controller } from "./tabs/Controller";
import { Experimental } from "./tabs/Experimental";
import { About } from "./tabs/About";
import type { Config } from "./types";

export function Content() {
  useLocale();
  const [tab, setTab] = useState("Compatibility");
  const [config, setConfig] = useState<Config | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const savedTweaksSnapshot = useRef("");
  const installedGamesRequested = useRef(false);
  const mounted = useRef(true);
  const loadRequest = useRef(0);
  const load = useCallback(async () => {
    if (!mounted.current) return;
    const request = ++loadRequest.current;
    setLoadError(null);
    try {
      const next = await getConfig();
      if (!mounted.current || request !== loadRequest.current) return;
      next.game = currentGame();
      savedTweaksSnapshot.current = JSON.stringify(next.tweaks);
      setConfig((current) => ({
        ...next,
        selectedGame: current?.selectedGame,
        installedGames: current?.installedGames || next.installedGames,
      }));
    } catch (error) {
      if (mounted.current && request === loadRequest.current) setLoadError(String(error));
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      loadRequest.current++;
    };
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
  if (!config) return <div className="armada-control-startup">
    <ArmadaStyles />
    {loadError !== null ? <PanelSection>
      <div role="alert">
        <SupportingText className="armada-note-error">{t("common.loadError")}: {loadError}</SupportingText>
      </div>
      <ButtonRow layout="below" onClick={() => { void load(); }}>{t("common.retry")}</ButtonRow>
    </PanelSection> : <LoadingState label={t("common.loadingSettings")} />}
  </div>;
  return (
    <>
      <ArmadaStyles />
      <TabNavigation
        activeTab={tab}
        onShowTab={setTab}
        tabs={[
          { id: "Compatibility", title: t("navigation.games"), icon: tabIcons.Compatibility, content: <Compatibility config={config} setConfig={setConfig} /> },
          { id: "Profiles", title: t("navigation.profiles"), icon: tabIcons.Power, content: <Profiles config={config} setConfig={setConfig} /> },
          ...(config.rgbSupported ? [
            { id: "RGB", title: t("navigation.rgb"), icon: tabIcons.RGB, content: <RgbLighting /> },
          ] : []),
          { id: "Controller", title: t("navigation.controller"), icon: tabIcons.Controller, content: <Controller config={config} setConfig={setConfig} /> },
          { id: "Experimental", title: t("navigation.experimental"), icon: tabIcons.Experimental, content: <Experimental config={config} setConfig={setConfig} /> },
          { id: "About", title: t("navigation.about"), icon: tabIcons.About, content: <About config={config} /> },
        ]}
      />
    </>
  );
}
