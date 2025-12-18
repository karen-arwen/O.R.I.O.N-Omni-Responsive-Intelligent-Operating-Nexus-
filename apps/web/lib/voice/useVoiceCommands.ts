"use client";

import { useEffect, useState } from "react";
import { loadJarvisSettings } from "../settings/jarvisSettings";
import { useRouter } from "next/navigation";

export const useVoiceCommands = () => {
  const [supported, setSupported] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const settings = loadJarvisSettings();
    const Speech = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!Speech || !settings.voice) return;
    setSupported(true);
  }, []);

  const startListening = () => {
    const Speech = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!Speech) return;
    const rec: any = new Speech();
    rec.lang = "en-US";
    rec.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript.toLowerCase();
      if (transcript.includes("open mission")) router.push("/mission");
      if (transcript.includes("show alerts")) router.push("/alerts");
      if (transcript.includes("open timeline")) router.push("/timeline");
      if (transcript.includes("search decision")) {
        const parts = transcript.split(" ");
        const id = parts[parts.length - 1];
        if (id) router.push(`/decisions/${id}`);
      }
    };
    rec.start();
  };

  return { supported, startListening };
};
