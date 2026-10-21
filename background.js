// MeetScribe AI - Background Service Worker
// Handles cross-origin AI network requests and real-time streaming (SSE)

// Port connection for streaming real-time chunks (typewriter effect)
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "AI_STREAM_PORT") return;

  port.onMessage.addListener(async (request) => {
    const { baseUrl, apiKey, model, messages, temperature } = request.payload || {};
    const cleanBase = (baseUrl || "http://localhost:2080/v1").replace(/\/+$/, "");
    const endpoint = cleanBase.endsWith("/chat/completions") ? cleanBase : `${cleanBase}/chat/completions`;

    const headers = {
      "Content-Type": "application/json",
      "Accept": "text/event-stream, application/json"
    };
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    try {
      const resp = await fetch(endpoint, {
        method: "POST",
        headers: headers,
        body: JSON.stringify({
          model: model,
          messages: messages,
          temperature: temperature !== undefined ? temperature : 0.3,
          stream: true
        })
      });

      if (!resp.ok) {
        const errText = await resp.text();
        port.postMessage({ type: "error", error: `HTTP ${resp.status}: ${errText.slice(0, 200)}` });
        return;
      }

      // Check if body is a readable stream
      if (resp.body && typeof resp.body.getReader === "function") {
        const reader = resp.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || ""; // Keep incomplete line in buffer

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
                if (delta) {
                  port.postMessage({ type: "chunk", text: delta });
                }
              } catch (e) {
                // Ignore parse errors on partial chunks
              }
            } else if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
              // Non-SSE single JSON fallback
              try {
                const json = JSON.parse(trimmed);
                const content = json.choices?.[0]?.message?.content || "";
                if (content) {
                  port.postMessage({ type: "chunk", text: content });
                }
              } catch (e) {}
            }
          }
        }

        // Process any residual data in buffer
        if (buffer.trim()) {
          const trimmed = buffer.trim();
          if (trimmed.startsWith("data:") && trimmed !== "data: [DONE]") {
            try {
              const chunkJson = JSON.parse(trimmed.slice(5).trim());
              const delta = chunkJson.choices?.[0]?.delta?.content || "";
              if (delta) port.postMessage({ type: "chunk", text: delta });
            } catch (e) {}
          }
        }

        port.postMessage({ type: "done" });
      } else {
        // Fallback if reader not supported
        const data = await resp.json();
        const content = data.choices?.[0]?.message?.content || "Tidak ada respon.";
        port.postMessage({ type: "chunk", text: content });
        port.postMessage({ type: "done" });
      }
    } catch (err) {
      port.postMessage({ type: "error", error: err.message || "Gagal menghubungi AI router." });
    }
  });
});

// Fallback message listener for non-streaming calls
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
        try {
          return JSON.parse(rawText);
        } catch (jsonErr) {
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
              return { choices: [{ message: { content: assembledContent } }] };
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

    return true;
  }
});
