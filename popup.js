// popup.js

// DOM elements
const enableToggle = document.getElementById('enableToggle');
const thresholdRange = document.getElementById('thresholdRange');
const thresholdValueLabel = document.getElementById('thVal');
const logsList = document.getElementById('logsList');
const emailInput = document.getElementById('emailInput');
const sendBtn = document.getElementById('sendBtn');

emailjs.init('RksRmtsXiTIlaqfGN');

// Load the current settings to initialize the UI
chrome.storage.local.get(['enabled', 'threshold', 'logs'], data => {
  // Set the Enable checkbox
  const isEnabled = data.enabled !== undefined ? data.enabled : true;
  enableToggle.checked = isEnabled;
  // Set the threshold slider and label
  let thresh = data.threshold !== undefined ? data.threshold : 0.8;
  thresholdRange.value = thresh;
  thresholdValueLabel.textContent = thresh.toFixed(1);
  // Populate the logs list
  const logs = data.logs || [];
  displayLogs(logs);
});

// Update logs display in the popup
function displayLogs(logs) {
  logsList.innerHTML = "";
  if (logs.length === 0) {
    logsList.innerHTML = "<p><em>No content blocked yet.</em></p>";
    return;
  }
  // Show the most recent 10 logs (for brevity)
  const recentLogs = logs.slice(-10).reverse();  // take last 10, reverse to show newest first
  for (let entry of recentLogs) {
    const p = document.createElement('p');
    const textSnippet = entry.text.length > 100 ? entry.text.substring(0,100) + "..." : entry.text;
    const urlHost = (new URL(entry.url)).hostname.replace('www.','');
    p.innerHTML = `<span class="url">${urlHost}</span>: ${textSnippet}`;
    logsList.appendChild(p);
  }
}

// Event: Enable/Disable toggle
enableToggle.addEventListener('change', () => {
  const newVal = enableToggle.checked;
  chrome.storage.local.set({ enabled: newVal });
  // We also optionally can send a message to content scripts to take action immediately.
  // But since content scripts listen to storage changes, they'll handle it.
});

// Event: Threshold slider change
thresholdRange.addEventListener('input', () => {
  const val = parseFloat(thresholdRange.value);
  thresholdValueLabel.textContent = val.toFixed(1);
});
thresholdRange.addEventListener('change', () => {
  const val = parseFloat(thresholdRange.value);
  chrome.storage.local.set({ threshold: val });
  // The content script will pick up the new threshold from storage (onChanged).
});

// Event: Send Logs button
sendBtn.addEventListener('click', () => {
  const email = emailInput.value.trim();
  if (!email) {
    alert("Please enter an email address.");
    return;
  }
  // Get the current logs and send via EmailJS
  chrome.storage.local.get(['logs'], data => {
    const logs = data.logs || [];
    if (logs.length === 0) {
      alert("No logs to send.");
      return;
    }
    // Prepare email parameters
    const logTexts = logs.map(entry => {
      return `- [${entry.time}] ${entry.url} : "${entry.text}"`;
    }).join("\n");
    const templateParams = {
      user_email: email,
      logs: logTexts
    };
    // Use EmailJS send (replace YOUR_SERVICE_ID and YOUR_TEMPLATE_ID with actual IDs from EmailJS)
    emailjs.send('service_t82q8x5', 'template_b439knr', templateParams)
      .then(response => {
        console.log("Email sent successfully!", response.status, response.text);
        alert("Logs sent to your email!");
      }, error => {
        console.error("Email sending failed...", error);
        alert("Failed to send email. See console for error.");
      });
  });
});
