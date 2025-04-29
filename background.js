// background.js (runs as a service worker in MV3)
chrome.runtime.onInstalled.addListener(() => {
    // Set up default settings on installation
    chrome.storage.local.set({
      enabled: true,          // extension is enabled by default
      threshold: 0.8,         // default toxicity threshold (0.8 = strict, blocks content with >=80% toxicity confidence)
      logs: []                // initialize an empty array for blocked content logs
    });
    console.log("HateBlock installed: default settings initialized");
  });
  
  // (Optional) Listen for messages (if any) from content or popup scripts
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "getLogs") {
      // Example: handle a request to get logs (though popup can directly use storage, this is not strictly needed)
      chrome.storage.local.get(["logs"], (data) => {
        sendResponse(data.logs || []);
      });
      return true; // indicate we'll respond asynchronously
    }
    // Additional message handlers could be implemented as needed
  });
  