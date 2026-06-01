import { useCallback, useEffect, useState } from "react";
import type {
  DeepPartial,
  OpenDexConfig,
  PublicConfig,
  SecretName,
} from "../../../main/config/schema";

export interface UseConfigResult {
  data: PublicConfig | null;
  loading: boolean;
  setConfig: (patch: DeepPartial<OpenDexConfig>) => Promise<void>;
  setSecret: (name: SecretName, value: string) => Promise<void>;
  completeOnboarding: () => Promise<void>;
  reload: () => Promise<void>;
}

/** Loads the public config from the main process and exposes update helpers
 *  that keep the local copy in sync. */
export function useConfig(): UseConfigResult {
  const [data, setData] = useState<PublicConfig | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const next = await window.opendex.getConfig();
    setData(next);
  }, []);

  useEffect(() => {
    let active = true;
    window.opendex
      .getConfig()
      .then((next) => {
        if (active) setData(next);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const setConfig = useCallback(async (patch: DeepPartial<OpenDexConfig>) => {
    setData(await window.opendex.setConfig(patch));
  }, []);

  const setSecret = useCallback(async (name: SecretName, value: string) => {
    setData(await window.opendex.setSecret(name, value));
  }, []);

  const completeOnboarding = useCallback(async () => {
    setData(await window.opendex.completeOnboarding());
  }, []);

  return { data, loading, setConfig, setSecret, completeOnboarding, reload };
}
