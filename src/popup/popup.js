const out = document.getElementById("out");
const btnPing = document.getElementById("btnPing");

function print(obj) {
  out.textContent = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
}

btnPing.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "PING" }, (resp) => {
    if (chrome.runtime.lastError) {
      print({ ok: false, error: chrome.runtime.lastError.message });
      return;
    }
    print(resp);
  });
});

