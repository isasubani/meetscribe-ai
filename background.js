// MeetScribe AI - Background Service Worker
// Handles cross-origin AI network requests to bypass browser page CORS restrictions

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "AI_CHAT_COMPLETION") {
    const { baseUrl, apiKey, model, messages, temperature } = request.payload || {};
    const cleanBase = (baseUrl || "http://localhost:2080/v1").replace(/\/+$/, "");
    const endpoint = cleanBase.endsWith("/chat/completions") ? cleanBase : `${cleanBase}/chat/completions`;

    const headers = { "Content-Type": "application/json" };
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    fetch(endpoint, {
      method: "POST",
      headers: headers,
      body: JSON.stringify({
        model: model,
        messages: messages,
        temperature: temperature !== undefined ? temperature : 0.3
      })
    })
      .then(async (resp) => {
        if (!resp.ok) {
          const errText = await resp.text();
          throw new Error(`HTTP ${resp.status}: ${errText.slice(0, 200)}`);
        }
        return resp.json();
      })
      .then((data) => {
        sendResponse({ success: true, data: data });
      })
      .catch((err) => {
        sendResponse({ success: false, error: err.message });
      });

    return true; // Keep message channel open for async response
  }
});
