// MeetScribe AI - Popup Information Script
document.addEventListener("DOMContentLoaded", () => {
  const btnTriggerCc = document.getElementById("btn-trigger-cc");

  if (btnTriggerCc) {
    btnTriggerCc.addEventListener("click", () => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs || !tabs.length) return;
        chrome.tabs.sendMessage(tabs[0].id, { action: "TRIGGER_AUTO_CC" }, (res) => {
          if (chrome.runtime.lastError) {
            btnTriggerCc.innerText = "Buka tab meeting terlebih dahulu!";
            setTimeout(() => (btnTriggerCc.innerText = "💬 Nyalakan Captions (CC) Otomatis"), 2000);
          } else {
            btnTriggerCc.innerText = "✅ Captions Dinyalakan!";
            setTimeout(() => (btnTriggerCc.innerText = "💬 Nyalakan Captions (CC) Otomatis"), 2000);
          }
        });
      });
    });
  }
});
