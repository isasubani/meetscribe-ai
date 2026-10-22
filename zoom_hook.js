// MeetScribe AI - Zoom Web In-Page Hook (MAIN world)
// Intercepts Zoom Web Redux store and React fiber tree to extract realtime captions
(function () {
  if (window.__meetscribe_zoom_injected) return;
  window.__meetscribe_zoom_injected = true;

  function dispatchCaption(msgId, speaker, text) {
    if (!text || !text.trim()) return;
    document.documentElement.dispatchEvent(
      new CustomEvent("meetscribe-zoom-caption", {
        detail: {
          msgId: msgId || ("zm_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7)),
          speaker: speaker || "Participant",
          text: text.trim(),
          timestamp: Date.now()
        }
      })
    );
  }

  function dispatchTitle(title) {
    if (!title || !title.trim()) return;
    document.documentElement.dispatchEvent(
      new CustomEvent("meetscribe-zoom-title", {
        detail: { title: title.trim() }
      })
    );
  }

  const isReduxStore = (s) =>
    s &&
    typeof s === "object" &&
    typeof s.getState === "function" &&
    typeof s.subscribe === "function" &&
    typeof s.dispatch === "function";

  const hasTranscriptionState = (s) => {
    if (!isReduxStore(s)) return false;
    try {
      const state = s.getState();
      return state && typeof state === "object" && "newLiveTranscription" in state;
    } catch (e) {
      return false;
    }
  };

  const getReactContainer = (node) => {
    if (!node) return undefined;
    const key = Object.keys(node).find((k) => k.startsWith("__reactContainer"));
    return key ? node[key] : undefined;
  };

  function findStoreFromReactTree(rootDoc) {
    if (!rootDoc || !rootDoc.body) return null;
    const candidates = rootDoc.body.querySelectorAll(":scope > *, :scope > * > *, :scope > * > * > *");
    for (const el of candidates) {
      const fiber = getReactContainer(el);
      if (!fiber) continue;

      const stack = [fiber];
      let depth = 0;
      while (stack.length > 0 && depth < 5000) {
        const item = stack.pop();
        if (!item) break;
        depth++;
        const store = item.memoizedProps?.store;
        if (hasTranscriptionState(store)) {
          return store;
        }
        if (item.sibling) stack.push(item.sibling);
        if (item.child) stack.push(item.child);
      }
    }
    return null;
  }

  function subscribeZoomStore(store) {
    let lastState = null;

    function handleState(currState) {
      if (!currState) return;

      // Extract Meeting Topic
      const topic = currState.meeting?.meetingTopic;
      if (topic && topic !== lastState?.meeting?.meetingTopic) {
        dispatchTitle(topic);
      }

      // Extract Live Transcription messages
      const currMsgMap = currState.newLiveTranscription?.newLTMessage;
      const prevMsgMap = lastState?.newLiveTranscription?.newLTMessage;

      if (currMsgMap && currMsgMap !== prevMsgMap) {
        const attendees = currState.attendeesList?.attendeesList || [];
        const messages = Object.values(currMsgMap);

        for (const item of messages) {
          if (!item) continue;
          const msgId = item.msgId;
          const prevItem = prevMsgMap?.[msgId];

          // New or updated message
          if (!prevItem || prevItem.text !== item.text) {
            let speakerName = item.user?.displayName;
            if (!speakerName && item.user?.zoomID) {
              const att = attendees.find((a) => a.userId === item.user.zoomID || a.userGUID === item.user.zoomID);
              if (att?.displayName) speakerName = att.displayName;
            }
            dispatchCaption(msgId, speakerName || "Participant", item.text);
          }
        }
      }

      lastState = currState;
    }

    try {
      store.subscribe(() => {
        try {
          handleState(store.getState());
        } catch (e) {}
      });
      handleState(store.getState());
    } catch (e) {}
  }

  // Intercept Redux global if instantiated via window
  function hookGlobalRedux(reduxObj) {
    if (!reduxObj || reduxObj.__meetscribe_hooked__) return;
    Object.defineProperty(reduxObj, "__meetscribe_hooked__", { value: true, configurable: true });

    ["createStore", "legacy_createStore", "configureStore"].forEach((fnName) => {
      const orig = reduxObj[fnName];
      if (typeof orig === "function") {
        reduxObj[fnName] = function (...args) {
          const store = orig.apply(this, args);
          if (store && typeof store.subscribe === "function") {
            setTimeout(() => {
              if (hasTranscriptionState(store)) {
                subscribeZoomStore(store);
              }
            }, 500);
          }
          return store;
        };
      }
    });
  }

  if (window.Redux) hookGlobalRedux(window.Redux);
  if (window.RTK) hookGlobalRedux(window.RTK);

  // Monitor DOM for iframe or React root
  let activeStore = null;
  const pollTimer = setInterval(() => {
    if (activeStore) return;

    // Zoom PWA / Web Client iframe check
    const iframe = document.querySelector(".pwa-webclient__iframe-wrapper iframe, #pwa-webclient iframe");
    const targetDoc = iframe?.contentDocument || document;
    if (iframe?.contentWindow?.Redux) {
      hookGlobalRedux(iframe.contentWindow.Redux);
    }

    const store = findStoreFromReactTree(targetDoc);
    if (store) {
      activeStore = store;
      subscribeZoomStore(store);
      console.log("[MeetScribe] Zoom Web Redux store hooked via React fiber successfully.");
    }
  }, 1000);
})();
