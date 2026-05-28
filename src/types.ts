/**
 * Realtime Voice Translator Applet Interfaces
 */

export interface UserSession {
  userId: string;
  username: string;
  currentLanguage: string; // 'ur-PK' or 'zh-CN'
}

export type CallState = "idle" | "calling" | "incoming" | "connected" | "ended";

export interface ChatMessage {
  id: string;
  senderName: string;
  originalText: string;
  translatedText: string;
  fromLang: string;
  toLang: string;
  timestamp: Date;
}

export interface SupportLanguage {
  code: string;       // MyMemory pair code (e.g. "ur", "zh", "en")
  speechCode: string; // Web SpeechSpeechRecognition code (e.g. "ur-PK", "zh-CN", "en-US")
  ttsVoiceCode: string; // Web SpeechSynthesis code (e.g. "ur", "zh", "en")
  name: string;       // Human-readable local name
  flag: string;       // Visual emoji helper
}

export interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => any) | null;
  onresult: ((event: any) => any) | null;
  onerror: ((event: any) => any) | null;
  onend: (() => any) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

