// MeetScribe AI - Background Service Worker
// Handles cross-origin AI network requests to bypass browser page CORS restrictions

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "AI_CHAT_COMPLETION") {
    const { baseUrl, apiKey, model, messages, temperature } = request.payload || {};
    const cleanBase = (baseUrl || "http://localhost:2080/v1").replace(/\/+$/, "");
    const endpoint = cleanBase.endsWith("/chat/completions") ? cleanBase : `${cleanBase}/chat/completions`;

    const headers = {
      "Content-Type": "application/json",
      "Accept": "application/json"
    };
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    fetch(endpoint, {
      method: "POST",
      headers: headers,
      body: JSON.stringify({
        model: model,
        messages: messages,
        temperature: temperature !== undefined ? temperature : 0.3,
        stream: false
      })
    })
      .then(async (resp) => {
        const rawText = await resp.text();
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}: ${rawText.slice(0, 200)}`);
        }

        // Try standard JSON first
        try {
          const parsedJson = JSON.parse(rawText);
          return parsedJson;
        } catch (jsonErr) {
          // Provider forced SSE stream (data: {...})
          if (rawText.includes("data:")) {
            let assembledContent = "";
            const lines = rawText.split("\n");
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || trimmed === "data: [DONE]" || trimmed === "[DONE]") continue;
              if (trimmed.startsWith("data:")) {
                try {
                  const chunkJson = JSON.parse(trimmed.slice(5).trim());
                  const delta =
                    chunkJson.choices?.[0]?.delta?.content ||
                    chunkJson.choices?.[0]?.message?.content ||
                    chunkJson.content ||
                    "";
                  assembledContent += delta;
                } catch (e) {}
              }
            }
            if (assembledContent) {
              return {
                choices: [{ message: { content: assembledContent } }]
              };
            }
          }
          throw jsonErr;
        }
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
