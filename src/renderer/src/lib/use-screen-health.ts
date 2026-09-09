import { useEffect, useState } from "react";
import type { ScreenHealth } from "../../../main/config/screen-health";

export function useScreenHealth() {
  const [health, setHealth] = useState<ScreenHealth | null>(null);
  useEffect(() => {
    let live = true;
    let updated = false;
    const off = window.opendex.onScreenHealth((status) => { updated = true; setHealth(status); });
    void window.opendex.getScreenHealth().then((status) => { if (live && !updated) setHealth(status); });
    return () => { live = false; off(); };
  }, []);
  return health;
}
