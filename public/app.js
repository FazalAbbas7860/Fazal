// Vanilla JS Realtime Voice Translator Client logic

let socket = null;
let peerConnection = null;
let localStream = null;
const iceCandidatesQueue = [];
let targetSocketId = null;

// User session configs
let mySession = null;
let peerSession = null;
let activeLanguage = "ur-PK"; // Default Urdu

// Call States
let isMicMuted = false;
let isTtsMuted = false;
let isRecActive = true;
let isTranslating = false;

// Speech recognition
let recognition = null;

// UI Selector variables
const authView = document.getElementById("auth-view");
const dialerView = document.getElementById("dialer-view");
const ringingView = document.getElementById("ringing-view");
const incomingView = document.getElementById("incoming-view");
const callView = document.getElementById("call-view");

const usernameInput = document.getElementById("username-input");
const useridInput = document.getElementById("userid-input");
const authForm = document.getElementById("auth-form");
const authSubmitBtn = document.getElementById("auth-submit-btn");
const authErrorBox = document.getElementById("auth-error");
const authErrorMsg = document.getElementById("auth-error-msg");

const myProfileFlag = document.getElementById("my-profile-flag");
const myProfileName = document.getElementById("my-profile-name");
const myProfileLangText = document.getElementById("my-profile-lang-text");
const myProfileId = document.getElementById("my-profile-id");
const copyIdBtn = document.getElementById("copy-id-btn");
const dialerErrorBox = document.getElementById("dialer-error");
const dialerErrorMsg = document.getElementById("dialer-error-msg");
const friendIdInput = document.getElementById("friend-id-input");
const startCallBtn = document.getElementById("start-call-btn");

const cancelCallBtn = document.getElementById("cancel-call-btn");
const callerName = document.getElementById("caller-name");
const calleeName = document.getElementById("callee-name");

const incomingName = document.getElementById("incoming-name");
const incomingFlag = document.getElementById("incoming-flag");
const incomingLangName = document.getElementById("incoming-lang-name");
const acceptCallBtn = document.getElementById("accept-call-btn");
const declineCallBtn = document.getElementById("decline-call-btn");

const peerCaptionName = document.getElementById("peer-caption-name");
const friendViewFlag = document.getElementById("friend-view-flag");
const friendViewName = document.getElementById("friend-view-name");
const myLiveCaption = document.getElementById("my-live-caption");
const myTranslateBox = document.getElementById("my-translate-box");
const myLiveTranslation = document.getElementById("my-live-translation");
const peerOriginalCaption = document.getElementById("peer-original-caption");
const peerTranslateBox = document.getElementById("peer-translate-box");
const peerLiveTranslation = document.getElementById("peer-live-translation");
const logsContainer = document.getElementById("logs-container");

const muteMicBtn = document.getElementById("mute-mic-btn");
const toggleRecBtn = document.getElementById("toggle-rec-btn");
const muteTtsBtn = document.getElementById("mute-tts-btn");
const hangUpBtn = document.getElementById("hang-up-btn");

const statusText = document.getElementById("connection-status");
const activeUsersBadge = document.getElementById("active-users-badge");
const selfIndicator = document.getElementById("self-indicator");
const indicatorUsername = document.getElementById("indicator-username");
const indicatorId = document.getElementById("indicator-id");

// Set random Initial user IDs
useridInput.value = Math.floor(10000 + Math.random() * 90000).toString();

// Initialize Lucide icons
if (window.lucide) {
  window.lucide.createIcons();
}

// Select Speech Accent
document.querySelectorAll(".lang-selector-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".lang-selector-btn").forEach((b) => {
      b.className = "lang-selector-btn py-3 px-4 text-center rounded-xl border font-medium text-sm flex flex-col items-center justify-center gap-1 transition-all border-slate-200 bg-white text-slate-600 hover:border-slate-300";
    });
    btn.className = "lang-selector-btn py-3 px-4 text-center rounded-xl border font-medium text-sm flex flex-col items-center justify-center gap-1 transition-all border-indigo-600 bg-indigo-50/50 text-indigo-900 ring-2 ring-indigo-100";
    activeLanguage = btn.getAttribute("data-lang");
  });
});

// Copy code helper
copyIdBtn.addEventListener("click", () => {
  if (mySession) {
    navigator.clipboard.writeText(mySession.userId);
    alert("Copied User ID code to your clipboard!");
  }
});

// Sign-In Form Submit
authForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const userId = useridInput.value.trim().toLowerCase();
  const username = usernameInput.value.trim();

  if (!userId || !username) {
    showAuthError("All inputs are required.");
    return;
  }

  connectSignalServer(userId, username, activeLanguage);
});

function showAuthError(text) {
  authErrorBox.classList.remove("hidden");
  authErrorMsg.textContent = text;
}

function showDialError(text) {
  dialerErrorBox.classList.remove("hidden");
  dialerErrorMsg.textContent = text;
}

// Create connection to Express Socket Signalling Server
function connectSignalServer(userId, username, langCode) {
  authSubmitBtn.disabled = true;
  authSubmitBtn.textContent = "Connecting Translation Center...";

  // Connects socket dynamically to the same host
  socket = io();

  socket.on("connect", () => {
    statusText.textContent = "Connected to Signal Server";
    socket.emit("register", { userId, username, currentLanguage: langCode });
  });

  socket.on("connect_error", () => {
    statusText.textContent = "Signal connector offline";
    authSubmitBtn.disabled = false;
    authSubmitBtn.textContent = "Register Spoken Session";
    showAuthError("Signals system offline. Ensure backend is running!");
  });

  socket.on("registered", (data) => {
    mySession = data;
    statusText.textContent = "Live & Online";

    // Setup profiles fields
    myProfileFlag.textContent = getLangFlag(data.currentLanguage);
    myProfileName.textContent = data.username;
    myProfileId.textContent = data.userId;
    myProfileLangText.textContent = "Speaks: " + getLanguageUiName(data.currentLanguage);

    indicatorUsername.textContent = data.username;
    indicatorId.textContent = "ID: " + data.userId;
    selfIndicator.classList.remove("hidden");

    // Seamless UI transition
    authView.classList.add("hidden");
    dialerView.classList.remove("hidden");
    
    // Unlock voices output gesture
    unlockSpeechSynthesis();
  });

  socket.on("registration-failed", (data) => {
    showAuthError(data.error);
    authSubmitBtn.disabled = false;
    authSubmitBtn.textContent = "Register Spoken Session";
    socket.disconnect();
  });

  socket.on("online-count", (count) => {
    activeUsersBadge.textContent = `${count} active`;
  });

  // Call Request incoming
  socket.on("incoming-call", (data) => {
    if (callView.classList.contains("hidden") === false) {
      // Busy
      socket.emit("reject-call", { callerSocketId: data.callerSocketId });
      return;
    }

    incomingName.textContent = data.callerName + " (ID: " + data.callerId + ")";
    incomingFlag.textContent = getLangFlag(data.callerLang);
    incomingLangName.textContent = getLanguageUiName(data.callerLang);

    peerSession = {
      userId: data.callerId,
      username: data.callerName,
      currentLanguage: data.callerLang,
      socketId: data.callerSocketId
    };

    dialerView.classList.add("hidden");
    incomingView.classList.remove("hidden");
  });

  socket.on("call-accepted", async (data) => {
    targetSocketId = data.calleeSocketId;
    peerSession = {
      userId: data.calleeId,
      username: data.calleeName,
      currentLanguage: data.calleeLang
    };

    ringingView.classList.add("hidden");
    callView.classList.remove("hidden");

    peerCaptionName.textContent = peerSession.username;
    friendViewFlag.textContent = getLangFlag(peerSession.currentLanguage);
    friendViewName.textContent = peerSession.username;

    // Direct WebRTC SDP offer establishment
    await startPeerConnection(targetSocketId, true);
  });

  socket.on("call-rejected", () => {
    ringingView.classList.add("hidden");
    dialerView.classList.remove("hidden");
    showDialError("Your friend is busy or declined the call.");
  });

  socket.on("call-hung-up", () => {
    handleTeardown();
    showDialError("Voice Call ended.");
  });

  // SDP Exchanger Signalling Relays
  socket.on("sdp-offer", async (data) => {
    targetSocketId = data.senderSocketId;
    await startPeerConnection(data.senderSocketId, false);

    try {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));

      while (iceCandidatesQueue.length > 0) {
        const cand = iceCandidatesQueue.shift();
        await peerConnection.addIceCandidate(new RTCIceCandidate(cand));
      }

      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);

      socket.emit("sdp-answer", {
        targetSocketId: data.senderSocketId,
        sdp: answer
      });

    } catch (err) {
      console.error(err);
    }
  });

  socket.on("sdp-answer", async (data) => {
    try {
      if (peerConnection) {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
      }
    } catch (err) {
      console.error(err);
    }
  });

  socket.on("ice-candidate", async (data) => {
    try {
      if (peerConnection && peerConnection.remoteDescription) {
        await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
      } else {
        iceCandidatesQueue.push(data.candidate);
      }
    } catch (err) {
      console.error(err);
    }
  });

  // Sync spoken translated subtitles
  socket.on("voice-subtitle", (data) => {
    peerOriginalCaption.textContent = `Original Speech: "${data.text}"`;
    peerTranslateBox.classList.remove("hidden");
    peerLiveTranslation.textContent = data.translatedText;

    addLogLine(peerSession.username, data.text, data.translatedText, false);

    // Speak it out under correct accent playback!
    if (!isTtsMuted) {
      speakAudioAccent(data.translatedText, data.to);
    }
  });

  socket.on("peer-disconnected", (data) => {
    if (peerSession && data.userId === peerSession.userId) {
      handleTeardown();
      showDialError("The friend disconnected from server.");
    }
  });
}

// WebRTC Signaling Logic
async function startPeerConnection(partnerSocketId, isOfferOriginator) {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });

    peerConnection = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.miwifi.com:3478" },
        { urls: "stun:stun.chat.bilibili.com:3478" },
        { urls: "stun:stun.qq.com:3478" },
        { urls: "stun:stun.douyucdn.cn:18000" }
      ],
      iceCandidatePoolSize: 10
    });

    localStream.getTracks().forEach((track) => {
      peerConnection.addTrack(track, localStream);
    });

    peerConnection.onicecandidate = (e) => {
      if (e.candidate) {
        socket.emit("ice-candidate", {
          targetSocketId: partnerSocketId,
          candidate: e.candidate
        });
      }
    };

    // Auto audio speaker integration
    peerConnection.ontrack = (event) => {
      const audioPlayer = document.createElement("audio");
      audioPlayer.id = "vanilla-remote-audio-source";
      audioPlayer.autoplay = true;
      audioPlayer.srcObject = event.streams[0];
      document.body.appendChild(audioPlayer);
    };

    if (isOfferOriginator) {
      const offer = await peerConnection.createOffer({ offerToReceiveAudio: true });
      await peerConnection.setLocalDescription(offer);
      socket.emit("sdp-offer", {
        targetSocketId: partnerSocketId,
        sdp: offer
      });
    }

    // Launch transcriptions
    initSpeechRecognitionEngine();

  } catch (err) {
    console.error("Mic access denied or WebRTC configuration failed:", err);
    alert("Microphone device missing or permissions blocked. Please check your browser audio settings!");
    handleHangUp();
  }
}

// Dialer Caller Call Connects trigger
startCallBtn.addEventListener("click", () => {
  const fId = friendIdInput.value.trim().toLowerCase();
  if (!fId) {
    showDialError("Please enter your friend's live ID first!");
    return;
  }
  if (mySession && fId === mySession.userId) {
    showDialError("You can't call your own User ID.");
    return;
  }

  showDialError("");
  dialerErrorBox.classList.add("hidden");

  callerName.textContent = mySession.username;
  calleeName.textContent = fId;

  dialerView.classList.add("hidden");
  ringingView.classList.remove("hidden");

  // Validate presence
  socket.emit("check-friend", { friendId: fId }, (res) => {
    if (res.online) {
      peerSession = {
        userId: fId,
        username: res.username,
        currentLanguage: res.language
      };
      socket.emit("call-user", {
        targetUserId: fId,
        callerId: mySession.userId,
        callerName: mySession.username,
        callerLang: mySession.currentLanguage
      });
    } else {
      ringingView.classList.add("hidden");
      dialerView.classList.remove("hidden");
      showDialError("This friend is offline. Tell them to sign up their ID right now!");
    }
  });
});

// Outgoing cancel btn click
cancelCallBtn.addEventListener("click", () => {
  handleHangUp();
});

// Incoming Call handlers
acceptCallBtn.addEventListener("click", () => {
  if (!peerSession) return;

  socket.emit("accept-call", {
    callerSocketId: peerSession.socketId,
    calleeId: mySession.userId,
    calleeName: mySession.username,
    calleeLang: mySession.currentLanguage
  });

  incomingView.classList.add("hidden");
  callView.classList.remove("hidden");

  peerCaptionName.textContent = peerSession.username;
  friendViewFlag.textContent = getLangFlag(peerSession.currentLanguage);
  friendViewName.textContent = peerSession.username;

  unlockSpeechSynthesis();
});

declineCallBtn.addEventListener("click", () => {
  if (peerSession) {
    socket.emit("reject-call", { callerSocketId: peerSession.socketId });
  }
  incomingView.classList.add("hidden");
  dialerView.classList.remove("hidden");
  peerSession = null;
});

// Handle termination hangup action
hangUpBtn.addEventListener("click", () => {
  handleHangUp();
});

function handleHangUp() {
  if (socket && targetSocketId) {
    socket.emit("hang-up", { targetSocketId });
  }
  handleTeardown();
}

// Cleanup voice translator stream connections
function handleTeardown() {
  callView.classList.add("hidden");
  ringingView.classList.add("hidden");
  incomingView.classList.add("hidden");
  dialerView.classList.remove("hidden");

  myLiveCaption.textContent = "Speak clearly into microphone...";
  myTranslateBox.classList.add("hidden");
  myLiveTranslation.textContent = "";
  peerOriginalCaption.textContent = "Waiting for spoken word...";
  peerTranslateBox.classList.add("hidden");
  peerLiveTranslation.textContent = "";

  targetSocketId = null;
  peerSession = null;

  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }

  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop());
    localStream = null;
  }

  if (recognition) {
    try { recognition.stop(); } catch(e){}
    recognition = null;
  }

  // Delete remote source node
  const remoteAudioNode = document.getElementById("vanilla-remote-audio-source");
  if (remoteAudioNode) {
    remoteAudioNode.remove();
  }
}

// Transcribe Voice Input engine
function initSpeechRecognitionEngine() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return;

  recognition = new SpeechRecognition();
  recognition.continuous = false; // pause split matching
  recognition.interimResults = false;
  recognition.lang = mySession.currentLanguage;

  recognition.onresult = async (e) => {
    const transcript = e.results[0][0].transcript;
    if (!transcript || transcript.trim() === "") return;

    if (isMicMuted) return;

    myLiveCaption.textContent = transcript;
    
    // Split locales to codes
    const localCode = mySession.currentLanguage.split("-")[0];
    const targetCode = peerSession.currentLanguage.split("-")[0];

    try {
      const url = `/api/translate?text=${encodeURIComponent(transcript)}&from=${localCode}&to=${targetCode}`;
      const res = await fetch(url);
      const data = await res.json();
      const translationText = data.translatedText || "Translation unavailable";

      myTranslateBox.classList.remove("hidden");
      myLiveTranslation.textContent = translationText;

      socket.emit("voice-subtitle", {
        targetSocketId,
        text: transcript,
        translatedText: translationText,
        from: localCode,
        to: targetCode
      });

      addLogLine("Me", transcript, translationText, true);

    } catch (err) {
      console.warn(err);
      myTranslateBox.classList.remove("hidden");
      myLiveTranslation.textContent = "Translation unavailable";
    }
  };

  recognition.onend = () => {
    // restart on connect status hot
    if (!callView.classList.contains("hidden") && isRecActive && !isMicMuted) {
      try { recognition.start(); } catch(err){}
    }
  };

  try {
    recognition.start();
  } catch(err){}
}

// Text-to-Speech Output Synthesizer
function speakAudioAccent(text, langCode) {
  if (!("speechSynthesis" in window)) return;
  if (text === "Translation unavailable") return;

  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();

    const query = langCode.toLowerCase();
    const perfectVoice = voices.find(v => v.lang.toLowerCase() === query) ||
                         voices.find(v => v.lang.toLowerCase().startsWith(query)) ||
                         voices.find(v => v.lang.toLowerCase().includes(query));

    if (perfectVoice) {
      utterance.voice = perfectVoice;
    }

    utterance.rate = 0.95;
    window.speechSynthesis.speak(utterance);
  } catch(err){}
}

function unlockSpeechSynthesis() {
  if ("speechSynthesis" in window) {
    const soundless = new SpeechSynthesisUtterance("");
    window.speechSynthesis.speak(soundless);
  }
}

// Media toggler buttons
muteMicBtn.addEventListener("click", () => {
  isMicMuted = !isMicMuted;
  if (isMicMuted) {
    muteMicBtn.className = "p-3 rounded-xl transition-all bg-rose-500/10 border border-rose-500/20 text-rose-400 hover:bg-rose-500/20";
    if (localStream) {
      localStream.getAudioTracks().forEach(t => t.enabled = false);
    }
    if (recognition) {
      try { recognition.stop(); } catch(err){}
    }
  } else {
    muteMicBtn.className = "p-3 rounded-xl transition-all bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700";
    if (localStream) {
      localStream.getAudioTracks().forEach(t => t.enabled = true);
    }
    initSpeechRecognitionEngine();
  }
});

toggleRecBtn.addEventListener("click", () => {
  isRecActive = !isRecActive;
  if (!isRecActive) {
    toggleRecBtn.className = "p-3 rounded-xl transition-all bg-rose-500/10 border border-rose-500/20 text-rose-400 hover:bg-rose-500/20";
    if (recognition) {
      try { recognition.stop(); } catch(err){}
    }
  } else {
    toggleRecBtn.className = "p-3 rounded-xl transition-all bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-indigo-400";
    initSpeechRecognitionEngine();
  }
});

muteTtsBtn.addEventListener("click", () => {
  isTtsMuted = !isTtsMuted;
  if (isTtsMuted) {
    muteTtsBtn.className = "p-3 rounded-xl transition-all bg-rose-500/10 border border-rose-500/20 text-rose-400 hover:bg-rose-500/20";
  } else {
    muteTtsBtn.className = "p-3 rounded-xl transition-all bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700";
  }
});

// Logs append log
function addLogLine(sender, original, translated, isMe) {
  // Clear empty state text on first message loading
  if (logsContainer.children.length > 0 && logsContainer.querySelector("p.italic")) {
    logsContainer.innerHTML = "";
    logsContainer.className = "flex-1 overflow-y-auto space-y-3.5 pr-1 text-xs scrollbar-thin flex flex-col justify-start items-stretch";
  }

  const logDiv = document.createElement("div");
  logDiv.className = `p-3 rounded-2xl border transition-all ${
    isMe ? "bg-indigo-50/30 border-indigo-100/50" : "bg-emerald-50/20 border-emerald-100/40"
  }`;

  const timeString = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  logDiv.innerHTML = `
    <div class="flex items-center justify-between mb-1">
      <span class="font-extrabold ${isMe ? "text-indigo-900" : "text-emerald-950"}">${sender}</span>
      <span class="text-[10px] text-slate-400 font-mono font-medium">${timeString}</span>
    </div>
    <p class="text-slate-600 italic">"${original}"</p>
    <p class="font-bold mt-1 text-slate-900">${translated}</p>
  `;

  logsContainer.prepend(logDiv);
}

// Lang flags details mapper
function getLangFlag(locale) {
  if (locale.startsWith("ur")) return "🇵🇰";
  if (locale.startsWith("zh")) return "🇨🇳";
  return "🇺🇸";
}

function getLanguageUiName(locale) {
  if (locale.startsWith("ur")) return "Urdu (اردو)";
  if (locale.startsWith("zh")) return "Chinese (中文)";
  return "English";
}
