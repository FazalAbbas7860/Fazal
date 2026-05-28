import React, { useState, useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { 
  Phone, 
  PhoneOff, 
  Mic, 
  MicOff, 
  User, 
  Copy, 
  Check, 
  Globe, 
  RefreshCw, 
  AlertCircle, 
  Volume2, 
  VolumeX, 
  Languages, 
  Wifi, 
  PhoneIncoming,
  Activity,
  History,
  Info,
  Lock,
  Shield
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { UserSession, CallState, ChatMessage, SupportLanguage, SpeechRecognition } from "./types";

// Supported Translator Languages
const SUPPORTED_LANGUAGES: SupportLanguage[] = [
  { code: "ur", speechCode: "ur-PK", ttsVoiceCode: "ur", name: "Urdu (اردو)", flag: "🇵🇰" },
  { code: "zh", speechCode: "zh-CN", ttsVoiceCode: "zh", name: "Chinese (中文)", flag: "🇨🇳" },
  { code: "en", speechCode: "en-US", ttsVoiceCode: "en", name: "English (US)", flag: "🇺🇸" }
];

export default function App() {
  // Session States
  const [session, setSession] = useState<UserSession | null>(null);
  const [registering, setRegistering] = useState<boolean>(false);
  const [registerError, setRegisterError] = useState<string>("");
  const [onlineCount, setOnlineCount] = useState<number>(1);
  const [copiedId, setCopiedId] = useState<boolean>(false);

  // Input Fields
  const [inputUsername, setInputUsername] = useState<string>("");
  const [inputLanguage, setInputLanguage] = useState<string>("ur-PK");
  const [inputUserId, setInputUserId] = useState<string>("");
  const [friendIdToCall, setFriendIdToCall] = useState<string>("");

  // Call States
  const [callState, setCallState] = useState<CallState>("idle");
  const [peerSession, setPeerSession] = useState<UserSession | null>(null);
  const [incomingCallData, setIncomingCallData] = useState<{
    callerSocketId: string;
    callerId: string;
    callerName: string;
    callerLang: string;
  } | null>(null);

  // Audio & Toggles state
  const [isMicMuted, setIsMicMuted] = useState<boolean>(false);
  const [isTtsMuted, setIsTtsMuted] = useState<boolean>(false);
  const [isRecognitionActive, setIsRecognitionActive] = useState<boolean>(true);
  const [connectionStatus, setConnectionStatus] = useState<string>("Disconnected");

  // Captions & History state
  const [myCaption, setMyCaption] = useState<string>("");
  const [myTranslation, setMyTranslation] = useState<string>("");
  const [peerCaption, setPeerCaption] = useState<string>("");
  const [peerTranslation, setPeerTranslation] = useState<string>("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isTranslating, setIsTranslating] = useState<boolean>(false);

  // Errors / Warnings
  const [appError, setAppError] = useState<string>("");
  const [browserNotice, setBrowserNotice] = useState<string>("");

  // WebRTC & Client Refs
  const socketRef = useRef<Socket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const iceCandidatesQueue = useRef<RTCIceCandidateInit[]>([]);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  // State Trackers helper refs to avoid closure pitfalls inside async speech events
  const callStateRef = useRef<CallState>("idle");
  const localLangRef = useRef<string>("ur-PK");
  const peerLangRef = useRef<string>("");
  const isMicMutedRef = useRef<boolean>(false);
  const isTtsMutedRef = useRef<boolean>(false);
  const isRecognitionActiveRef = useRef<boolean>(true);
  const peerSocketIdRef = useRef<string | null>(null);

  // Sync state trackers
  useEffect(() => { callStateRef.current = callState; }, [callState]);
  useEffect(() => { localLangRef.current = session?.currentLanguage || "ur-PK"; }, [session?.currentLanguage]);
  useEffect(() => { peerLangRef.current = peerSession?.currentLanguage || ""; }, [peerSession?.currentLanguage]);
  useEffect(() => { isMicMutedRef.current = isMicMuted; }, [isMicMuted]);
  useEffect(() => { isTtsMutedRef.current = isTtsMuted; }, [isTtsMuted]);
  useEffect(() => { isRecognitionActiveRef.current = isRecognitionActive; }, [isRecognitionActive]);

  // Generate random digits ID on start
  useEffect(() => {
    const randomId = Math.floor(10000 + Math.random() * 90000).toString();
    setInputUserId(randomId);

    // Initial check for HTML5 SpeechRecognition
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setBrowserNotice(
        "Voice speech transcribing is restricted on this browser. For live translation, please open the application in Google Chrome or Android Browser."
      );
    }

    // Try starting speech engines safely
    if ("speechSynthesis" in window) {
      window.speechSynthesis.getVoices();
    }
  }, []);

  // Set up remote audio HTML element programmatically
  useEffect(() => {
    const audioEl = document.createElement("audio");
    audioEl.autoplay = true;
    audioEl.id = "remote-audio-player";
    remoteAudioRef.current = audioEl;
    document.body.appendChild(audioEl);

    return () => {
      if (remoteAudioRef.current) {
        document.body.removeChild(remoteAudioRef.current);
      }
    };
  }, []);

  // Connect & Bind socket listeners
  const connectSignalServer = (userId: string, username: string, lang: string) => {
    setRegistering(true);
    setRegisterError("");

    // Setup socket client pointing to our current host
    const socket = io({
      transports: ["websocket", "polling"],
      reconnectionAttempts: 5,
      reconnectionDelay: 2000
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnectionStatus("Connected to Signal Server");
      // Request User ID registration
      socket.emit("register", { userId, username, currentLanguage: lang });
    });

    socket.on("connect_error", () => {
      setConnectionStatus("Signal connection error");
      setRegistering(false);
      setRegisterError("Failed to reach signalling network. Is server running?");
    });

    socket.on("registered", (data) => {
      setSession({
        userId: data.userId,
        username: data.username,
        currentLanguage: data.currentLanguage
      });
      setRegistering(false);
      setConnectionStatus("Registered & Live");
    });

    socket.on("registration-failed", (data) => {
      setRegisterError(data.error);
      setRegistering(false);
      socket.disconnect();
    });

    socket.on("online-count", (count) => {
      setOnlineCount(count);
    });

    // ── Incoming Call Handlers ──
    socket.on("incoming-call", (data) => {
      // If we are already in an active call, auto reject with busy or ignore
      if (callStateRef.current !== "idle") {
        socket.emit("reject-call", { callerSocketId: data.callerSocketId });
        return;
      }
      setIncomingCallData(data);
      setCallState("incoming");
    });

    socket.on("call-accepted", async (data) => {
      peerSocketIdRef.current = data.calleeSocketId;
      setPeerSession({
        userId: data.calleeId,
        username: data.calleeName,
        currentLanguage: data.calleeLang
      });
      setCallState("connected");
      setAppError("");

      // Unlock speech synthesis immediately upon connection action
      unlockSpeechSynthesis();

      // Setup WebRTC and create sdp offer
      await initWebRtcPeerConnection(data.calleeSocketId, true);
    });

    socket.on("call-rejected", () => {
      setCallState("idle");
      setAppError("Call was declined or friend is busy.");
    });

    socket.on("call-hung-up", () => {
      handleDisconnectCleanup();
      setAppError("Friend ended the Call.");
    });

    // ── WebRTC Signaling Relays ──
    socket.on("sdp-offer", async (data) => {
      peerSocketIdRef.current = data.senderSocketId;
      await initWebRtcPeerConnection(data.senderSocketId, false);
      
      try {
        await pcRef.current!.setRemoteDescription(new RTCSessionDescription(data.sdp));
        
        // Drain buffered ICE Candidates
        while (iceCandidatesQueue.current.length > 0) {
          const cand = iceCandidatesQueue.current.shift();
          await pcRef.current!.addIceCandidate(new RTCIceCandidate(cand));
        }

        const answer = await pcRef.current!.createAnswer();
        await pcRef.current!.setLocalDescription(answer);
        
        socketRef.current!.emit("sdp-answer", {
          targetSocketId: data.senderSocketId,
          sdp: answer
        });
      } catch (err) {
        console.error("Error setting SDP Offer / Creating Answer:", err);
      }
    });

    socket.on("sdp-answer", async (data) => {
      try {
        if (pcRef.current) {
          await pcRef.current.setRemoteDescription(new RTCSessionDescription(data.sdp));
        }
      } catch (err) {
        console.error("Error setting SDP Answer:", err);
      }
    });

    socket.on("ice-candidate", async (data) => {
      try {
        if (pcRef.current && pcRef.current.remoteDescription) {
          await pcRef.current.addIceCandidate(new RTCIceCandidate(data.candidate));
        } else {
          iceCandidatesQueue.current.push(data.candidate);
        }
      } catch (err) {
        console.error("Error handling incoming ICE candidate:", err);
      }
    });

    // ── Dialog subtitle messaging ──
    socket.on("voice-subtitle", (data) => {
      const originalText = data.text;
      const translated = data.translatedText;
      const targetLang = data.to;

      // Update peer caption states
      setPeerCaption(originalText);
      setPeerTranslation(translated);

      // Append to scroll history
      const newMsg: ChatMessage = {
        id: crypto.randomUUID(),
        senderName: peerSession?.username || "Friend",
        originalText: originalText,
        translatedText: translated,
        fromLang: data.from,
        toLang: data.to,
        timestamp: new Date()
      };
      setMessages((prev) => [newMsg, ...prev]);

      // Speak it out! (TTS synthesis)
      if (!isTtsMutedRef.current) {
        speakTranslatedText(translated, targetLang);
      }
    });

    socket.on("peer-disconnected", (data) => {
      if (peerSession && data.userId === peerSession.userId) {
        handleDisconnectCleanup();
        setAppError("Call disconnected because your friend left.");
      }
    });
  };

  // ── WebRTC Implementation ──
  const initWebRtcPeerConnection = async (partnerSocketId: string, isInitiator: boolean) => {
    try {
      // 1. Get audio microphone streaming
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      localStreamRef.current = stream;

      // 2. Instantiate peer connection with our required high-quality China-compatible STUN servers
      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
          { urls: "stun:stun.miwifi.com:3478" },
          { urls: "stun:stun.chat.bilibili.com:3478" },
          { urls: "stun:stun.qq.com:3478" },
          { urls: "stun:stun.douyucdn.cn:18000" }
        ],
        iceCandidatePoolSize: 10
      });

      pcRef.current = pc;

      // Ensure local tracks are attached
      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });

      // Handle ICE Candidates
      pc.onicecandidate = (event) => {
        if (event.candidate && socketRef.current) {
          socketRef.current.emit("ice-candidate", {
            targetSocketId: partnerSocketId,
            candidate: event.candidate
          });
        }
      };

      // Play Remote Voice Track stream
      pc.ontrack = (event) => {
        console.log("Remote track received successfully!");
        if (remoteAudioRef.current && event.streams[0]) {
          remoteAudioRef.current.srcObject = event.streams[0];
          remoteAudioRef.current.play().catch(err => {
            console.warn("Auto-play blocked, wait for speech synthesiser unlock gesture", err);
          });
        }
      };

      // If initiator, negotiate SDP Offer
      if (isInitiator) {
        const offer = await pc.createOffer({
          offerToReceiveAudio: true
        });
        await pc.setLocalDescription(offer);
        socketRef.current!.emit("sdp-offer", {
          targetSocketId: partnerSocketId,
          sdp: offer
        });
      }

      // Start transcribing!
      startSpeechRecognition();

    } catch (err: any) {
      console.error("Microphone configuration or WebRTC failed:", err);
      setAppError("Could not access microphone. Please allow micro-device settings.");
      handleHangUp();
    }
  };

  // ── Registration Handler ──
  const handleRegister = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanId = inputUserId.trim().toLowerCase();
    const cleanName = inputUsername.trim();

    if (!cleanId || !cleanName) {
      setRegisterError("Please enter your display name and ID preference.");
      return;
    }

    connectSignalServer(cleanId, cleanName, inputLanguage);
  };

  // ── Initiate Call Handler ──
  const handleStartCall = () => {
    const friendId = friendIdToCall.trim().toLowerCase();
    if (!friendId) {
      setAppError("Please fill in your friend's 5-digit live ID.");
      return;
    }
    if (session && friendId === session.userId) {
      setAppError("You cannot call your own ID!");
      return;
    }

    setAppError("");
    setCallState("calling");

    // Pre-emptively fetch callee name & language structure to check online presence
    socketRef.current?.emit("check-friend", { friendId }, (res: { online: boolean; username?: string; language?: string }) => {
      if (res.online) {
        // Friend is online, trigger Socket signaling protocol
        setPeerSession({
          userId: friendId,
          username: res.username || "Friend",
          currentLanguage: res.language || "zh-CN"
        });
        
        socketRef.current?.emit("call-user", {
          targetUserId: friendId,
          callerId: session?.userId,
          callerName: session?.username,
          callerLang: session?.currentLanguage
        });
      } else {
        setCallState("idle");
        setAppError("Your friend is not logged in. Tell them to register their 5-digit ID first!");
      }
    });
  };

  // ── Accept Call Handler ──
  const handleAcceptCall = () => {
    if (!incomingCallData) return;

    setPeerSession({
      userId: incomingCallData.callerId,
      username: incomingCallData.callerName,
      currentLanguage: incomingCallData.callerLang
    });

    socketRef.current?.emit("accept-call", {
      callerSocketId: incomingCallData.callerSocketId,
      calleeId: session?.userId,
      calleeName: session?.username,
      calleeLang: session?.currentLanguage
    });

    setCallState("connected");
    setIncomingCallData(null);
    setAppError("");

    // Unlock speech synthesiser immediately
    unlockSpeechSynthesis();
  };

  // ── Decline Call Handler ──
  const handleDeclineCall = () => {
    if (incomingCallData) {
      socketRef.current?.emit("reject-call", {
        callerSocketId: incomingCallData.callerSocketId
      });
    }
    setIncomingCallData(null);
    setCallState("idle");
  };

  // ── Call Termination Hang-Up ──
  const handleHangUp = () => {
    if (socketRef.current && peerSocketIdRef.current) {
      socketRef.current.emit("hang-up", {
        targetSocketId: peerSocketIdRef.current
      });
    }
    handleDisconnectCleanup();
  };

  // ── Peer connection & stream teardown ──
  const handleDisconnectCleanup = () => {
    setCallState("idle");
    setPeerSession(null);
    setMyCaption("");
    setMyTranslation("");
    setPeerCaption("");
    setPeerTranslation("");
    peerSocketIdRef.current = null;

    // WebRTC connection closing
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }

    // Capture microphone device release
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }

    // Speech engine teardown
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {
        console.warn(e);
      }
      recognitionRef.current = null;
    }

    iceCandidatesQueue.current = [];
  };

  // ── Speech Recognition Engine ──
  const startSpeechRecognition = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    // Stop existing model session
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch(e){}
    }

    const rec = new SpeechRecognition();
    recognitionRef.current = rec;

    // Set configuration
    rec.continuous = false; // We use automatic pause splitting to translate phrase by phrase
    rec.interimResults = false;
    rec.lang = localLangRef.current; // Speech engine locale, e.g. "ur-PK" / "zh-CN"

    rec.onstart = () => {
      console.log("SpeechRecognition started in language locale:", rec.lang);
    };

    rec.onresult = async (event: any) => {
      const resultIndex = event.resultIndex;
      const transcriptText = event.results[resultIndex][0].transcript;

      if (!transcriptText || transcriptText.trim() === "") return;

      // If mic is muted, discard transcript locally
      if (isMicMutedRef.current) return;

      setMyCaption(transcriptText);
      setIsTranslating(true);

      // Trigger Translation proxy on Express
      const fromLocale = localLangRef.current.split("-")[0]; // ur or zh
      const toLocale = peerLangRef.current.split("-")[0];    // zh or ur

      try {
        const url = `/api/translate?text=${encodeURIComponent(transcriptText)}&from=${fromLocale}&to=${toLocale}`;
        const res = await fetch(url);
        const data = await res.json();
        
        let translated = "Translation unavailable";
        if (data && data.translatedText) {
          translated = data.translatedText;
        }

        setMyTranslation(translated);

        // Share translated subtitles dialog with connected peer via Socket
        if (socketRef.current && peerSocketIdRef.current) {
          socketRef.current.emit("voice-subtitle", {
            targetSocketId: peerSocketIdRef.current,
            text: transcriptText,
            translatedText: translated,
            from: fromLocale,
            to: toLocale
          });
        }

        // Add transaction block to history logs
        const newMsg: ChatMessage = {
          id: crypto.randomUUID(),
          senderName: session?.username || "Me",
          originalText: transcriptText,
          translatedText: translated,
          fromLang: fromLocale,
          toLang: toLocale,
          timestamp: new Date()
        };
        setMessages((prev) => [newMsg, ...prev]);

      } catch (err) {
        console.error("Translation proxy fetch error:", err);
        setMyTranslation("Translation unavailable");
      } finally {
        setIsTranslating(false);
      }
    };

    rec.onerror = (e: any) => {
      console.warn("Speech recognition error:", e.error);
    };

    rec.onend = () => {
      // If we are still connected, microphone is hot, and translation is ongoing, auto-restart the engine!
      if (callStateRef.current === "connected" && isRecognitionActiveRef.current && !isMicMutedRef.current) {
        try {
          rec.start();
        } catch (err) {
          console.warn("Speech recognition loop restart ignored:", err);
        }
      }
    };

    try {
      rec.start();
    } catch(err) {
      console.error("SpeechRecognition start exception:", err);
    }
  };

  // Toggle speech recognition manual state
  useEffect(() => {
    if (callState === "connected") {
      if (isRecognitionActive && !isMicMuted) {
        startSpeechRecognition();
      } else {
        if (recognitionRef.current) {
          recognitionRef.current.stop();
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRecognitionActive, isMicMuted, callState]); // startSpeechRecognition only uses refs — safe to omit

  // Translate code utility
  const getLanguageFlag = (localeCode: string) => {
    if (localeCode.startsWith("ur")) return "🇵🇰";
    if (localeCode.startsWith("zh")) return "🇨🇳";
    return "🇺🇸";
  };

  const getLanguageName = (localeCode: string) => {
    if (localeCode.startsWith("ur")) return "Urdu (اردو)";
    if (localeCode.startsWith("zh")) return "Chinese (中文)";
    return "English";
  };

  // Toggle Microphone Mute status
  const toggleMuteMicrophone = () => {
    const newMutedState = !isMicMuted;
    setIsMicMuted(newMutedState);
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((track) => {
        track.enabled = !newMutedState;
      });
    }
  };

  // ── Speech Synthesis Utterer (TTS) ──
  const speakTranslatedText = (text: string, langCode: string) => {
    if (!("speechSynthesis" in window)) return;
    if (text === "Translation unavailable") return;

    try {
      // Cancel previous playback to sync to current sentence pace
      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      const voices = window.speechSynthesis.getVoices();

      // Filter perfect matches for "ur-PK" / "ur" or "zh-CN" / "zh" (Chinese)
      const targetQuery = langCode.toLowerCase();
      const matchedVoice = voices.find(v => v.lang.toLowerCase() === targetQuery) ||
                           voices.find(v => v.lang.toLowerCase().startsWith(targetQuery)) ||
                           voices.find(v => v.lang.toLowerCase().includes(targetQuery));

      if (matchedVoice) {
        utterance.voice = matchedVoice;
        console.log("TTS selected voice model:", matchedVoice.name, matchedVoice.lang);
      } else {
        console.warn("No perfect TTS hardware voice found for language:", targetQuery);
      }

      utterance.rate = 0.95; // Slightly slower pacing for beginner friendly clarity
      utterance.pitch = 1.0;

      window.speechSynthesis.speak(utterance);
    } catch (e) {
      console.error("Speech Synthesis failed:", e);
    }
  };

  // Helper gesture unlock to enable Web Audio & TTS context on mobile browsers
  const unlockSpeechSynthesis = () => {
    if ("speechSynthesis" in window) {
      const soundless = new SpeechSynthesisUtterance("");
      window.speechSynthesis.speak(soundless);
    }
  };

  // Helper copy link user ID
  const copyUserIdToClipboard = () => {
    if (!session) return;
    navigator.clipboard.writeText(session.userId);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  return (
    <div className="min-h-screen bg-[#030712] text-slate-150 font-sans flex flex-col items-center justify-between antialiased selection:bg-indigo-500/30 selection:text-indigo-200">
      {/* Upper Navigation / Bar */}
      <header className="w-full bg-[#050b18]/80 backdrop-blur-xl border-b border-indigo-950/50 py-4 px-6 sticky top-0 z-50 shadow-[0_5px_25px_rgba(0,0,0,0.5)]">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shadow-[0_0_15px_rgba(99,102,241,0.25)]">
              <Languages className="w-5 h-5 animate-pulse" id="header-logo-icon" />
            </div>
            <div>
              <h1 className="text-lg font-black tracking-tight text-white leading-tight">Live Translator</h1>
              <span className="text-[10px] text-slate-500 flex items-center gap-1 font-mono uppercase tracking-wider font-bold">
                <Activity className="w-3 h-3 text-emerald-500 animate-pulse" />
                Urdu ↔ Chinese Realtime Call
              </span>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            {session ? (
              <div className="flex items-center space-x-2 bg-slate-900 border border-indigo-950/60 transition-colors py-1.5 px-3 rounded-full text-xs font-semibold text-slate-300 shadow-inner">
                <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_#10b981] animate-pulse"></span>
                <span className="max-w-[100px] truncate">{session.username}</span>
                <span className="font-mono text-[10px] bg-[#020617] py-0.5 px-1.5 rounded-md border border-indigo-950/40 text-slate-400">ID: {session.userId}</span>
              </div>
            ) : (
              <div className="text-xs text-slate-500 flex items-center gap-1 font-mono uppercase tracking-wider">
                <Wifi className="w-3 h-3 animate-ping text-neutral-600" />
                Network offline
              </div>
            )}
            
            <span className="text-xs font-mono font-bold bg-indigo-500/10 text-indigo-300 py-1.5 px-3 rounded-lg border border-indigo-500/20 shadow-[0_0_10px_rgba(99,102,241,0.1)]">
              {onlineCount} active
            </span>
          </div>
        </div>
      </header>

      {/* Main Container Area */}
      <main className="flex-1 w-full max-w-4xl px-4 py-8 flex flex-col items-center justify-center gap-10">
        <AnimatePresence mode="wait">
          
          {/* ── STAGE 1: REGISTRATION / SELECTION ── */}
          {!session && (
            <motion.div 
              key="auth-view"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.25 }}
              className="w-full max-w-md card-3d p-8 relative overflow-hidden"
            >
              {/* Sleek aesthetic top glows */}
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-indigo-500/60 to-transparent"></div>
              <div className="absolute -top-10 -right-10 w-28 h-28 bg-indigo-500/10 rounded-full blur-2xl pointer-events-none"></div>
              <div className="absolute -bottom-10 -left-10 w-28 h-28 bg-emerald-500/5 rounded-full blur-2xl pointer-events-none"></div>

              <div className="text-center mb-6 relative z-10">
                <div className="mx-auto flex items-center gap-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full px-2.5 py-0.5 text-[10px] font-mono font-black uppercase tracking-widest leading-none mb-3.5 max-w-max">
                  <Lock className="w-3 h-3 text-emerald-400 animate-pulse" /> WebRTC DTLS Secured
                </div>
                <div className="mx-auto w-14 h-14 rounded-2xl bg-gradient-to-tr from-indigo-500/20 to-purple-500/20 flex items-center justify-center text-indigo-400 mb-4 shadow-[0_0_20px_rgba(99,102,241,0.25),inset_0_2px_4px_rgba(255,255,255,0.1)] border border-indigo-500/30 hover:scale-105 transition-transform duration-300">
                  <User className="w-6 h-6 text-indigo-300 drop-shadow-[0_2px_4px_rgba(99,102,241,0.5)]" />
                </div>
                <h2 className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-b from-white via-slate-100 to-indigo-200 tracking-tight drop-shadow-sm">Create Spoken Session</h2>
                <p className="text-sm text-slate-400 mt-2 font-semibold">
                  Translate spoken voices instantly over direct voice calls.
                </p>
              </div>

              {registerError && (
                <div className="mb-4 p-3 bg-rose-500/10 border border-rose-500/25 text-rose-300 rounded-xl text-xs flex items-center gap-2 display-dark-inset-3d">
                  <AlertCircle className="w-4.5 h-4.5 shrink-0 text-rose-450" />
                  <span>{registerError}</span>
                </div>
              )}

              <form onSubmit={handleRegister} className="space-y-5">
                {/* Username */}
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-indigo-400 mb-2">
                    My Account Name
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Enter friend-visible name (e.g. Aslam)"
                    value={inputUsername}
                    onChange={(e) => setInputUsername(e.target.value)}
                    className="w-full px-4 py-3.5 bg-[#020617] border border-indigo-950/40 rounded-xl text-sm focus:outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500/80 focus:bg-[#040a20] transition-all text-white display-dark-inset-3d hover:border-indigo-500/25 placeholder:text-slate-600 font-semibold"
                    maxLength={15}
                    id="input-account-name"
                  />
                </div>

                {/* Preferred ID (Option) */}
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-indigo-400 mb-2">
                    My Translation Unique ID (5 Digits)
                  </label>
                  <input
                    type="text"
                    required
                    pattern="[a-zA-Z0-9]{3,10}"
                    placeholder="5 digit ID"
                    value={inputUserId}
                    onChange={(e) => setInputUserId(e.target.value.replace(/[^a-zA-Z0-9]/g, ''))}
                    className="w-full px-4 py-3.5 font-mono bg-[#020617] border border-indigo-950/40 rounded-xl focus:outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500/80 focus:bg-[#040a20] transition-all text-white display-dark-inset-3d text-center text-lg tracking-widest font-black hover:border-indigo-500/25"
                    maxLength={8}
                    id="input-user-unique-id"
                  />
                  <span className="text-[11px] text-slate-500 mt-1 block">
                    Share this ID code with your friend so they can call you.
                  </span>
                </div>

                {/* Preferred Accent Languages selection */}
                <div>
                  <label className="block text-xs font-black uppercase tracking-wider text-indigo-400 mb-3">
                    Your Language (My Spoken Accent)
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {SUPPORTED_LANGUAGES.map((lang) => (
                      <button
                        key={lang.speechCode}
                        type="button"
                        onClick={() => setInputLanguage(lang.speechCode)}
                        className={`py-3 px-1 text-center rounded-xl border font-medium text-xs flex flex-col items-center justify-center gap-1 transition-all lang-selector-btn-3d cursor-pointer ${
                          inputLanguage === lang.speechCode
                            ? "selected"
                            : "border-indigo-950/40 bg-[#020617] text-slate-400 hover:border-indigo-500/30"
                        }`}
                      >
                        <span className="text-2xl filter drop-shadow-[0_2px_4px_rgba(0,0,0,0.3)]">{lang.flag}</span>
                        <span className="font-extrabold truncate w-full px-0.5">{lang.name.split(" ")[0]}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Form entry button */}
                <button
                  type="submit"
                  disabled={registering}
                  className="w-full py-4 btn-3d-indigo text-white font-bold rounded-xl text-sm transition-all disabled:opacity-50 flex items-center justify-center gap-2 mt-2 cursor-pointer"
                  id="primary-register-btn"
                >
                  {registering ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Connecting translator hub...
                    </>
                  ) : (
                    "Register Spoken Session"
                  )}
                </button>
              </form>
            </motion.div>
          )}

          {/* ── STAGE 2: DIALER DASHBOARD ── */}
          {session && callState === "idle" && (
            <motion.div
              key="dialer-view"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.25 }}
              className="w-full max-w-md card-3d p-8 relative overflow-hidden"
            >
              {/* Sleek aesthetic top glows */}
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-indigo-500/60 to-transparent"></div>
              <div className="absolute -top-10 -right-10 w-28 h-28 bg-indigo-500/10 rounded-full blur-2xl pointer-events-none"></div>
              <div className="absolute -bottom-10 -left-10 w-28 h-28 bg-emerald-500/5 rounded-full blur-2xl pointer-events-none"></div>

              {/* User Identity Highlight */}
              <div className="display-dark-inset-3d p-5 mb-4 bg-slate-950/40 border-indigo-950/30 relative z-10">
                <span className="text-[10px] uppercase font-mono font-bold tracking-widest text-indigo-400">My Calling Profile</span>
                <div className="flex items-center justify-between mt-2">
                  <div className="flex items-center gap-3">
                    <span className="text-4xl filter drop-shadow-[0_2px_4px_rgba(0,0,0,0.35)]">{getLanguageFlag(session.currentLanguage)}</span>
                    <div>
                      <h3 className="font-extrabold text-white text-base">{session.username}</h3>
                      <p className="text-xs text-indigo-300 font-bold">Speaks: {getLanguageName(session.currentLanguage)}</p>
                    </div>
                  </div>
                  
                  {/* Copy Button */}
                  <button
                    onClick={copyUserIdToClipboard}
                    className="flex items-center gap-1.5 text-[11px] font-mono btn-3d-slate py-2 px-3 rounded-xl transition-all cursor-pointer"
                  >
                    {copiedId ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400 font-bold" />
                        <span className="text-emerald-400 font-black">Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5 text-slate-400" />
                        <span>ID: <b className="text-[#3b82f6] font-extrabold tracking-wide">{session.userId}</b></span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2 justify-center py-2.5 px-4 bg-emerald-500/5 border border-emerald-500/12 rounded-xl text-emerald-400 font-mono text-[10px] font-bold mb-5 shadow-inner relative z-10">
                <Shield className="w-4 h-4 shrink-0 text-emerald-400" />
                <span>P2P WebRTC DTLS ENCRYPTED STREAM ACTIVE</span>
              </div>

              {appError && (
                <div className="mb-4 p-3 bg-rose-500/10 border border-rose-500/25 text-rose-300 rounded-xl text-xs flex items-center gap-2 display-dark-inset-3d">
                  <AlertCircle className="w-4.5 h-4.5 shrink-0 text-rose-450" />
                  <span>{appError}</span>
                </div>
              )}

              {/* Call Friend Action Block */}
              <div className="space-y-4">
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-indigo-400 mb-2">
                    Enter Friend's 5-Digit ID to Connect
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="e.g. 52391"
                      value={friendIdToCall}
                      onChange={(e) => setFriendIdToCall(e.target.value.replace(/[^a-zA-Z0-9]/g, ""))}
                      className="w-full pl-4 pr-12 py-3.5 font-mono bg-[#020617] border border-indigo-950/40 rounded-xl text-lg tracking-widest font-black placeholder:font-sans placeholder:tracking-normal placeholder:font-semibold focus:outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500/80 focus:bg-[#040a20] transition-all text-white display-dark-inset-3d text-center hover:border-indigo-500/25"
                      maxLength={8}
                      id="friend-id-input"
                    />
                    <div className="absolute top-1/2 right-3.5 -translate-y-1/2 w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center text-indigo-400 border border-indigo-500/30 shadow-sm">
                      <Globe className="w-4 h-4 text-indigo-400" />
                    </div>
                  </div>
                </div>

                <button
                  onClick={handleStartCall}
                  className="w-full py-4 btn-3d-indigo text-white font-black rounded-xl text-sm transition-all flex items-center justify-center gap-2 cursor-pointer"
                  id="friend-dial-btn"
                >
                  <Phone className="w-4 h-4 shrink-0 fill-current text-indigo-200" />
                  <span>Call Friend & Start Translating</span>
                </button>
              </div>

              {/* Guide card */}
              <div className="mt-6 border-t border-indigo-950/50 pt-5 flex gap-3 text-slate-400 text-xs leading-relaxed">
                <Info className="w-4.5 h-4.5 text-indigo-400 shrink-0 mt-0.5" />
                <div>
                  <p className="font-extrabold text-white">How to Translate Live:</p>
                  <p className="mt-1 text-slate-400">
                    Send your 5-digit ID to your friend. Put your IDs in, then press Call. The app will automatically capture speech, proxy translation via MyMemory, and play target voices back with correct accents.
                  </p>
                </div>
              </div>

              {browserNotice && (
                <div className="mt-5 p-3.5 bg-amber-500/10 rounded-xl border border-amber-500/25 text-[11px] text-amber-300 leading-normal flex gap-2 display-dark-inset-3d">
                  <AlertCircle className="w-4.5 h-4.5 shrink-0 mt-0.5 text-amber-500" />
                  <span>{browserNotice}</span>
                </div>
              )}
            </motion.div>
          )}

          {/* ── STAGE 3: OUTGOING RINGING CALL ── */}
          {callState === "calling" && (
            <motion.div
              key="ringing-view"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="w-full max-w-md card-3d p-8 text-center"
            >
              <div className="relative mx-auto w-24 h-24 mb-6">
                {/* Wave pulsers */}
                <span className="absolute inset-0 bg-indigo-500/10 rounded-full animate-ping opacity-60"></span>
                <span className="absolute -inset-2 bg-indigo-500/5 rounded-full animate-pulse opacity-40"></span>
                <div className="absolute inset-0 rounded-full btn-3d-indigo flex items-center justify-center text-white">
                  <Phone className="w-10 h-10 animate-shake text-indigo-100" />
                </div>
              </div>

              <h2 className="text-xl font-black text-white drop-shadow-[0_2px_6px_rgba(255,255,255,0.1)]">Ringing Friend...</h2>
              <p className="text-sm text-slate-400 mt-1">Connecting WebRTC secure media channels</p>

              <div className="mt-5 p-3.5 display-dark-inset-3d rounded-2xl flex items-center justify-center gap-5 max-w-xs mx-auto bg-slate-950/40 border-indigo-950/40">
                <div className="text-center">
                  <div className="text-3xl filter drop-shadow-sm">{getLanguageFlag(session?.currentLanguage || "")}</div>
                  <div className="text-xs font-black text-indigo-200 mt-1">{session?.username}</div>
                </div>
                <div className="text-[10px] uppercase font-black text-slate-500 select-none bg-indigo-950/40 px-2 py-0.5 rounded border border-indigo-950/20 font-mono">TO</div>
                <div className="text-center">
                  <div className="text-3xl filter drop-shadow-sm">{getLanguageFlag(peerSession?.currentLanguage || "")}</div>
                  <div className="text-xs font-black text-indigo-200 mt-1">{peerSession?.username || "Friend"}</div>
                </div>
              </div>

              <button
                onClick={handleHangUp}
                className="mt-8 px-6 py-3.5 btn-3d-rose text-white font-bold rounded-xl text-sm transition-all flex items-center justify-center gap-2 mx-auto cursor-pointer"
                id="cancel-ring-btn"
              >
                <PhoneOff className="w-4 h-4 text-rose-100" />
                <span>Cancel Call</span>
              </button>
            </motion.div>
          )}

          {/* ── STAGE 4: INCOMING CALL PROMPT ── */}
          {callState === "incoming" && incomingCallData && (
            <motion.div
              key="incoming-prompt"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-md card-3d p-8 text-center"
            >
              <div className="relative mx-auto w-20 h-20 mb-6 flex items-center justify-center rounded-2xl display-dark-inset-3d bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 shadow-[inset_0_2px_4px_rgba(99,102,241,0.25)]">
                <PhoneIncoming className="w-10 h-10 animate-bounce" />
              </div>

              <h2 className="text-xl font-black text-white drop-shadow-[0_2px_6px_rgba(255,255,255,0.1)]">Incoming Voice Call</h2>
              <p className="text-sm text-slate-400 mt-1">
                From: <span className="font-extrabold text-white">{incomingCallData.callerName}</span> (ID: {incomingCallData.callerId})
              </p>

              <div className="mt-4 p-3 display-dark-inset-3d rounded-xl flex items-center justify-center gap-3 max-w-xs mx-auto text-xs font-medium border-indigo-950/40 bg-[#020617]">
                <span className="text-2xl filter drop-shadow-sm">{getLanguageFlag(incomingCallData.callerLang)}</span>
                <span className="font-extrabold text-indigo-300">Language Accent: {getLanguageName(incomingCallData.callerLang)}</span>
              </div>

              <div className="mt-8 grid grid-cols-2 gap-4">
                <button
                  onClick={handleDeclineCall}
                  className="py-3.5 px-4 btn-3d-slate text-[#e2e8f0] font-bold rounded-xl text-sm transition-all cursor-pointer"
                  id="reject-incoming-call"
                >
                  Decline
                </button>
                <button
                  onClick={handleAcceptCall}
                  className="py-3.5 px-4 btn-3d-emerald text-white font-bold rounded-xl text-sm transition-all cursor-pointer"
                  id="accept-incoming-call"
                >
                  Accept Call
                </button>
              </div>
            </motion.div>
          )}

          {/* ── STAGE 5: ACTIVE SESSION CALL SCREEN ── */}
          {callState === "connected" && peerSession && (
            <motion.div
              key="call-session-view"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              className="w-full flex flex-col md:flex-row gap-6 items-stretch"
            >
              {/* Left Segment: Core Call Interface */}
              <div className="flex-1 space-y-5 flex flex-col justify-between">
                
                {/* Active Info Header */}
                <div className="card-3d p-5 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-emerald-500 border-2 border-[#030712] flex items-center justify-center shadow-md animate-pulse"></span>
                      <div className="w-12 h-12 rounded-xl bg-indigo-500/10 flex items-center justify-center text-3xl filter drop-shadow-[0_2px_4px_rgba(0,0,0,0.3)] border border-indigo-500/25">
                        {getLanguageFlag(peerSession.currentLanguage)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase font-mono font-bold tracking-widest text-indigo-400 leading-none">Speaking with</div>
                      <h3 className="font-black text-white text-base mt-2">{peerSession.username}</h3>
                    </div>
                  </div>

                  {/* Wave effect level */}
                  <div className="flex items-center gap-2">
                    <div className="hidden sm:flex items-center gap-1 bg-emerald-500/10 py-1.5 px-3 rounded-xl border border-emerald-500/25 text-emerald-400 font-mono text-[10px] font-black uppercase leading-none shadow-sm">
                      <Lock className="w-3 h-3 text-emerald-400 animate-pulse" /> WebRTC DTLS SECURED
                    </div>
                    <div className="flex items-center gap-1 bg-indigo-500/10 py-1.5 px-3 rounded-xl border border-indigo-500/25 shadow-inner">
                      <div className="voice-wave-bar"></div>
                      <div className="voice-wave-bar"></div>
                      <div className="voice-wave-bar"></div>
                      <div className="voice-wave-bar"></div>
                      <div className="voice-wave-bar"></div>
                      <span className="text-[10px] font-mono text-indigo-400 font-black ml-1 uppercase">Live</span>
                    </div>
                  </div>
                </div>

                {/* Subtitles & Spoken Dialogue Cards */}
                <div className="grid grid-rows-2 gap-4 flex-1 my-3 lg:my-0 h-[380px]">
                  
                  {/* ME SPONSOR CAPTION */}
                  <div className="card-3d p-5 flex flex-col justify-between relative overflow-hidden">
                    <div className="flex items-center justify-between text-xs text-slate-400 font-bold border-b border-dashed border-indigo-950/40 pb-2 mb-1 shrink-0">
                      <div className="flex items-center gap-2">
                        <span className="text-lg filter drop-shadow-sm">{getLanguageFlag(session?.currentLanguage || "")}</span>
                        <span className="font-extrabold text-slate-300">My Speech ({getLanguageName(session?.currentLanguage || "")})</span>
                      </div>
                      {isMicMuted ? (
                        <span className="text-rose-450 bg-rose-500/15 px-2 py-0.5 rounded-md flex items-center gap-1 text-[10px] border border-rose-500/20 animate-pulse">
                          <MicOff className="w-3 h-3" /> Muted
                        </span>
                      ) : (
                        <span className="text-emerald-450 bg-emerald-500/15 px-2 py-0.5 rounded-md flex items-center gap-1 text-[10px] border border-emerald-500/20 animate-pulse">
                          <Mic className="w-3 h-3 text-emerald-400" /> Realtime Speak
                        </span>
                      )}
                    </div>

                    <div className="flex-1 flex flex-col justify-between">
                      <div className="flex-1 flex items-center p-4 display-dark-inset-3d bg-slate-950/65 min-h-[80px] mt-2 border-indigo-500/10 relative overflow-hidden">
                        {/* Elegant technical left indicator bar */}
                        <div className="absolute top-0 bottom-0 left-0 w-1 bg-gradient-to-b from-indigo-500 to-purple-500"></div>
                        <p className="text-base font-extrabold text-white pl-3.5 focus:outline-none w-full" id="my-caption-display">
                          {myCaption || <span className="text-slate-500 italic font-semibold">Ready to transcribe. Speak clearly into microphone...</span>}
                        </p>
                      </div>
                      
                      {isTranslating && (
                        <div className="flex items-center gap-1.5 mt-2.5 text-indigo-400 font-mono text-[10px] font-black uppercase tracking-wider pl-1 animate-pulse">
                          <RefreshCw className="w-3 h-3 animate-spin text-indigo-400" />
                          <span>MyMemory Translating...</span>
                        </div>
                      )}

                      {myTranslation && (
                        <div className="mt-3 bg-indigo-500/10 p-4 rounded-xl border border-indigo-500/20 shadow-inner relative overflow-hidden">
                          <div className="absolute top-0 bottom-0 left-0 w-1 bg-gradient-to-b from-indigo-400 to-indigo-650"></div>
                          <span className="text-[9px] font-mono uppercase tracking-widest text-indigo-400 font-extrabold block mb-1 pl-2.5">Translation:</span>
                          <p className="text-sm font-black text-indigo-200 pl-2.5">{myTranslation}</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* FRIEND PEER CAPTION */}
                  <div className="card-3d p-5 flex flex-col justify-between relative overflow-hidden">
                    <div className="flex items-center justify-between text-xs text-slate-300 font-bold border-b border-dashed border-indigo-950/40 pb-2 mb-1 shrink-0">
                      <div className="flex items-center gap-2">
                        <span className="text-lg filter drop-shadow-sm">{getLanguageFlag(peerSession.currentLanguage)}</span>
                        <span className="font-extrabold text-slate-300">{peerSession.username}'s Translated Speech</span>
                      </div>
                      {isTtsMuted ? (
                        <span className="text-slate-400 bg-slate-900 px-2 py-0.5 rounded-md flex items-center gap-1 text-[10px] border border-slate-800">
                          <VolumeX className="w-3 h-3" /> Audio Playback Muted
                        </span>
                      ) : (
                        <span className="text-indigo-400 bg-indigo-500/15 px-2 py-0.5 rounded-md flex items-center gap-1 text-[10px] border border-indigo-500/20 animate-pulse font-extrabold">
                          <Volume2 className="w-3 h-3 text-indigo-400" /> ACCENT PLAYING
                        </span>
                      )}
                    </div>

                    <div className="flex-1 flex flex-col justify-between">
                      <div className="flex-1 flex flex-col justify-center p-3.5 display-dark-inset-3d bg-slate-950/45 border-indigo-950/30 min-h-[70px] mt-2">
                        <p className="text-xs text-slate-500 italic mb-1.5 font-semibold">Original Speech: {peerCaption || "Waiting for spoken word..."}</p>
                        
                        {peerTranslation && (
                          <div className="mt-2 bg-emerald-500/10 p-4 rounded-xl border border-emerald-500/15 shadow-inner relative overflow-hidden">
                            <div className="absolute top-0 bottom-0 left-0 w-1 bg-gradient-to-b from-emerald-400 to-teal-450"></div>
                            <span className="text-[9px] font-mono uppercase tracking-widest text-emerald-400 font-black block mb-1 pl-2">Translated Accents:</span>
                            <p className="text-base font-black text-emerald-200 font-sans rtl:text-right pl-2 leading-relaxed">{peerTranslation}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                </div>

                {/* Call Panel Controls */}
                <div className="display-dark-inset-3d p-4 flex items-center justify-between mt-3 bg-slate-950/70 border-indigo-950/40 shadow-inner shrink-0">
                  <div className="flex items-center space-x-3.5">
                    {/* Mic Toggle Button */}
                    <button
                      onClick={toggleMuteMicrophone}
                      className={`p-3 rounded-xl transition-all cursor-pointer btn-3d-slate border-0 ${
                        isMicMuted 
                          ? "bg-rose-500/20 text-rose-455" 
                          : "bg-[#090d16] text-slate-300"
                      }`}
                      style={{ borderBottom: isMicMuted ? "4px solid #be123c" : "4px solid #020617" }}
                      title={isMicMuted ? "Unmute Microphone" : "Mute Microphone"}
                      id="mute-mic-btn"
                    >
                      {isMicMuted ? <MicOff className="w-5 h-5 text-rose-450" /> : <Mic className="w-5 h-5 text-slate-300" />}
                    </button>

                    {/* Speech Recognition Toggle Button */}
                    <button
                      onClick={() => setIsRecognitionActive(prev => !prev)}
                      className={`p-3 rounded-xl transition-all cursor-pointer btn-3d-slate border-0 ${
                        !isRecognitionActive 
                          ? "bg-rose-500/20 text-rose-455" 
                          : "bg-[#090d16] text-slate-300"
                      }`}
                      style={{ borderBottom: !isRecognitionActive ? "4px solid #be123c" : "4px solid #020617" }}
                      title={isRecognitionActive ? "Pause Recognition" : "Resume Recognition"}
                    >
                      <Globe className={`w-5 h-5 ${isRecognitionActive ? "animate-spin-slow text-indigo-400" : "text-slate-400"}`} />
                    </button>

                    {/* TTS Audio Player Volume Toggle */}
                    <button
                      onClick={() => setIsTtsMuted(prev => !prev)}
                      className={`p-3 rounded-xl transition-all cursor-pointer btn-3d-slate border-0 ${
                        isTtsMuted 
                          ? "bg-rose-500/20 text-rose-455" 
                          : "bg-[#090d16] text-slate-300"
                      }`}
                      style={{ borderBottom: isTtsMuted ? "4px solid #be123c" : "4px solid #020617" }}
                      title={isTtsMuted ? "Unmute Synthetic Voices" : "Mute Synthetic Voices"}
                      id="mute-tts-btn"
                    >
                      {isTtsMuted ? <VolumeX className="w-5 h-5 text-rose-450" /> : <Volume2 className="w-5 h-5 text-slate-300" />}
                    </button>
                  </div>

                  {/* Red End Call icon */}
                  <button
                    onClick={handleHangUp}
                    className="flex items-center gap-2 px-6 py-3.5 btn-3d-rose text-white font-extrabold rounded-xl transition-all cursor-pointer"
                    id="end-call-btn"
                  >
                    <PhoneOff className="w-4 h-4 fill-current shrink-0 text-rose-100" />
                    <span>End Voice Call</span>
                  </button>
                </div>
              </div>

              {/* Right Segment: Dialogue Log History */}
              <div className="w-full md:w-80 card-3d p-5 flex flex-col h-[525px] shrink-0">
                <div className="flex items-center gap-2 font-black text-white border-b border-indigo-950/40 pb-3 mb-3 shrink-0 text-sm">
                  <History className="w-4.5 h-4.5 text-indigo-400" />
                  <span>Call Translation Logs</span>
                </div>

                <div className="flex-1 overflow-y-auto space-y-3.5 pr-1 text-xs select-text scrollbar-thin display-dark-inset-3d p-3.5 bg-slate-950/40 border-indigo-950/30">
                  {messages.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center text-slate-500 p-4">
                      <Activity className="w-8 h-8 opacity-40 mb-2 text-indigo-400" />
                      <p className="italic font-bold text-slate-400">No transcribing lines yet.</p>
                      <p className="text-[10px] scale-95 leading-normal mt-1 block text-slate-500">Dialogue translation transcripts appear here as you speak.</p>
                    </div>
                  ) : (
                    messages.map((msg) => {
                      const isMe = msg.senderName === session?.username;
                      return (
                        <div 
                          key={msg.id} 
                          className={`p-3 rounded-2xl border transition-all ${
                            isMe 
                              ? "bg-indigo-950/30 border-indigo-950/50 shadow-[inset_0_1px_2px_rgba(255,255,255,0.05)]" 
                              : "bg-[#021f15]/30 border-emerald-950/40 shadow-[inset_0_1px_2px_rgba(255,255,255,0.05)]"
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className={`font-black ${isMe ? "text-indigo-350" : "text-emerald-400"}`}>
                              {msg.senderName}
                            </span>
                            <span className="text-[10px] text-slate-500 font-mono font-medium">
                              {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                            </span>
                          </div>
                          
                          <p className="text-slate-400 italic">"{msg.originalText}"</p>
                          <p className={`font-black mt-1 leading-normal ${isMe ? "text-indigo-200" : "text-emerald-200"}`}>
                            {msg.translatedText}
                          </p>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </motion.div>
          )}

        </AnimatePresence>

        {/* Technical Description & Features Info Bento Grid */}
        <div className="w-full max-w-4xl mt-4 grid grid-cols-1 md:grid-cols-2 gap-6 select-none">
          {/* Welcome Banner Box */}
          <div className="md:col-span-2 card-3d p-6 relative overflow-hidden flex flex-col justify-between border-indigo-950/40">
            <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/10 rounded-full blur-2xl pointer-events-none"></div>
            <div>
              <div className="flex items-center gap-2 mb-2 text-indigo-400 font-mono text-xs font-bold uppercase tracking-wider">
                <Shield className="w-4 h-4 text-emerald-400 animate-pulse" /> End-to-End Encrypted Translator Core
              </div>
              <h3 className="text-xl font-black text-white leading-tight">Connecting People Across Language Barriers Instantly</h3>
              <p className="text-sm text-slate-400 mt-2 leading-relaxed font-semibold">
                This is a state-of-the-art <strong className="text-indigo-300">P2P Realtime Voice & Text Translator</strong> designed for seamless, barrier-free conversations with friends and family worldwide. Your voice is recognized instantly, translated in real time, and spoken to your partner in their preferred language accent.
              </p>
            </div>
            <div className="mt-4 flex flex-wrap gap-2.5">
              <span className="bg-[#020617] text-indigo-300 border border-indigo-950/30 font-mono text-[10px] uppercase font-black px-2.5 py-1 rounded">WebRTC Secure</span>
              <span className="bg-[#020617] text-emerald-300 border border-emerald-950/30 font-mono text-[10px] uppercase font-black px-2.5 py-1 rounded">WebRTC DTLS Encrypted</span>
              <span className="bg-[#020617] text-purple-300 border border-purple-900/40 font-mono text-[10px] uppercase font-black px-2.5 py-1 rounded">MyMemory Translation Engine</span>
              <span className="bg-[#020617] text-amber-300 border border-amber-900/40 font-mono text-[10px] uppercase font-black px-2.5 py-1 rounded">Local Synthesis (Urdu/zh/en)</span>
            </div>
          </div>

          {/* Card 1: E2EE */}
          <div className="card-3d p-6 border-indigo-950/40 hover:border-indigo-500/30 transition-colors flex gap-4">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shrink-0 shadow-inner">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <h4 className="font-extrabold text-white text-sm">WebRTC DTLS Encrypted Call</h4>
              <p className="text-xs text-slate-400 mt-1.5 leading-relaxed font-semibold">
                Your audio streams are transmitted using WebRTC's built-in DTLS encryption directly between browsers. Translated subtitles are relayed via the signalling server but are not stored or logged.
              </p>
            </div>
          </div>

          {/* Card 2: Automatic Accent voice synthesis */}
          <div className="card-3d p-6 border-indigo-950/40 hover:border-indigo-500/30 transition-colors flex gap-4">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 shrink-0 shadow-inner">
              <Volume2 className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h4 className="font-extrabold text-white text-sm">Smart Accent Synthesis (TTS)</h4>
              <p className="text-xs text-slate-400 mt-1.5 leading-relaxed font-semibold">
                Translated words are automatically spoken out loud using localized voice synthesis matching the listener's native accent (such as English, Urdu, Chinese, Spanish, or Hindi).
              </p>
            </div>
          </div>

          {/* Card 3: Direct WebRTC P2P Technology */}
          <div className="card-3d p-6 border-indigo-950/40 hover:border-indigo-500/30 transition-colors flex gap-4">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 shrink-0 shadow-inner">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <h4 className="font-extrabold text-white text-sm">Low-Latency P2P Performance</h4>
              <p className="text-xs text-slate-400 mt-1.5 leading-relaxed font-semibold">
                Optimized with Socket.io signaling and STUN/ICE routing protocols to keep voice latency low, offering automatic session reconnection recovery and real-time synchronicity.
              </p>
            </div>
          </div>

          {/* Card 4: How to use step by step */}
          <div className="card-3d p-6 border-indigo-950/40 hover:border-indigo-500/30 transition-colors flex gap-4">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 shrink-0 shadow-inner">
              <Info className="w-5 h-5" />
            </div>
            <div>
              <h4 className="font-extrabold text-white text-sm">Intuitive & Simple Workflow</h4>
              <p className="text-xs text-slate-400 mt-1.5 leading-relaxed font-semibold">
                Enter your username, select your native language accent, and register. Share your unique 5-digit Peer ID with your partner, enter their ID, click Call, and start talking!
              </p>
            </div>
          </div>
        </div>
      </main>

      {/* Footer System Status details */}
      <footer className="w-full bg-[#050b18]/80 backdrop-blur-xl border-t border-indigo-950/50 py-4 px-6 text-center shrink-0">
        <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between text-xs text-slate-500 gap-2">
          <p className="font-semibold text-slate-500">
            Realtime Translator built with pure WebRTC, Socket.io & MyMemory Translation Service.
          </p>
          <div className="flex items-center gap-2 text-[10px] font-mono font-extrabold text-slate-400 uppercase tracking-tight bg-slate-900 border border-indigo-950/40 py-1 px-2.5 rounded-md">
            <span>Status:</span>
            <span className={connectionStatus.includes("Live") || connectionStatus.includes("Connected") ? "text-emerald-400" : "text-amber-400 animate-pulse"}>
              {connectionStatus}
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
