/* 
Name: Brice Blanchard
Date: 1/12/2025
Project: Nellis Auction Refund Handler
Version: 1.9
*/

// Listener for when the extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
    if (tab.id) {
      // Inject the content script into the active tab
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"]
      });
    }
  });