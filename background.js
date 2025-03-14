/* 
Name: Brice Blanchard
Date: 3/13/2025
Project: Nellis Auction Refund Handler
Version: 1.6
*/

// Global state to track if the extension is running
let isRunning = false;

// Listener for when the extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
    if (tab.id) {
        // Toggle the running state
        isRunning = !isRunning;

        // Update the icon to indicate state
        // Update the icon to indicate state
        chrome.action.setIcon({
            path: isRunning ? {
                "16": "icons/NA-RH-active-16x16.png",
                "32": "icons/NA-RH-active-32x32.png",
                "48": "icons/NA-RH-active-48x48.png",
                "128": "icons/NA-RH-active-128x128.png"
            } : {
                "16": "icons/NA-RH-inactive-16x16.png",
                "32": "icons/NA-RH-inactive-32x32.png",
                "48": "icons/NA-RH-inactive-48x48.png",
                "128": "icons/NA-RH-inactive-128x128.png"
            }
        });

        // Send message to content script to start or stop
        chrome.tabs.sendMessage(tab.id, { action: isRunning ? "start" : "stop" }, (response) => {
            if (chrome.runtime.lastError) {
                // If content script is not yet loaded, inject it first
                chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    files: ["content.js"]
                }).then(() => {
                    // Wait for content script to initialize and then send message
                    setTimeout(() => {
                        chrome.tabs.sendMessage(tab.id, { action: isRunning ? "start" : "stop" });
                    }, 100);
                });
            }
        });
    }
});

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.status === "completed" || message.status === "error") {
        isRunning = false;
        chrome.action.setIcon({
            path: {
                "16": "icons/NA-ReturnsHandler-icon16x16.png",
                "32": "icons/NA-ReturnsHandler-icon32x32.png",
                "48": "icons/NA-ReturnsHandler-icon48x48.png",
                "128": "icons/NA-ReturnsHandler-icon128x128.png"
            }
        });
    }
    sendResponse({ received: true });
    return true;
});