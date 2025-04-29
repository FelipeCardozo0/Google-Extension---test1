// content.js

// ===== 1. Configuration and Setup =====

// List of hate speech keywords for quick detection (case-insensitive).
// These are examples; a real list should be more comprehensive.
const HATE_KEYWORDS = [
    "hate", "kill", "stupid", "idiot", "dumb", "ugly", 
    "fag", "nigger", "racist", "bigot", "homophobe", 
    "moron", "terrorist", "scum"
  ];
  // Note: The list can include slurs and offensive words in various forms. 
  // For demonstration, we've included a few common insults and slurs. 
  // In practice, you might use a curated list from a hate speech dataset or service.
  
  let enabled = true;      // extension enabled state
  let toxicityThreshold = 0.8;  // default threshold for ML model decisions (0.8 = 80%)
  let toxicityModel = null;     // TensorFlow.js toxicity model instance
  
  // Load user settings from chrome.storage (enabled flag and threshold).
  chrome.storage.local.get(["enabled", "threshold"], (data) => {
    if (data.enabled !== undefined) enabled = data.enabled;
    if (data.threshold !== undefined) toxicityThreshold = data.threshold;
    if (!enabled) {
      console.log("HateBlock is currently disabled on this page.");
      return; // if extension is disabled, do nothing.
    }
    // If enabled, proceed to load the ML model asynchronously.
    loadToxicityModel();
  });
  
  // Listen for changes to enabled/threshold settings (e.g., user toggles in popup).
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local") {
      if (changes.enabled) {
        enabled = changes.enabled.newValue;
        if (!enabled) {
          // If extension got disabled, we stop observing and leave any currently blurred content as-is.
          // (User can refresh page to restore content if needed.)
          mutationObserver.disconnect();
          console.log("HateBlock disabled: stopped monitoring this page.");
        } else {
          // If enabled was turned on, we (re)start scanning.
          console.log("HateBlock enabled: scanning page content.");
          startMonitoring();  // re-enable observer
          scanDocument();     // scan entire page immediately
        }
      }
      if (changes.threshold) {
        toxicityThreshold = changes.threshold.newValue;
        console.log("HateBlock: toxicity threshold set to", toxicityThreshold);
        // If model is already loaded, we don't necessarily reload it with a new threshold.
        // We'll apply the threshold logic in our classification results instead.
      }
    }
  });
  
  // ===== 2. Loading the TensorFlow.js Toxicity Model =====
  
  // Function to load the TensorFlow.js toxicity model.
  function loadToxicityModel() {
    if (typeof toxicity === "undefined" || typeof tf === "undefined") {
      console.warn("Toxicity model or TensorFlow.js not found.");
      return;
    }
  
    // ✅ Set and initialize the CPU backend before loading model
    tf.setBackend('cpu').then(() => {
      tf.ready().then(() => {
        const thresholds = 0.5;
        toxicity.load(thresholds).then(model => {
          toxicityModel = model;
          console.log("Toxicity model loaded.");
          scanDocument();
          startMonitoring();
        }).catch(err => {
          console.error("Failed to load toxicity model:", err);
        });
      });
    });
  }
  
  
  // ===== 3. Content Scanning and Blocking Functions =====
  
  // Utility: Check if a string contains any hate keyword (case-insensitive).
  function containsHateKeyword(text) {
    if (!text) return false;
    const lowerText = text.toLowerCase();
    return HATE_KEYWORDS.some(word => lowerText.includes(word));
  }
  
  // Function to mark an element or text node as blocked: blur/hide it and label it.
  function blockContentElement(element, textContent) {
    if (!element) return;
    // Apply blur class (defined in style.css) to hide the content
    element.classList.add("hateblock-blurred");
    // Append a label after the element indicating it's blocked
    const label = document.createElement("span");
    label.className = "hateblock-label";
    label.textContent = " [Blocked by HateBlock]";
    // Insert the label right after the element in the DOM
    if (element.parentNode) {
      element.parentNode.insertBefore(label, element.nextSibling);
    }
    // Log the blocked content (save text snippet, URL, and timestamp to storage)
    logBlockedContent(textContent);
  }
  
  // Logging function: store blocked content info in chrome.storage
  function logBlockedContent(text) {
    const entry = {
      text: text,
      url: location.href,
      time: new Date().toISOString()
    };
    chrome.storage.local.get({ logs: [] }, data => {
      const logs = data.logs;
      logs.push(entry);
      // If we want to cap logs size, we could pop oldest here (not implemented for simplicity)
      chrome.storage.local.set({ logs: logs });
    });
  }
  
  // Main function to assess a given text for toxicity and block if needed.
  function analyzeText(nodeOrText, containerElement = null) {
    let text = "";
    if (typeof nodeOrText === "string") {
      text = nodeOrText;
    } else if (nodeOrText.nodeType === Node.TEXT_NODE) {
      text = nodeOrText.nodeValue;
    } else if (nodeOrText.nodeType === Node.ELEMENT_NODE) {
      text = nodeOrText.innerText || nodeOrText.textContent;
    }
    if (!text || text.trim() === "") return;  // skip empty text
    // Quick keyword check:
    if (containsHateKeyword(text)) {
      // If a hate keyword is found, we immediately block this content.
      const targetElem = containerElement || (nodeOrText.nodeType === Node.ELEMENT_NODE ? nodeOrText : null);
      blockContentElement(targetElem, text);
      return;
    }
    // If no keyword triggered and model is available, use the ML model for classification.
    if (toxicityModel) {
      toxicityModel.classify([text]).then(predictions => {
        /* The model returns an array of prediction objects, e.g.:
           predictions = [
             { label: "identity_attack", results: [ { probabilities: [p0, p1], match: ... } ] },
             { label: "insult", ... },
             ...,
             { label: "toxicity", ... }
           ]
        */
        let toxic = false;
        let maxProb = 0;
        // Determine if any toxicity category exceeds the threshold.
        predictions.forEach(pred => {
          const prob = pred.results[0].probabilities[1];  // probability that the text is in this category (toxic)
          if (prob > maxProb) maxProb = prob;
          if (prob >= toxicityThreshold) {
            toxic = true;
          }
        });
        if (toxic) {
          const targetElem = containerElement || (nodeOrText.nodeType === Node.ELEMENT_NODE ? nodeOrText : null);
          blockContentElement(targetElem, text);
        }
        // (If not toxic, do nothing, leave the content visible)
        // Optionally, we could mark it as processed to avoid re-checking if DOM changes but content stays same.
      }).catch(err => {
        console.error("Toxicity classification error:", err);
      });
    }
    // If model is not loaded yet, we could queue this text to analyze once the model is ready.
    // For simplicity, this implementation relies on initial scan after model loads.
  }
  
  // Function to find an appropriate container element for a text node to block.
  // We want to block a whole post/comment rather than just a part of it if possible.
  function getContainerElementForNode(textNode) {
    let el = textNode.parentElement;
    if (!el) return null;
    // Climb up to find a suitable container (stop at body or if container becomes too large)
    while (el && el !== document.body && el.textContent && el.textContent.length < 500) {
      // If the parent element is reasonably sized (text length < 500 chars), consider climbing up
      const parent = el.parentElement;
      if (!parent || parent === document.body) break;
      // If parent contains significantly more text than the element itself, stop (don't climb further)
      if (parent.textContent && parent.textContent.length > el.textContent.length * 1.5) {
        // Parent has much more content (likely contains other sections), so current el is a good container
        break;
      }
      el = parent;
    }
    return el;
  }
  
  // Scan the entire document (or a given root element) for text to analyze.
  function scanDocument(rootElement) {
    const root = rootElement || document.body;
    if (!root) return;
    // Use TreeWalker to iterate through text nodes
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
    const processedElements = new Set();
    let node;
    while ((node = walker.nextNode())) {
      const text = node.nodeValue;
      if (!text || !text.trim()) continue;  // skip empty or whitespace text
      // If this text node is inside an element we've already processed, skip it
      if (node.parentElement && processedElements.has(node.parentElement)) {
        continue;
      }
      // Determine the container to analyze and potentially block
      let container = getContainerElementForNode(node);
      let target = node;
      let analysisText = text;
      if (container) {
        // Use the container element's full text for analysis (for better context)
        target = container;
        analysisText = container.innerText || container.textContent;
        processedElements.add(container);
      }
      analyzeText(analysisText, container);
    }
  }
  
  // ===== 4. Dynamic Content Monitoring (MutationObserver) =====
  
  let mutationObserver;
  function startMonitoring() {
    if (!enabled) return;
    mutationObserver = new MutationObserver(mutations => {
      for (const mut of mutations) {
        // Handle added nodes (new content inserted)
        for (const node of mut.addedNodes) {
          if (node.nodeType === Node.TEXT_NODE) {
            // Direct text node added (rare, usually text comes inside an element)
            analyzeText(node, node.parentElement);
          } else if (node.nodeType === Node.ELEMENT_NODE) {
            // If an element is added, scan its subtree for any text content
            scanDocument(node);
          }
        }
        // (We could also handle mut.type === 'characterData' for text changes)
        if (mut.type === "characterData" && mut.target.nodeType === Node.TEXT_NODE) {
          // Text content of a node changed (possibly an edit or new content in existing node)
          analyzeText(mut.target, mut.target.parentElement);
        }
      }
    });
    mutationObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
  }
  
  // If the model is not loaded yet, we'll wait for it to call scanDocument() after loading.
  // If the model is already loaded (or if using only keywords), we can do an initial scan immediately.
  if (!toxicityModel) {
    // If model loading is in progress (async), initial scan will be done after model is ready to include ML results.
    // We could perform a keyword-only scan here in the meantime, but for simplicity, we rely on scan after model loads.
  } else {
    // Model was already available (could happen if we pre-loaded it), so scan and start observer
    scanDocument();
    startMonitoring();
  }
  