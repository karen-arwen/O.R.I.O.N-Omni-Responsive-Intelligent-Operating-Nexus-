import { useEffect, useState } from "react";

const STORAGE_KEY = "orion-live-mode";

export const useLiveToggle = () => {
  const [live, setLive] = useState<boolean>(false);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) setLive(stored === "true");
  }, []);

  const toggleLive = () => {
    setLive((v) => {
      localStorage.setItem(STORAGE_KEY, (!v).toString());
      return !v;
    });
  };

  return { live, toggleLive };
};
