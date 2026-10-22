// MeetScribe AI - Multiplatform Content Script & Floating Overlay
// Supports: Microsoft Teams, Google Meet, Zoom Web
(function () {
  const STORAGE_LOGS_KEY = "meeting_transcript_logs";
  const STORAGE_STATE_KEY = "meeting_recorder_state";
  const STORAGE_SESSIONS_KEY = "meetscribe_sessions";
  const STORAGE_CONFIG_KEY = "meeting_ai_config";

  let observer = null;
  let syncTimer = null;
  let captionCheckInterval = null;
  let isDirty = false;
  let isRecordingActive = false;

  let currentMeetingId = "";
  let currentMeetingTitle = "";
  let transcripts = [];
  let elementIdCounter = 0;
  const elementIdMap = new WeakMap();

  function isExtensionValid() {
    try {
      return !!(chrome && chrome.runtime && chrome.runtime.id);
    } catch (e) {
      return false;
    }
  }

  function stopAllIntervals() {
    if (captionCheckInterval) {
      clearInterval(captionCheckInterval);
      captionCheckInterval = null;
    }
    if (syncTimer) {
      clearInterval(syncTimer);
      syncTimer = null;
    }
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  }

  function getPlatform() {
    const host = window.location.host;
    if (host.includes("teams.microsoft.com") || host.includes("teams.live.com") || host.includes("teams.cloud.microsoft")) {
      return "Microsoft Teams";
    }
    if (host.includes("meet.google.com")) {
      return "Google Meet";
    }
    if (host.includes("zoom.us")) {
      return "Zoom Web";
    }
    return "Unknown Platform";
  }

  function isActualMeetingRoom() {
    const host = window.location.host;
    const path = window.location.pathname.replace(/^\/+|\/+$/g, "").split("?")[0];
    if (host.includes("meet.google.com")) {
      if (!path || path === "home" || path === "landing" || path.startsWith("about")) return false;
      return true;
    }
    if (host.includes("teams")) {
      return window.location.href.includes("meetup-join") || path.includes("call");
    }
    if (host.includes("zoom.us")) {
      return path.includes("j/") || path.includes("wc/");
    }
    return false;
  }

  function getMeetingKey() {
    const host = window.location.host;
    if (host.includes("meet.google.com")) {
      const path = window.location.pathname.replace(/^\//, "").split("?")[0];
      return "meet_" + (path || "room");
    }
    if (host.includes("teams")) {
      const match = window.location.href.match(/meetup-join\/([^/?]+)/);
      return "teams_" + (match ? match[1].slice(0, 16) : window.location.pathname.slice(0, 20));
    }
    if (host.includes("zoom.us")) {
      const match = window.location.pathname.match(/\/j\/(\d+)/);
      return "zoom_" + (match ? match[1] : "web");
    }
    return "session_" + window.location.hostname;
  }

  function detectMeetingTitle() {
    const host = window.location.host;
    let title = "";

    try {
      if (host.includes("teams")) {
        const titleEl = document.querySelector('[data-tid="call-title"], [data-tid="chat-header-title"], .fui-Header');
        title = titleEl ? titleEl.innerText.trim() : "";
        if (!title && document.title) {
          title = document.title.replace(/\|.*$/, "").replace(/^\(\d+\)\s*/, "").trim();
        }
      } else if (host.includes("meet.google")) {
        const titleEl = document.querySelector('[data-meeting-title], [jsname="r4nke"], div[class*="u6vdEc"]');
        title = titleEl ? titleEl.innerText.trim() : "";
        if (!title && document.title) {
          title = document.title.replace(/- Google Meet.*$/, "").trim();
        }
      } else if (host.includes("zoom.us")) {
        const titleEl = document.querySelector('.meeting-info-title, [class*="meeting-title"], .meeting-header');
        title = titleEl ? titleEl.innerText.trim() : "";
        if (!title && document.title) {
          title = document.title.replace(/- Zoom.*$/, "").trim();
        }
      }
    } catch (e) {}

    return title || "Meeting " + new Date().toISOString().slice(0, 10);
  }

  // Enhanced Auto Turn On Captions (Google Meet, Teams, Zoom Web)
  async function autoTurnOnCaptions() {
    const host = window.location.host;

    try {
      if (host.includes("meet.google.com")) {
        // Modern & legacy Google Meet selectors
        const ccBtn = Array.from(document.querySelectorAll("button")).find((b) => {
          const al = (b.getAttribute("aria-label") || "").toLowerCase();
          const jsn = b.getAttribute("jsname") || "";
          const icon = b.querySelector("i");
          const iconText = icon ? icon.innerText : "";
          return (
            jsn === "RrG0hf" ||
            jsn === "r8qRAd" ||
            al.includes("turn on captions") ||
            al.includes("aktifkan teks") ||
            al.includes("nyalakan teks") ||
            iconText.includes("closed_caption_off") ||
            iconText === "closed_caption"
          );
        });

        if (ccBtn) {
          const al = (ccBtn.getAttribute("aria-label") || "").toLowerCase();
          const isPressed = ccBtn.getAttribute("aria-pressed");
          // Only click if it says Turn on, or if aria-pressed is false
          if (al.includes("turn on") || al.includes("aktifkan") || al.includes("nyalakan") || isPressed === "false") {
            ccBtn.click();
          }
        }
      } else if (host.includes("teams")) {
        const existingCC = document.querySelector(".fui-ChatMessageCompact, [data-tid='closed-caption-text']");
        if (!existingCC) {
          const directCc = document.querySelector("[data-tid='closed-captions-button'], #closed-captions-button, button[aria-label*='caption' i]");
          if (directCc) {
            directCc.click();
          } else {
            const moreBtn = document.querySelector(
              "#callingButtons-showMoreBtn, [data-tid='more-button'], button[aria-label*='More' i], button[aria-label*='Lainnya' i]"
            );
            if (moreBtn) {
              moreBtn.click();
              await new Promise((r) => setTimeout(r, 400));
              const menuCc = document.querySelector(
                "#closed-captions-button, [data-tid='closed-captions-button'], [data-tid='callingButtons-turnOnClosedCaptions'], button[aria-label*='caption' i]"
              );
              if (menuCc) menuCc.click();
            }
          }
        }
      } else if (host.includes("zoom.us")) {
        const ccBtn = document.querySelector(
          "button.closed-caption-btn, button[aria-label*='Live Transcript' i], button[aria-label*='caption' i], button[aria-label*='subtitle' i]"
        );
        if (ccBtn) ccBtn.click();
      }
    } catch (err) {}
  }

  function getTimestamp() {
    const d = new Date();
    return d.toTimeString().split(" ")[0];
  }

  function getFormattedDateTime(timestamp) {
    const d = timestamp ? new Date(timestamp) : new Date();
    const dateStr = d.toLocaleDateString("id-ID", {
      day: "2-digit",
      month: "short",
      year: "numeric"
    });
    const timeStr = d.toLocaleTimeString("id-ID", {
      hour: "2-digit",
      minute: "2-digit"
    });
    return { dateStr, timeStr, fullStr: `${dateStr} • ${timeStr}` };
  }

  // Detect smart tag keywords
  function detectTag(text) {
    if (!text) return null;
    const lower = text.toLowerCase();
    if (/\b(action item|tugas|to-do|todo|nanti saya|tolong|follow up|pr|kerjakan|diselesaikan)\b/i.test(lower)) {
      return "action";
    }
    if (/\b(sepakat|keputusan|decided|deal|setuju|agreed|keputusannya|fix)\b/i.test(lower)) {
      return "decision";
    }
    if (/\b(blocker|kendala|masalah|issue|terhambat|error|bug|risiko|risk)\b/i.test(lower)) {
      return "blocker";
    }
    return null;
  }

  // Switch captions language in Google Meet
  async function setGoogleMeetLanguage(langName) {
    if (!window.location.host.includes("meet.google.com")) return false;
    try {
      const openSettingsBtn = document.querySelector('button[aria-label*="caption settings" i], button[aria-label*="setelan teks" i]');
      if (openSettingsBtn) {
        openSettingsBtn.click();
        await new Promise((r) => setTimeout(r, 400));
      }

      const langBox = document.querySelector('div[role="combobox"][aria-label*="language" i], div[role="combobox"][aria-label*="bahasa" i]');
      if (langBox) {
        langBox.click();
        await new Promise((r) => setTimeout(r, 350));
      }

      const options = Array.from(document.querySelectorAll('[role="option"], [role="menuitem"], li'));
      const targetOpt = options.find((opt) => (opt.innerText || "").toLowerCase().includes(langName.toLowerCase()));
      if (targetOpt) {
        targetOpt.click();
        await new Promise((r) => setTimeout(r, 300));
      }

      const closeBtn = document.querySelector('[aria-label*="Close" i], [aria-label*="Tutup" i], button[jsname="LgbsSe"]');
      if (closeBtn) closeBtn.click();
      return true;
    } catch (e) {
      return false;
    }
  }

  function mergeStreamText(prev, next) {
    if (!prev) return next;
    if (!next) return prev;
    prev = prev.trim();
    next = next.trim();

    if (next.startsWith(prev)) return next;
    if (prev.endsWith(next)) return prev;

    const prevWords = prev.split(/\s+/);
    const nextWords = next.split(/\s+/);
    const maxOverlap = Math.min(prevWords.length, nextWords.length, 8);

    for (let i = maxOverlap; i >= 2; i--) {
      const prevSuffix = prevWords.slice(-i).join(" ").toLowerCase();
      const nextPrefix = nextWords.slice(0, i).join(" ").toLowerCase();
      if (prevSuffix === nextPrefix) {
        return prevWords.slice(0, -i).concat(nextWords).join(" ");
      }
    }

    return prev + " " + next;
  }

  function upsertUtterance(uid, speaker, rawText) {
    if (!rawText || !rawText.trim()) return;
    const cleanText = rawText.trim().replace(/\s+/g, " ");
    const cleanSpeaker = (speaker || "Participant").trim().replace(/:$/, "");

    const existingIndex = transcripts.findIndex((t) => t.id === uid);

    try {
      if (existingIndex > -1) {
        const existing = transcripts[existingIndex];
        if (cleanText !== existing.text || (cleanSpeaker && cleanSpeaker !== existing.speaker)) {
          existing.text = cleanText;
          if (!existing.time) existing.time = getTimestamp();
          if (cleanSpeaker && cleanSpeaker !== "Participant") {
            existing.speaker = cleanSpeaker;
          }
          isDirty = true;
          updateFloatingWidget();
        }
      } else {
        const prevItem = transcripts[transcripts.length - 1];
        const now = Date.now();

        if (prevItem && prevItem.text === cleanText) {
          return;
        }

        const autoTag = detectTag(cleanText);

        if (
          prevItem &&
          prevItem.speaker === cleanSpeaker &&
          now - prevItem.timestamp < 10000 &&
          !prevItem.text.endsWith(".")
        ) {
          prevItem.text = mergeStreamText(prevItem.text, cleanText);
          if (!prevItem.tag && autoTag) prevItem.tag = autoTag;
          isDirty = true;
          updateFloatingWidget();
        } else {
          transcripts.push({
            id: uid,
            speaker: cleanSpeaker,
            text: cleanText,
            time: getTimestamp(),
            timestamp: now,
            tag: autoTag,
            isPinned: !!autoTag
          });
          isDirty = true;
          updateFloatingWidget();
        }
      }
    } catch (err) {
      console.warn("[MeetScribe] upsertUtterance error:", err);
    }
  }

  function getElementUid(el) {
    if (!elementIdMap.has(el)) {
      elementIdCounter++;
      elementIdMap.set(el, "utt_" + Date.now() + "_" + elementIdCounter);
    }
    return elementIdMap.get(el);
  }

  function extractGoogleMeet() {
    const textEls = document.querySelectorAll(
      ".VbkSUe, .ygicle, [class*='iTTPOb'], [class*='CNusmb']"
    );
    textEls.forEach((tEl) => {
      const rawText = tEl.innerText ? tEl.innerText.trim() : "";
      if (!rawText) return;

      const container = tEl.closest(".nMcdL, .bj4p3b, [class*='nMxHgf'], div[class*='nMcdL']") || tEl.parentElement;
      const speakerEl = container
        ? container.querySelector(".NWpY1d, [class*='NWpY1d'], [class*='zs75bd'], [class*='NWadDd']")
        : null;

      let speaker = speakerEl ? speakerEl.innerText.trim() : "Participant";
      if (speaker === "You") speaker = "You (Me)";

      const identityNode = container || tEl;
      const uid = getElementUid(identityNode);
      upsertUtterance(uid, speaker, rawText);
    });
  }

  function extractTeams() {
    const textEls = document.querySelectorAll(
      "[data-tid='closed-caption-text'], [class*='closed-caption-text'], [class*='captionText']"
    );
    textEls.forEach((textEl) => {
      const rawText = textEl.innerText ? textEl.innerText.trim() : "";
      if (!rawText) return;

      const card = textEl.closest(".fui-ChatMessageCompact, [data-tid='closed-caption-renderer-wrapper'], [data-tid='closed-caption-card']") || textEl.parentElement;
      const authorEl = card ? card.querySelector("[data-tid='author'], [class*='author'], .author-name, [class*='speaker']") : null;
      const speaker = authorEl ? authorEl.innerText.trim() : "Participant";

      const uid = getElementUid(card || textEl);
      upsertUtterance(uid, speaker, rawText);
    });
  }

  function extractZoom() {
    // 1. Zoom React side-panel and caption DOM selectors (fallback)
    const textEls = document.querySelectorAll(
      "[class*='closed-caption-content'], .closed-caption-item, [class*='transcript-item'], [class*='single-transcription'], .transcription-message-item"
    );
    textEls.forEach((item) => {
      const speakerEl = item.querySelector(
        "[class*='speaker'], [class*='author'], .name, [class*='name'], [class*='sender-name']"
      );
      const contentEl =
        item.querySelector("[class*='content'], [class*='text'], .message, [class*='transcription-text']") || item;

      let speaker = speakerEl ? speakerEl.innerText.trim() : "Participant";
      let text = contentEl ? contentEl.innerText.trim() : "";

      if (speaker && text.startsWith(speaker)) {
        text = text.substring(speaker.length).replace(/^:\s*/, "").trim();
      }

      if (text) {
        const uid = getElementUid(item);
        upsertUtterance(uid, speaker, text);
      }
    });
  }

  // Listen to Zoom in-page hook events (from zoom_hook.js via document.documentElement CustomEvent)
  if (window.location.host.includes("zoom.us")) {
    document.documentElement.addEventListener("meetscribe-zoom-caption", (evt) => {
      const detail = evt.detail;
      if (!detail || !detail.text) return;
      upsertUtterance("zoom_" + (detail.msgId || Date.now()), detail.speaker || "Participant", detail.text);
    });

    document.documentElement.addEventListener("meetscribe-zoom-title", (evt) => {
      const detail = evt.detail;
      if (detail && detail.title && !currentMeetingTitle) {
        currentMeetingTitle = detail.title;
        updateFloatingWidget();
      }
    });

    // Inject zoom_hook.js fallback in case MAIN world content script is delayed
    try {
      const s = document.createElement("script");
      s.src = chrome.runtime.getURL("zoom_hook.js");
      s.onload = () => s.remove();
      (document.head || document.documentElement).appendChild(s);
    } catch (e) {}
  }

  // Save or replace/update current meeting record in History
  function saveCurrentSessionToHistory(isManual = false) {
    if (!isActualMeetingRoom()) return Promise.resolve(null);
    if (transcripts.length === 0 && !isManual) return Promise.resolve(null);

    const key = getMeetingKey();
    if (key.includes("home") || key.includes("landing")) return Promise.resolve(null);

    const title = currentMeetingTitle || detectMeetingTitle();
    const now = Date.now();
    const dt = getFormattedDateTime(now);

    return new Promise((resolve) => {
      if (!isExtensionValid()) {
        stopAllIntervals();
        return resolve(null);
      }

      chrome.storage.local.get([STORAGE_SESSIONS_KEY], (res) => {
        if (!isExtensionValid()) {
          stopAllIntervals();
          return resolve(null);
        }
        const sessions = res[STORAGE_SESSIONS_KEY] || {};
        const existing = sessions[key] || {};

        // Replace or update existing record with same meeting key
        sessions[key] = {
          id: key,
          meetingKey: key,
          title: title,
          platform: getPlatform(),
          startTime: existing.startTime || now,
          lastUpdated: now,
          dateStr: dt.dateStr,
          timeStr: dt.timeStr,
          dateTimeStr: dt.fullStr,
          logs: transcripts,
          stats: {
            totalWords: transcripts.reduce((acc, t) => acc + (t.text ? t.text.split(/\s+/).length : 0), 0),
            totalTurns: transcripts.length
          }
        };

        chrome.storage.local.set({ [STORAGE_SESSIONS_KEY]: sessions }, () => {
          if (isManual) renderFloatingHistory();
          resolve(sessions[key]);
        });
      });
    });
  }

  function flushStorage() {
    if (!isExtensionValid()) {
      stopAllIntervals();
      return;
    }
    if (!isDirty) return;
    isDirty = false;

    try {
      chrome.storage.local.set({ [STORAGE_LOGS_KEY]: transcripts });
      saveCurrentSessionToHistory(false);
    } catch (e) {
      stopAllIntervals();
    }
  }

  // ==========================================
  // FLOATING IN-MEETING FULL VISUAL WIDGET
  // ==========================================
  let widgetContainer = null;
  let shadowRoot = null;

  const SPEAKER_COLORS = [
    "#6dcc6d", "#38bdf8", "#f472b6", "#fbbf24", "#a78bfa", "#34d399", "#fb923c", "#818cf8"
  ];

  function getSpeakerColor(name) {
    if (!name) return SPEAKER_COLORS[0];
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return SPEAKER_COLORS[Math.abs(hash) % SPEAKER_COLORS.length];
  }

  function createFloatingWidget() {
    if (document.getElementById("meetscribe-overlay-root")) return;

    widgetContainer = document.createElement("div");
    widgetContainer.id = "meetscribe-overlay-root";
    widgetContainer.style.cssText = "position: fixed; z-index: 2147483640; bottom: 80px; right: 24px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;";
    document.body.appendChild(widgetContainer);

    shadowRoot = widgetContainer.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = `
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        
        .pill-trigger {
          display: none;
          background: #0f172a;
          color: #f8fafc;
          border: 1px solid rgba(56, 189, 248, 0.4);
          border-radius: 9999px;
          padding: 8px 14px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          box-shadow: 0 4px 16px rgba(0,0,0,0.5);
          align-items: center;
          gap: 6px;
          backdrop-filter: blur(8px);
          transition: all 0.2s;
        }
        .pill-trigger:hover {
          border-color: #38bdf8;
          transform: translateY(-2px);
        }
        .pill-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: #64748b;
        }
        .pill-dot.recording {
          background: #ef4444;
          box-shadow: 0 0 8px #ef4444;
          animation: pulse-red 1.2s infinite;
        }

        .widget-card {
          width: 400px;
          height: 590px;
          background: rgba(15, 23, 42, 0.97);
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 14px;
          box-shadow: 0 12px 40px rgba(0,0,0,0.75);
          display: flex;
          flex-direction: column;
          overflow: hidden;
          backdrop-filter: blur(14px);
          color: #f1f5f9;
        }

        .widget-header {
          padding: 10px 14px;
          background: rgba(30, 41, 59, 0.9);
          border-bottom: 1px solid rgba(255,255,255,0.08);
          display: flex;
          justify-content: space-between;
          align-items: center;
          cursor: grab;
          user-select: none;
        }
        .header-left {
          display: flex;
          flex-direction: column;
          gap: 2px;
          overflow: hidden;
          max-width: 170px;
        }
        .header-title {
          font-size: 13px;
          font-weight: 700;
          color: #38bdf8;
          display: flex;
          align-items: center;
          gap: 6px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .header-subtitle {
          font-size: 9.5px;
          color: #94a3b8;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .live-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: #64748b;
          flex-shrink: 0;
          transition: all 0.3s;
        }
        .live-dot.active {
          background: #ef4444;
          box-shadow: 0 0 10px #ef4444, 0 0 4px #f87171;
          animation: pulse-red 1.2s infinite;
        }
        @keyframes pulse-red {
          0% { transform: scale(0.95); opacity: 0.8; }
          50% { transform: scale(1.2); opacity: 1; box-shadow: 0 0 12px #ef4444; }
          100% { transform: scale(0.95); opacity: 0.8; }
        }
        .status-recording-text {
          color: #ef4444 !important;
          font-weight: 700 !important;
          animation: text-pulse 1.4s infinite alternate;
        }
        @keyframes text-pulse {
          0% { opacity: 0.8; text-shadow: 0 0 2px rgba(239, 68, 68, 0.4); }
          100% { opacity: 1; text-shadow: 0 0 8px rgba(239, 68, 68, 0.9); }
        }
        .header-tools {
          display: flex;
          align-items: center;
          gap: 5px;
        }
        .btn-record-toggle {
          background: rgba(239, 68, 68, 0.15);
          border: 1px solid #ef4444;
          color: #ef4444;
          font-size: 11px;
          font-weight: 700;
          padding: 4px 8px;
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.2s;
          white-space: nowrap;
          display: inline-flex;
          align-items: center;
          gap: 4px;
        }
        .btn-record-toggle:hover {
          background: rgba(239, 68, 68, 0.25);
        }
        .btn-record-toggle.connected {
          background: rgba(16, 185, 129, 0.2);
          border-color: #10b981;
          color: #10b981;
          box-shadow: 0 0 8px rgba(16, 185, 129, 0.35);
        }
        .btn-record-toggle.connected:hover {
          background: rgba(16, 185, 129, 0.3);
        }
        .btn-save-record {
          background: rgba(56, 189, 248, 0.2);
          border: 1px solid rgba(56, 189, 248, 0.4);
          color: #38bdf8;
          font-size: 11px;
          font-weight: 700;
          padding: 4px 8px;
          border-radius: 6px;
          cursor: pointer;
          white-space: nowrap;
          transition: all 0.15s;
        }
        .btn-save-record:hover {
          background: #38bdf8;
          color: #042138;
        }
        .tool-btn {
          background: none;
          border: none;
          color: #94a3b8;
          font-size: 13px;
          cursor: pointer;
          padding: 2px 5px;
          border-radius: 4px;
        }
        .tool-btn:hover {
          color: #fff;
          background: rgba(255,255,255,0.1);
        }

        /* Tabs inside floating visual */
        .widget-tabs {
          display: flex;
          background: rgba(15, 23, 42, 0.95);
          border-bottom: 1px solid rgba(255,255,255,0.08);
          padding: 5px 8px;
          gap: 4px;
        }
        .tab-btn {
          flex: 1;
          padding: 6px 2px;
          background: transparent;
          border: none;
          border-radius: 6px;
          color: #94a3b8;
          font-size: 10.5px;
          font-weight: 600;
          cursor: pointer;
          text-align: center;
          transition: all 0.15s;
          white-space: nowrap;
        }
        .tab-btn.active {
          background: rgba(56, 189, 248, 0.15);
          color: #38bdf8;
          border: 1px solid rgba(56, 189, 248, 0.3);
        }

        .widget-content-panel {
          flex: 1;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
        }

        /* View 1: Transcript */
        #panel-transcript {
          flex: 1;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .transcript-toolbar {
          padding: 8px 10px 6px 10px;
          display: flex;
          gap: 6px;
          align-items: center;
          border-bottom: 1px solid rgba(255,255,255,0.06);
        }
        .search-box {
          flex: 1;
          background: rgba(30, 41, 59, 0.7);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 6px;
          padding: 4px 8px;
          font-size: 11px;
          color: #fff;
          outline: none;
        }
        .search-box:focus {
          border-color: #38bdf8;
        }
        .btn-tool-action {
          background: rgba(30, 41, 59, 0.7);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 6px;
          color: #cbd5e1;
          font-size: 10.5px;
          font-weight: 600;
          padding: 4px 8px;
          cursor: pointer;
          white-space: nowrap;
          display: inline-flex;
          align-items: center;
          gap: 3px;
        }
        .btn-tool-action:hover {
          color: #fff;
          border-color: #38bdf8;
        }
        .btn-tool-action.active {
          background: rgba(56, 189, 248, 0.2);
          border-color: #38bdf8;
          color: #38bdf8;
        }

        /* Collapsible Stats Drawer inside Transcript Panel */
        #transcript-stats-drawer {
          display: none;
          max-height: 180px;
          overflow-y: auto;
          background: rgba(15, 23, 42, 0.95);
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
          padding: 8px 10px;
          flex-direction: column;
          gap: 8px;
        }
        .stats-summary-card {
          background: rgba(30, 41, 59, 0.7);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 8px;
          padding: 6px 8px;
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 4px;
        }
        .stat-metric {
          display: flex;
          flex-direction: column;
          gap: 1px;
        }
        .stat-metric-val {
          font-size: 11.5px;
          font-weight: 700;
          color: #38bdf8;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .stat-metric-lbl {
          font-size: 8.5px;
          color: #94a3b8;
          text-transform: uppercase;
        }
        .speaker-stat-row {
          display: flex;
          flex-direction: column;
          gap: 3px;
          background: rgba(30, 41, 59, 0.5);
          border: 1px solid rgba(255, 255, 255, 0.06);
          border-radius: 6px;
          padding: 5px 8px;
        }
        .speaker-stat-header {
          display: flex;
          justify-content: space-between;
          font-size: 10.5px;
          font-weight: 600;
        }
        .speaker-stat-bar-track {
          width: 100%;
          height: 5px;
          background: rgba(15, 23, 42, 0.8);
          border-radius: 9999px;
          overflow: hidden;
        }
        .speaker-stat-bar-fill {
          height: 100%;
          border-radius: 9999px;
          transition: width 0.3s ease;
        }

        /* In-Transcript Docked Ask AI */
        #transcript-ai-dock {
          background: rgba(15, 23, 42, 0.95);
          border-top: 1px solid rgba(255, 255, 255, 0.1);
          padding: 6px 10px 8px 10px;
          display: flex;
          flex-direction: column;
          gap: 5px;
        }
        .ai-dock-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 10px;
        }
        .ai-dock-title {
          font-weight: 700;
          color: #38bdf8;
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .ai-dock-badge {
          background: rgba(56, 189, 248, 0.15);
          color: #38bdf8;
          padding: 1px 6px;
          border-radius: 4px;
          font-size: 9px;
          font-weight: 600;
        }
        .ai-quick-chips {
          display: flex;
          gap: 4px;
          overflow-x: auto;
          padding-bottom: 1px;
        }
        .ai-chip {
          background: rgba(255,255,255,0.06);
          border: 1px solid rgba(255,255,255,0.1);
          color: #cbd5e1;
          padding: 2px 7px;
          border-radius: 9999px;
          font-size: 9.5px;
          cursor: pointer;
          white-space: nowrap;
          transition: all 0.15s;
        }
        .ai-chip:hover {
          border-color: #38bdf8;
          color: #fff;
          background: rgba(56, 189, 248, 0.15);
        }
        .ai-chat-stream {
          max-height: 90px;
          min-height: 40px;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 5px;
          font-size: 10.5px;
          background: rgba(10, 16, 28, 0.6);
          padding: 6px 8px;
          border-radius: 6px;
          border: 1px solid rgba(255, 255, 255, 0.05);
        }
        .ai-msg-bubble {
          padding: 5px 8px;
          border-radius: 6px;
          line-height: 1.35;
          word-break: break-word;
        }
        .ai-msg-bubble.user {
          background: #0284c7;
          color: #fff;
          align-self: flex-end;
          max-width: 88%;
        }
        .ai-msg-bubble.assistant {
          background: rgba(30, 41, 59, 0.85);
          color: #e2e8f0;
          align-self: flex-start;
          max-width: 92%;
          border-left: 2px solid #38bdf8;
        }
        .ai-input-box {
          display: flex;
          gap: 4px;
        }
        .ai-input-field {
          flex: 1;
          background: rgba(30, 41, 59, 0.9);
          border: 1px solid rgba(255,255,255,0.12);
          border-radius: 6px;
          padding: 5px 8px;
          color: #fff;
          font-size: 10.5px;
          outline: none;
        }
        .ai-input-field:focus {
          border-color: #38bdf8;
        }
        .btn-ai-send {
          background: #38bdf8;
          color: #042138;
          border: none;
          border-radius: 6px;
          padding: 0 10px;
          font-weight: 700;
          font-size: 10.5px;
          cursor: pointer;
          transition: background 0.15s;
        }
        .btn-ai-send:hover {
          background: #7dd3fc;
        }
        .tag-badge {
          display: inline-flex;
          align-items: center;
          gap: 3px;
          font-size: 9px;
          font-weight: 700;
          padding: 1px 6px;
          border-radius: 4px;
          text-transform: uppercase;
        }
        .tag-action {
          background: rgba(251, 191, 36, 0.2);
          color: #fbbf24;
          border: 1px solid rgba(251, 191, 36, 0.4);
        }
        .tag-decision {
          background: rgba(52, 211, 153, 0.2);
          color: #34d399;
          border: 1px solid rgba(52, 211, 153, 0.4);
        }
        .tag-blocker {
          background: rgba(244, 63, 94, 0.2);
          color: #fb7185;
          border: 1px solid rgba(244, 63, 94, 0.4);
        }
        .tag-bar-item {
          display: flex;
          align-items: center;
          gap: 4px;
          margin-top: 4px;
        }
        .btn-tag-chip {
          background: rgba(15, 23, 42, 0.8);
          border: 1px solid rgba(255, 255, 255, 0.1);
          color: #94a3b8;
          font-size: 9.5px;
          padding: 1px 6px;
          border-radius: 4px;
          cursor: pointer;
        }
        .btn-tag-chip:hover {
          color: #fff;
          border-color: #38bdf8;
        }
        .deep-search-match {
          background: rgba(56, 189, 248, 0.15);
          border-left: 2px solid #38bdf8;
          padding: 4px 6px;
          margin-top: 4px;
          border-radius: 4px;
          font-size: 10px;
          color: #cbd5e1;
          line-height: 1.35;
        }
        .transcript-scroll {
          flex: 1;
          overflow-y: auto;
          padding: 8px 10px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          font-size: 11.5px;
          line-height: 1.45;
        }
        .item-group {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .speaker-name {
          font-size: 10.5px;
          font-weight: 700;
        }
        .speaker-time {
          font-size: 9.5px;
          color: #64748b;
          font-variant-numeric: tabular-nums;
        }
        .bubble-text {
          background: rgba(30, 41, 59, 0.6);
          padding: 6px 9px;
          border-radius: 6px;
          border-left: 2px solid #38bdf8;
          word-break: break-word;
          color: #e2e8f0;
        }

        /* View 2: Riwayat (History) */
        #panel-history {
          flex: 1;
          display: none;
          overflow-y: auto;
          padding: 10px;
          gap: 8px;
          flex-direction: column;
        }
        .history-card-item {
          background: rgba(30, 41, 59, 0.7);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 8px;
          padding: 9px 11px;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .history-card-item:hover {
          border-color: rgba(56, 189, 248, 0.35);
          background: rgba(30, 41, 59, 0.95);
        }
        .hist-title {
          font-size: 12px;
          font-weight: 700;
          color: #fff;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .hist-meta {
          font-size: 10px;
          color: #94a3b8;
          display: flex;
          justify-content: space-between;
        }
        .hist-time-tag {
          color: #38bdf8;
          font-weight: 600;
        }
        .hist-actions {
          display: flex;
          gap: 6px;
          margin-top: 4px;
        }
        .btn-hist-small {
          background: rgba(56, 189, 248, 0.15);
          border: 1px solid rgba(56, 189, 248, 0.3);
          color: #38bdf8;
          padding: 3px 8px;
          border-radius: 4px;
          font-size: 10px;
          cursor: pointer;
        }
        .btn-hist-small.danger {
          border-color: rgba(244, 63, 94, 0.3);
          color: #fb7185;
          background: rgba(244, 63, 94, 0.1);
        }

        /* View: Settings */
        #panel-settings {
          flex: 1;
          display: none;
          flex-direction: column;
          padding: 12px;
          gap: 8px;
          overflow-y: auto;
        }
        .setting-field {
          display: flex;
          flex-direction: column;
          gap: 3px;
        }
        .setting-label {
          font-size: 10px;
          color: #94a3b8;
          font-weight: 600;
          text-transform: uppercase;
        }
        .setting-input {
          background: rgba(30, 41, 59, 0.8);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 6px;
          padding: 6px 8px;
          color: #fff;
          font-size: 11px;
          outline: none;
        }
        .setting-input:focus {
          border-color: #38bdf8;
        }
        .btn-save-setting {
          margin-top: 6px;
          background: #38bdf8;
          color: #042138;
          font-weight: 700;
          padding: 7px;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-size: 11.5px;
        }

        .widget-footer {
          padding: 8px 12px;
          background: rgba(15, 23, 42, 0.95);
          border-top: 1px solid rgba(255,255,255,0.08);
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 10.5px;
          color: #94a3b8;
        }
        .footer-actions {
          display: flex;
          gap: 5px;
        }
        .quick-action-btn {
          background: rgba(56, 189, 248, 0.15);
          border: 1px solid rgba(56, 189, 248, 0.3);
          color: #38bdf8;
          padding: 3px 8px;
          border-radius: 4px;
          font-size: 10.5px;
          font-weight: 600;
          cursor: pointer;
        }
        .quick-action-btn:hover {
          background: #38bdf8;
          color: #042138;
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      </style>

      <div class="pill-trigger" id="widget-pill">
        <div class="pill-dot" id="pill-indicator"></div>
        <span>🎙️ MeetScribe (<span id="pill-count">0</span>)</span>
      </div>

      <div class="widget-card" id="widget-card">
        <div class="widget-header" id="widget-drag-header">
          <div class="header-left">
            <div class="header-title">
              <div class="live-dot" id="widget-header-dot"></div>
              <span>MeetScribe AI</span>
            </div>
            <div class="header-subtitle" id="widget-header-sub">Mendeteksi room...</div>
          </div>
          <div class="header-tools">
            <button class="btn-save-record" id="btn-save-now" title="Save / Update transkrip ke Riwayat">💾 Save</button>
            <button class="btn-record-toggle" id="btn-floating-record">⏹ Disconnected</button>
            <button class="tool-btn" id="btn-minimize" title="Minimize">—</button>
            <button class="tool-btn" id="btn-close" title="Hide">✕</button>
          </div>
        </div>

        <div class="widget-tabs">
          <button class="tab-btn active" data-target="panel-transcript">📝 Transkrip</button>
          <button class="tab-btn" data-target="panel-history">📁 Riwayat</button>
          <button class="tab-btn" data-target="panel-settings">⚙️ Settings</button>
        </div>

        <div class="widget-content-panel">
          <!-- PANEL 1: Transkrip (Includes Stats Drawer & In-Transcript Ask AI) -->
          <div id="panel-transcript">
            <div class="transcript-toolbar">
              <input type="text" class="search-box" id="widget-search" placeholder="Cari percakapan...">
              <button class="btn-tool-action" id="btn-toggle-stats" title="Tampilkan / Sembunyikan Statistik">📊 Stats</button>
              <button class="btn-tool-action" id="btn-clear-cur">🗑️ Clear</button>
            </div>

            <!-- Collapsible Stats Drawer -->
            <div id="transcript-stats-drawer">
              <div id="stats-content-area" style="display: flex; flex-direction: column; gap: 8px;">
                <div style="text-align: center; color: #64748b; font-size: 11px; padding: 10px 0;">
                  Belum ada percakapan untuk dihitung statistik & engagement.
                </div>
              </div>
            </div>

            <!-- Main Transcript Scroll Body -->
            <div class="transcript-scroll" id="widget-transcript-body">
              <div style="text-align: center; color: #64748b; margin: auto; font-size: 11px;">
                Merekam transkrip realtime...<br>Bicara untuk melihat teks masuk.
              </div>
            </div>

            <!-- Docked Ask AI directly inside Transcript -->
            <div id="transcript-ai-dock">
              <div class="ai-dock-header">
                <div class="ai-dock-title">
                  <span>🤖 Ask AI Transkrip</span>
                </div>
                <span class="ai-dock-badge" id="ai-transcript-context-badge">Realtime Meeting</span>
              </div>
              <div class="ai-quick-chips">
                <button class="ai-chip" data-prompt="Ringkas poin penting percakapan ini secara singkat.">✨ Ringkasan</button>
                <button class="ai-chip" data-prompt="Tuliskan Action Items dan siapa penanggung jawabnya.">✅ Action Items</button>
                <button class="ai-chip" data-prompt="Apa keputusan utama meeting ini?">🎯 Keputusan</button>
              </div>
              <div class="ai-chat-stream" id="widget-ai-stream">
                <div class="ai-msg-bubble assistant">Halo! Ajukan pertanyaan seputar transkrip percakapan meeting ini.</div>
              </div>
              <div class="ai-input-box">
                <input type="text" class="ai-input-field" id="widget-ai-input" placeholder="Tanyakan seputar transkrip meeting...">
                <button class="btn-ai-send" id="btn-widget-ai-send">Kirim</button>
              </div>
            </div>
          </div>

          <!-- PANEL 2: Riwayat -->
          <div id="panel-history">
            <div class="transcript-toolbar" style="padding: 0 0 6px 0;">
              <input type="text" class="search-box" id="history-deep-search" placeholder="🔍 Cari kata di seluruh riwayat meeting...">
            </div>
            <div id="history-items-container" style="display: flex; flex-direction: column; gap: 8px;">
              <div style="text-align: center; color: #64748b; margin: auto; font-size: 11px;">
                Memuat riwayat meeting...
              </div>
            </div>
          </div>

          <!-- PANEL 3: Settings -->
          <div id="panel-settings">
            <div class="setting-field">
              <label class="setting-label">Bahasa Captions (Google Meet)</label>
              <div style="display: flex; gap: 4px;">
                <button class="btn-tool-action" id="btn-lang-id" style="flex: 1;">🇮🇩 Indonesia</button>
                <button class="btn-tool-action" id="btn-lang-en" style="flex: 1;">🇬🇧 English</button>
              </div>
              <span id="lang-switch-status" style="font-size: 10px; color: #38bdf8; min-height: 14px;"></span>
            </div>
            <div style="border-top: 1px solid rgba(255, 255, 255, 0.08); margin: 2px 0;"></div>
            <div style="font-size: 11px; font-weight: 700; color: #38bdf8; display: flex; align-items: center; gap: 4px;">
              ⚙️ Configuration AI Provider
            </div>
            <div class="setting-field">
              <label class="setting-label">AI Provider Base URL</label>
              <input type="text" class="setting-input" id="cfg-base" placeholder="http://localhost:2080/v1 atau https://omniroute...">
            </div>
            <div class="setting-field">
              <div style="display: flex; justify-content: space-between;">
                <label class="setting-label">API Key / Token</label>
                <span style="font-size: 9px; color: #94a3b8;">(Opsional jika lokal)</span>
              </div>
              <input type="password" class="setting-input" id="cfg-key" placeholder="Bearer token / kosongkan jika tanpa auth">
            </div>
            <div class="setting-field">
              <label class="setting-label">Model ID</label>
              <input type="text" class="setting-input" id="cfg-mod" placeholder="ag/gemini-3.8-flash">
            </div>
            <button class="btn-save-setting" id="btn-save-cfg-widget">Simpan Konfigurasi</button>
          </div>
        </div>

        <div class="widget-footer">
          <span id="widget-status-text">Standby</span>
          <div class="footer-actions">
            <button class="quick-action-btn" id="btn-export-widget" title="Export Markdown">💾 .md</button>
            <button class="quick-action-btn" id="btn-copy-widget">📋 Copy</button>
          </div>
        </div>
      </div>
    `;

    setupWidgetInteractions();
    updateFloatingWidget();
  }

  function setupWidgetInteractions() {
    const card = shadowRoot.getElementById("widget-card");
    const pill = shadowRoot.getElementById("widget-pill");
    const btnMin = shadowRoot.getElementById("btn-minimize");
    const btnClose = shadowRoot.getElementById("btn-close");
    const btnCopy = shadowRoot.getElementById("btn-copy-widget");
    const btnExport = shadowRoot.getElementById("btn-export-widget");
    const btnRecord = shadowRoot.getElementById("btn-floating-record");
    const btnSaveNow = shadowRoot.getElementById("btn-save-now");
    const btnClearCur = shadowRoot.getElementById("btn-clear-cur");
    const searchInput = shadowRoot.getElementById("widget-search");
    const header = shadowRoot.getElementById("widget-drag-header");
    const tabBtns = shadowRoot.querySelectorAll(".tab-btn");

    // Tab Navigation (3 tabs: Transkrip, Riwayat, Settings)
    tabBtns.forEach((tab) => {
      tab.addEventListener("click", () => {
        tabBtns.forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");
        const targetId = tab.getAttribute("data-target");

        const panelTranscript = shadowRoot.getElementById("panel-transcript");
        const panelHistory = shadowRoot.getElementById("panel-history");
        const panelSettings = shadowRoot.getElementById("panel-settings");

        if (panelTranscript) panelTranscript.style.display = targetId === "panel-transcript" ? "flex" : "none";
        if (panelHistory) panelHistory.style.display = targetId === "panel-history" ? "flex" : "none";
        if (panelSettings) panelSettings.style.display = targetId === "panel-settings" ? "flex" : "none";

        if (targetId === "panel-transcript") {
          const statsDrawer = shadowRoot.getElementById("transcript-stats-drawer");
          if (statsDrawer && statsDrawer.style.display === "flex") {
            renderFloatingStats();
          }
        }
        if (targetId === "panel-history") renderFloatingHistory();
        if (targetId === "panel-settings") loadFloatingSettings();
      });
    });

    // Toggle Collapsible Stats Drawer inside Transkrip
    const btnToggleStats = shadowRoot.getElementById("btn-toggle-stats");
    const statsDrawer = shadowRoot.getElementById("transcript-stats-drawer");
    if (btnToggleStats && statsDrawer) {
      btnToggleStats.addEventListener("click", () => {
        const isHidden = statsDrawer.style.display === "none" || !statsDrawer.style.display;
        statsDrawer.style.display = isHidden ? "flex" : "none";
        btnToggleStats.classList.toggle("active", isHidden);
        if (isHidden) {
          renderFloatingStats();
        }
      });
    }

    // Save record to history button
    btnSaveNow.addEventListener("click", async () => {
      if (transcripts.length === 0) {
        btnSaveNow.innerText = "Kosong!";
        setTimeout(() => (btnSaveNow.innerText = "💾 Save"), 1200);
        return;
      }
      btnSaveNow.innerText = "Saving...";
      await saveCurrentSessionToHistory(true);
      btnSaveNow.innerText = "✅ Saved!";
      setTimeout(() => (btnSaveNow.innerText = "💾 Save"), 1500);
    });

    // Record toggle directly from floating visual
    btnRecord.addEventListener("click", () => {
      if (isRecordingActive) {
        stopObserver();
      } else {
        startObserver();
      }
    });

    // Minimize / Expand
    btnMin.addEventListener("click", () => {
      card.style.display = "none";
      pill.style.display = "flex";
    });

    pill.addEventListener("click", () => {
      pill.style.display = "none";
      card.style.display = "flex";
    });

    btnClose.addEventListener("click", () => {
      card.style.display = "none";
      pill.style.display = "none";
    });

    // Language switcher buttons
    const btnLangId = shadowRoot.getElementById("btn-lang-id");
    const btnLangEn = shadowRoot.getElementById("btn-lang-en");
    const langStatus = shadowRoot.getElementById("lang-switch-status");

    if (btnLangId) {
      btnLangId.addEventListener("click", async () => {
        langStatus.innerText = "Mengubah bahasa ke Indonesia...";
        const ok = await setGoogleMeetLanguage("indonesia");
        langStatus.innerText = ok ? "✅ Bahasa: Indonesia" : "Gagal buka setelan Meet.";
        setTimeout(() => (langStatus.innerText = ""), 2500);
      });
    }

    if (btnLangEn) {
      btnLangEn.addEventListener("click", async () => {
        langStatus.innerText = "Switching language to English...";
        const ok = await setGoogleMeetLanguage("english");
        langStatus.innerText = ok ? "✅ Language: English" : "Failed to open settings.";
        setTimeout(() => (langStatus.innerText = ""), 2500);
      });
    }

    // Deep search in History
    const historyDeepSearch = shadowRoot.getElementById("history-deep-search");
    if (historyDeepSearch) {
      historyDeepSearch.addEventListener("input", () => {
        renderFloatingHistory();
      });
    }

    // Clear current transcript
    btnClearCur.addEventListener("click", () => {
      if (confirm("Kosongkan transkrip percakapan meeting saat ini?")) {
        transcripts = [];
        chrome.storage.local.set({ [STORAGE_LOGS_KEY]: [] }, () => {
          updateFloatingWidget();
        });
      }
    });

    // Search filter
    searchInput.addEventListener("input", () => {
      updateFloatingWidget();
    });

    // Copy Markdown
    btnCopy.addEventListener("click", () => {
      const fullText = transcripts.map((t) => `[${t.time}] ${t.speaker}: ${t.text}`).join("\n");
      navigator.clipboard.writeText(fullText).then(() => {
        btnCopy.innerText = "✅ Copied";
        setTimeout(() => (btnCopy.innerText = "📋 Copy"), 1200);
      });
    });

    // Export .md directly from floating visual
    btnExport.addEventListener("click", () => {
      if (!transcripts.length) return;
      const title = currentMeetingTitle || detectMeetingTitle();
      const dt = getFormattedDateTime(Date.now());
      let md = `# 🎙️ ${title}\n\n- Tanggal & Waktu: ${dt.fullStr}\n- Platform: ${getPlatform()}\n\n---\n\n## 📝 Transkrip Lengkap\n\n`;
      transcripts.forEach((t) => {
        md += `### [${t.time}] ${t.speaker}\n\n${t.text}\n\n`;
      });
      md += `\n---\n*Dicatat otomatis oleh MeetScribe AI*\n`;

      const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const safeTitle = title.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 35);
      a.href = url;
      a.download = `${safeTitle}-${dt.dateStr.replace(/\s+/g, "_")}.md`;
      a.click();
      URL.revokeObjectURL(url);
    });

    // In-Transcript Ask AI Question handler
    const aiInput = shadowRoot.getElementById("widget-ai-input");
    const aiBtnSend = shadowRoot.getElementById("btn-widget-ai-send");
    const aiStream = shadowRoot.getElementById("widget-ai-stream");
    const aiChips = shadowRoot.querySelectorAll(".ai-chip");
    const aiContextBadge = shadowRoot.getElementById("ai-transcript-context-badge");

    aiChips.forEach((chip) => {
      chip.addEventListener("click", () => {
        aiInput.value = chip.getAttribute("data-prompt");
        triggerFloatingAi();
      });
    });

    aiBtnSend.addEventListener("click", triggerFloatingAi);
    aiInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") triggerFloatingAi();
    });

    async function triggerFloatingAi() {
      const q = aiInput.value.trim();
      if (!q) return;
      aiInput.value = "";

      const userBubble = document.createElement("div");
      userBubble.className = "ai-msg-bubble user";
      userBubble.innerText = q;
      aiStream.appendChild(userBubble);

      const aiBubble = document.createElement("div");
      aiBubble.className = "ai-msg-bubble assistant";
      aiBubble.innerText = "Sedang menganalisis transkrip...";
      aiStream.appendChild(aiBubble);
      aiStream.scrollTop = aiStream.scrollHeight;

      const targetLogs = transcripts;
      const targetTitle = currentMeetingTitle || detectMeetingTitle() || "Meeting Saat Ini";

      if (!targetLogs || targetLogs.length === 0) {
        aiBubble.innerText = "Transkrip masih kosong. Mulai bicara di meeting atau klik 'Buka' pada arsip di tab Riwayat.";
        return;
      }

      chrome.storage.local.get([STORAGE_CONFIG_KEY], async (res) => {
        const cfg = res[STORAGE_CONFIG_KEY] || {};
        const baseUrl = (cfg.baseUrl || "http://localhost:2080/v1").replace(/\/+$/, "");
        const apiKey = cfg.apiKey || "";
        const model = cfg.model || "ag/gemini-3.8-flash";

        const isLocalOrRouter =
          baseUrl.includes("localhost") ||
          baseUrl.includes("127.0.0.1") ||
          baseUrl.includes("router") ||
          baseUrl.includes(":2080") ||
          baseUrl.includes(":11434");

        if (!apiKey && !isLocalOrRouter) {
          aiBubble.innerText = "API Key belum diisi di tab Settings.";
          return;
        }

        const contextText = targetLogs.map((t) => `[${t.time}] ${t.speaker}: ${t.text}`).join("\n");
        const promptSystem = `Kamu asisten meeting AI. Jawab pertanyaan user seputar transkrip percakapan meeting "${targetTitle}" secara ringkas, to the point, dan profesional berdasarkan transkrip berikut:\n\n${contextText}`;

        let hasReceivedFirstChunk = false;
        try {
          const port = chrome.runtime.connect({ name: "AI_STREAM_PORT" });

          port.onMessage.addListener((msg) => {
            if (msg.type === "chunk") {
              if (!hasReceivedFirstChunk) {
                aiBubble.innerText = "";
                hasReceivedFirstChunk = true;
              }
              aiBubble.innerText += msg.text;
              aiStream.scrollTop = aiStream.scrollHeight;
            } else if (msg.type === "error") {
              if (!hasReceivedFirstChunk) {
                aiBubble.innerText = `Gagal: ${msg.error}`;
              } else {
                aiBubble.innerText += `\n[Error: ${msg.error}]`;
              }
              port.disconnect();
            } else if (msg.type === "done") {
              if (!hasReceivedFirstChunk && !aiBubble.innerText.trim()) {
                aiBubble.innerText = "Tidak ada respon dari model.";
              }
              port.disconnect();
            }
          });

          port.onDisconnect.addListener(() => {
            if (chrome.runtime.lastError && !hasReceivedFirstChunk) {
              aiBubble.innerText = `Error: ${chrome.runtime.lastError.message}`;
            }
          });

          port.postMessage({
            payload: {
              baseUrl: baseUrl,
              apiKey: apiKey,
              model: model,
              messages: [
                { role: "system", content: promptSystem },
                { role: "user", content: q }
              ],
              temperature: 0.3
            }
          });
        } catch (connErr) {
          aiBubble.innerText = `Gagal streaming: ${connErr.message}`;
        }
      });
    }

    // 9router Settings save handler
    const cfgBase = shadowRoot.getElementById("cfg-base");
    const cfgMod = shadowRoot.getElementById("cfg-mod");
    const cfgKey = shadowRoot.getElementById("cfg-key");

    const btnSaveCfg = shadowRoot.getElementById("btn-save-cfg-widget");
    btnSaveCfg.addEventListener("click", () => {
      const cfg = {
        baseUrl: cfgBase.value.trim() || "http://localhost:2080/v1",
        apiKey: cfgKey.value.trim(),
        model: cfgMod.value.trim() || "ag/gemini-3.8-flash"
      };
      chrome.storage.local.set({ [STORAGE_CONFIG_KEY]: cfg }, () => {
        btnSaveCfg.innerText = "✅ Tersimpan!";
        setTimeout(() => (btnSaveCfg.innerText = "Simpan Konfigurasi"), 1500);
      });
    });

    // Draggable Widget
    let isDragging = false;
    let offsetX = 0;
    let offsetY = 0;

    header.addEventListener("mousedown", (e) => {
      if (e.target.tagName === "BUTTON") return;
      isDragging = true;
      offsetX = e.clientX - widgetContainer.getBoundingClientRect().left;
      offsetY = e.clientY - widgetContainer.getBoundingClientRect().top;
      header.style.cursor = "grabbing";
    });

    document.addEventListener("mousemove", (e) => {
      if (!isDragging) return;
      const x = e.clientX - offsetX;
      const y = e.clientY - offsetY;
      widgetContainer.style.left = `${Math.max(10, Math.min(window.innerWidth - 390, x))}px`;
      widgetContainer.style.top = `${Math.max(10, Math.min(window.innerHeight - 540, y))}px`;
      widgetContainer.style.bottom = "auto";
      widgetContainer.style.right = "auto";
    });

    document.addEventListener("mouseup", () => {
      isDragging = false;
      if (header) header.style.cursor = "grab";
    });
  }

  function loadFloatingSettings() {
    if (!shadowRoot) return;
    chrome.storage.local.get([STORAGE_CONFIG_KEY], (res) => {
      const cfg = res[STORAGE_CONFIG_KEY] || {};
      const baseEl = shadowRoot.getElementById("cfg-base");
      const keyEl = shadowRoot.getElementById("cfg-key");
      const modEl = shadowRoot.getElementById("cfg-mod");
      if (baseEl) baseEl.value = cfg.baseUrl || "http://localhost:2080/v1";
      if (keyEl) keyEl.value = cfg.apiKey || "";
      if (modEl) modEl.value = cfg.model || "ag/gemini-3.8-flash";
    });
  }

  function renderFloatingHistory() {
    if (!shadowRoot) return;
    const historyContainer = shadowRoot.getElementById("history-items-container");
    const historyDeepSearch = shadowRoot.getElementById("history-deep-search");
    if (!historyContainer) return;

    const query = (historyDeepSearch?.value || "").toLowerCase().trim();

    chrome.storage.local.get([STORAGE_SESSIONS_KEY], (res) => {
      const sessions = res[STORAGE_SESSIONS_KEY] || {};

      // Auto-prune home / empty / invalid historical entries
      let hasPurged = false;
      for (const sKey of Object.keys(sessions)) {
        const item = sessions[sKey];
        if (
          sKey === "meet_home" ||
          sKey === "meet_landing" ||
          sKey.includes("home") ||
          !item.logs ||
          item.logs.length === 0
        ) {
          delete sessions[sKey];
          hasPurged = true;
        }
      }
      if (hasPurged) {
        chrome.storage.local.set({ [STORAGE_SESSIONS_KEY]: sessions });
      }

      let list = Object.values(sessions).sort((a, b) => (b.lastUpdated || 0) - (a.lastUpdated || 0));

      if (query) {
        list = list
          .map((s) => {
            const titleMatch = (s.title || "").toLowerCase().includes(query);
            const platformMatch = (s.platform || "").toLowerCase().includes(query);
            const matchingLogs = (s.logs || []).filter((l) => (l.text || "").toLowerCase().includes(query));
            if (titleMatch || platformMatch || matchingLogs.length > 0) {
              return { ...s, matchingLogs };
            }
            return null;
          })
          .filter(Boolean);
      }

      if (list.length === 0) {
        historyContainer.innerHTML = `<div style="text-align: center; color: #64748b; margin: auto; font-size: 11px;">${query ? "Tidak ada percakapan atau judul yang cocok." : "Belum ada arsip riwayat meeting."}</div>`;
        return;
      }

      historyContainer.innerHTML = list
        .map((s) => {
          const words = s.stats?.totalWords || 0;
          const displayDateTime = s.dateTimeStr || `${s.dateStr || ""} ${s.timeStr || ""}`.trim() || "Baru saja";
          let snippetsHtml = "";
          if (s.matchingLogs && s.matchingLogs.length > 0) {
            snippetsHtml = s.matchingLogs
              .slice(0, 2)
              .map((m) => `<div class="deep-search-match">💬 <strong>${escapeHtml(m.speaker)}:</strong> ${escapeHtml(m.text.slice(0, 85))}...</div>`)
              .join("");
          }

          return `
            <div class="history-card-item">
              <div class="hist-title">${escapeHtml(s.title || "Meeting")}</div>
              <div class="hist-meta">
                <span class="hist-time-tag">📅 ${escapeHtml(displayDateTime)}</span>
                <span>${escapeHtml(s.platform)}</span>
              </div>
              <div class="hist-meta">
                <span>✍️ ${words} kata • ${s.logs?.length || 0} turn</span>
                <span>ID: ${escapeHtml((s.meetingKey || "").slice(0, 14))}</span>
              </div>
              ${snippetsHtml}
              <div class="hist-actions">
                <button class="btn-hist-small" data-load-session="${s.id}">Buka</button>
                <button class="btn-hist-small" data-export-session="${s.id}">Export .md</button>
                <button class="btn-hist-small danger" data-del-session="${s.id}">Hapus</button>
              </div>
            </div>
          `;
        })
        .join("");

      historyContainer.querySelectorAll("[data-load-session]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const sId = btn.getAttribute("data-load-session");
          if (sessions[sId] && sessions[sId].logs) {
            transcripts = sessions[sId].logs;
            currentMeetingTitle = sessions[sId].title || detectMeetingTitle();
            updateFloatingWidget();

            const transTab = shadowRoot.querySelector(".tab-btn[data-target='panel-transcript']");
            if (transTab) transTab.click();

            const aiBadge = shadowRoot.getElementById("ai-transcript-context-badge");
            if (aiBadge) {
              aiBadge.innerText = `📁 Arsip: ${(currentMeetingTitle || "Meeting").slice(0, 18)}`;
            }

            const aiStream = shadowRoot.getElementById("widget-ai-stream");
            if (aiStream) {
              const infoBubble = document.createElement("div");
              infoBubble.className = "ai-msg-bubble assistant";
              infoBubble.innerHTML = `📁 <strong>Transkrip "${escapeHtml(currentMeetingTitle)}"</strong> dimuat (${transcripts.length} percakapan). Ask AI siap menjawab pertanyaan dari transkrip ini!`;
              aiStream.appendChild(infoBubble);
              aiStream.scrollTop = aiStream.scrollHeight;
            }
          }
        });
      });

      historyContainer.querySelectorAll("[data-export-session]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const sId = btn.getAttribute("data-export-session");
          const sess = sessions[sId];
          if (!sess) return;
          const dt = sess.dateTimeStr || sess.dateStr || "meeting";
          let md = `# 🎙️ ${sess.title || "Meeting"}\n\n- Tanggal & Waktu: ${dt}\n- Platform: ${sess.platform}\n\n---\n\n## 📝 Transkrip Lengkap\n\n`;
          (sess.logs || []).forEach((t) => {
            const tagLabel = t.tag ? ` [${t.tag.toUpperCase()}]` : "";
            md += `### [${t.time}] ${t.speaker}${tagLabel}\n\n${t.text}\n\n`;
          });
          md += `\n---\n*Dicatat otomatis oleh MeetScribe AI*\n`;

          const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          const safeTitle = (sess.title || "Meeting").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 35);
          a.href = url;
          a.download = `${safeTitle}.md`;
          a.click();
          URL.revokeObjectURL(url);
        });
      });

      historyContainer.querySelectorAll("[data-del-session]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const sId = btn.getAttribute("data-del-session");
          delete sessions[sId];
          chrome.storage.local.set({ [STORAGE_SESSIONS_KEY]: sessions }, () => {
            renderFloatingHistory();
          });
        });
      });
    });
  }

  function renderFloatingStats() {
    if (!shadowRoot) return;
    const statsContainer = shadowRoot.getElementById("stats-content-area");
    if (!statsContainer) return;

    if (transcripts.length === 0) {
      statsContainer.innerHTML = `
        <div style="text-align: center; color: #64748b; margin: auto; font-size: 11px; padding: 20px 0;">
          Belum ada percakapan untuk dihitung statistik & engagement.
        </div>
      `;
      return;
    }

    const speakerMap = {};
    let totalWords = 0;
    const totalTurns = transcripts.length;

    transcripts.forEach((t) => {
      const spk = t.speaker || "Participant";
      const wCount = (t.text || "").trim().split(/\\s+/).filter(Boolean).length;
      totalWords += wCount;
      if (!speakerMap[spk]) {
        speakerMap[spk] = { name: spk, words: 0, turns: 0 };
      }
      speakerMap[spk].words += wCount;
      speakerMap[spk].turns += 1;
    });

    const speakers = Object.values(speakerMap).sort((a, b) => b.words - a.words);
    const dominant = speakers[0];

    const rowsHtml = speakers
      .map((s) => {
        const pct = totalWords > 0 ? Math.round((s.words / totalWords) * 100) : 0;
        const color = getSpeakerColor(s.name);
        return `
          <div class="speaker-stat-row">
            <div class="speaker-stat-header">
              <span style="color: ${color};">${escapeHtml(s.name)}</span>
              <span style="color: #94a3b8; font-size: 10px;">${pct}% (${s.words} kata • ${s.turns} turn)</span>
            </div>
            <div class="speaker-stat-bar-track">
              <div class="speaker-stat-bar-fill" style="width: ${pct}%; background: ${color};"></div>
            </div>
          </div>
        `;
      })
      .join("");

    statsContainer.innerHTML = `
      <div class="stats-summary-card">
        <div class="stat-metric">
          <span class="stat-metric-val">${speakers.length}</span>
          <span class="stat-metric-lbl">👥 Pembicara Aktif</span>
        </div>
        <div class="stat-metric">
          <span class="stat-metric-val">${totalWords}</span>
          <span class="stat-metric-lbl">✍️ Total Kata</span>
        </div>
        <div class="stat-metric">
          <span class="stat-metric-val">${totalTurns}</span>
          <span class="stat-metric-lbl">🔄 Turn Bicara</span>
        </div>
        <div class="stat-metric">
          <span class="stat-metric-val" style="color: ${getSpeakerColor(dominant?.name)}; font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
            ${escapeHtml(dominant?.name || "-")}
          </span>
          <span class="stat-metric-lbl">👑 Paling Dominan</span>
        </div>
      </div>

      <div style="font-size: 10px; font-weight: 700; color: #94a3b8; text-transform: uppercase; margin-top: 4px;">
        Rasio Durasi & Talk-Time
      </div>
      <div style="display: flex; flex-direction: column; gap: 6px;">
        ${rowsHtml}
      </div>
    `;
  }

  function updateFloatingWidget() {
    if (!shadowRoot) return;
    const body = shadowRoot.getElementById("widget-transcript-body");
    const countEl = shadowRoot.getElementById("pill-count");
    const statusText = shadowRoot.getElementById("widget-status-text");
    const headerDot = shadowRoot.getElementById("widget-header-dot");
    const headerSub = shadowRoot.getElementById("widget-header-sub");
    const pillDot = shadowRoot.getElementById("pill-indicator");
    const btnRecord = shadowRoot.getElementById("btn-floating-record");
    const searchInput = shadowRoot.getElementById("widget-search");

    if (countEl) countEl.innerText = transcripts.length;
    if (headerSub) {
      const title = currentMeetingTitle || detectMeetingTitle();
      headerSub.innerText = `${getPlatform()} • ${title}`;
    }

    if (isRecordingActive) {
      if (statusText) {
        statusText.innerText = "● Merekam Transkrip";
        statusText.className = "status-recording-text";
      }
      if (headerDot) headerDot.className = "live-dot active";
      if (pillDot) pillDot.className = "pill-dot recording";
      if (btnRecord) {
        btnRecord.innerText = "⚡ Connected";
        btnRecord.className = "btn-record-toggle connected";
      }
    } else {
      if (statusText) {
        statusText.innerText = "Standby";
        statusText.className = "";
      }
      if (headerDot) headerDot.className = "live-dot";
      if (pillDot) pillDot.className = "pill-dot";
      if (btnRecord) {
        btnRecord.innerText = "⏹ Disconnected";
        btnRecord.className = "btn-record-toggle";
      }
    }

    const statsDrawer = shadowRoot.getElementById("transcript-stats-drawer");
    if (statsDrawer && statsDrawer.style.display === "flex") {
      renderFloatingStats();
    }

    if (!body) return;

    const query = (searchInput?.value || "").toLowerCase();
    const filtered = transcripts.filter((t) => {
      return (
        t.speaker.toLowerCase().includes(query) ||
        (t.text && t.text.toLowerCase().includes(query))
      );
    });

    if (filtered.length === 0) {
      body.innerHTML = `
        <div style="text-align: center; color: #64748b; margin: auto; font-size: 11px;">
          ${query ? "Tidak ada percakapan yang cocok dengan pencarian." : isRecordingActive ? "Merekam transkrip realtime...<br>Bicara untuk melihat teks masuk." : "Klik ⏹ Disconnected di atas untuk mengaktifkan rekaman percakapan."}
        </div>
      `;
      return;
    }

    const recent = filtered.slice(-25);
    body.innerHTML = recent
      .map((item) => {
        const color = getSpeakerColor(item.speaker);
        let tagBadgeHtml = "";
        if (item.tag === "action") tagBadgeHtml = `<span class="tag-badge tag-action">🟡 Action</span>`;
        if (item.tag === "decision") tagBadgeHtml = `<span class="tag-badge tag-decision">🟢 Decision</span>`;
        if (item.tag === "blocker") tagBadgeHtml = `<span class="tag-badge tag-blocker">🔴 Blocker</span>`;

        return `
          <div class="item-group">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <div style="display: flex; align-items: baseline; gap: 6px;">
                <span class="speaker-name" style="color: ${color};">${escapeHtml(item.speaker)}</span>
                <span class="speaker-time">${escapeHtml(item.time || "")}</span>
              </div>
              ${tagBadgeHtml}
            </div>
            <div class="bubble-text" style="border-left-color: ${color};">
              ${escapeHtml(item.text)}
              <div class="tag-bar-item">
                <button class="btn-tag-chip" data-set-tag="${item.id}" data-tag-val="action" title="Tandai Action Item">🟡 Action</button>
                <button class="btn-tag-chip" data-set-tag="${item.id}" data-tag-val="decision" title="Tandai Decision">🟢 Decision</button>
                <button class="btn-tag-chip" data-set-tag="${item.id}" data-tag-val="blocker" title="Tandai Blocker">🔴 Blocker</button>
              </div>
            </div>
          </div>
        `;
      })
      .join("");

    body.querySelectorAll("[data-set-tag]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-set-tag");
        const val = btn.getAttribute("data-tag-val");
        const target = transcripts.find((t) => t.id === id);
        if (target) {
          target.tag = target.tag === val ? null : val;
          target.isPinned = !!target.tag;
          isDirty = true;
          updateFloatingWidget();
        }
      });
    });

    body.scrollTop = body.scrollHeight;
  }

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.innerText = text;
    return div.innerHTML;
  }

  function startObserver() {
    isRecordingActive = true;
    autoTurnOnCaptions();
    createFloatingWidget();
    updateFloatingWidget();

    // Loop auto caption check every 3s in case meeting controls load asynchronously
    if (!captionCheckInterval) {
      captionCheckInterval = setInterval(autoTurnOnCaptions, 3000);
    }

    const host = window.location.host;
    if (!observer) {
      observer = new MutationObserver(() => {
        if (host.includes("teams")) {
          extractTeams();
        } else if (host.includes("meet.google")) {
          extractGoogleMeet();
        } else if (host.includes("zoom.us")) {
          extractZoom();
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true
      });
    }

    if (!syncTimer) {
      syncTimer = setInterval(flushStorage, 1000);
    }

    const detectedTitle = detectMeetingTitle();
    const key = getMeetingKey();
    chrome.storage.local.set({
      [STORAGE_STATE_KEY]: {
        isRecording: true,
        platform: getPlatform(),
        meetingTitle: detectedTitle,
        currentMeetingKey: key,
        startTime: Date.now()
      }
    });

    saveCurrentSessionToHistory(false);
  }

  function stopObserver() {
    isRecordingActive = false;
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (syncTimer) {
      clearInterval(syncTimer);
      syncTimer = null;
    }
    if (captionCheckInterval) {
      clearInterval(captionCheckInterval);
      captionCheckInterval = null;
    }
    flushStorage();
    updateFloatingWidget();

    chrome.storage.local.get([STORAGE_STATE_KEY], (res) => {
      const state = res[STORAGE_STATE_KEY] || {};
      state.isRecording = false;
      chrome.storage.local.set({ [STORAGE_STATE_KEY]: state });
    });

    saveCurrentSessionToHistory(false);
  }

  function initSession() {
    if (!isActualMeetingRoom()) return;

    const key = getMeetingKey();
    currentMeetingId = key;
    currentMeetingTitle = detectMeetingTitle();

    createFloatingWidget();
    autoTurnOnCaptions();

    chrome.storage.local.get([STORAGE_STATE_KEY, STORAGE_SESSIONS_KEY, STORAGE_LOGS_KEY], (res) => {
      const state = res[STORAGE_STATE_KEY] || {};
      const sessions = res[STORAGE_SESSIONS_KEY] || {};

      if (state.currentMeetingKey !== key) {
        if (sessions[key] && sessions[key].logs) {
          transcripts = sessions[key].logs;
        } else {
          transcripts = [];
        }
        chrome.storage.local.set({
          [STORAGE_LOGS_KEY]: transcripts,
          [STORAGE_STATE_KEY]: {
            ...state,
            currentMeetingKey: key,
            meetingTitle: currentMeetingTitle,
            platform: getPlatform()
          }
        });
      } else {
        transcripts = res[STORAGE_LOGS_KEY] || [];
      }

      if (state.isRecording) {
        startObserver();
      } else {
        updateFloatingWidget();
      }
    });
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === "PING") {
      sendResponse({ status: "OK", platform: getPlatform(), title: detectMeetingTitle(), key: getMeetingKey() });
    } else if (msg.action === "START_RECORDING") {
      startObserver();
      sendResponse({ status: "RECORDING_STARTED", platform: getPlatform(), title: detectMeetingTitle() });
    } else if (msg.action === "STOP_RECORDING") {
      stopObserver();
      sendResponse({ status: "RECORDING_STOPPED" });
    } else if (msg.action === "GET_MEETING_TITLE") {
      sendResponse({ title: detectMeetingTitle(), key: getMeetingKey() });
    } else if (msg.action === "TRIGGER_AUTO_CC") {
      autoTurnOnCaptions();
      sendResponse({ status: "CC_TRIGGERED" });
    }
    return true;
  });

  initSession();

  // Watch URL changes for SPA navigation into a meeting room
  let lastNavUrl = window.location.href;
  const navCheckInterval = setInterval(() => {
    if (!isExtensionValid()) {
      clearInterval(navCheckInterval);
      stopAllIntervals();
      return;
    }
    if (window.location.href !== lastNavUrl) {
      lastNavUrl = window.location.href;
      if (isActualMeetingRoom() && !widgetContainer) {
        initSession();
      }
    }
  }, 1000);
})();
