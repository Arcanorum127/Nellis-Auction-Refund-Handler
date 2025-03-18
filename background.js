/* 
Name: Brice Blanchard
Date: 3/17/2025
Project: Nellis Auction Refund Handler
Version: 2.1
*/

// State constants
const STATE = {
    NOT_RUNNING: 'notRunning',
    RUNNING: 'running',
    PAUSED: 'paused',
    RETRYING: 'retrying'
};

// Track active tab information
let activeTabInfo = {
    tabId: null,
    url: null
};

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch(message.action) {
        case "contentScriptLoaded":
            // Store the sender tab information
            if (sender.tab) {
                activeTabInfo.tabId = sender.tab.id;
                activeTabInfo.url = sender.tab.url;
            }
            
            chrome.storage.local.set({
                extensionState: message.state,
                currentProgress: message.progress,
                lastActiveTabId: activeTabInfo.tabId
            });
            
            // Update icon based on state
            updateIconBasedOnState(message.state);
            break;
            
        case "progressUpdate":
            // Update badge with current progress
            updateBadge(message.progress.current, message.progress.total);
            
            // Store updated progress
            chrome.storage.local.set({
                currentProgress: message.progress
            });
            break;
            
        case "statisticsUpdate":
            // Update statistics in storage
            chrome.storage.local.set({
                statistics: message.summary
            });
            break;
            
        case "processingComplete":
            // Reset badge and show notification
            chrome.action.setBadgeText({ text: "" });
            
            // Show notification
            chrome.notifications.create({
                type: 'basic',
                iconUrl: 'icons/NA-RH-active-128x128.png',
                title: 'Refund Processing Complete',
                message: `Successfully processed ${message.statistics.successful} of ${message.statistics.totalProcessed} refunds.`,
                priority: 2
            });
            
            // Update extension state
            chrome.storage.local.set({
                extensionState: STATE.NOT_RUNNING
            });
            
            // Update icon
            updateIconBasedOnState(STATE.NOT_RUNNING);
            break;
            
        case "stateChanged":
            // Update icon based on new state
            updateIconBasedOnState(message.state);
            break;
    }
    
    return true; // Keep the message channel open for async response
});

// Monitor tab updates to detect navigation
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // Check if this is our active processing tab
    chrome.storage.local.get(['lastActiveTabId', 'extensionState'], function(result) {
        if (tabId === result.lastActiveTabId && changeInfo.status === 'complete') {
            console.log("Tab reloaded, checking if we need to restore processing");
            
            // If we were in retrying state, this might be the redirect completing
            if (result.extensionState === STATE.RETRYING) {
                console.log("Tab reloaded while in retrying state, notifying content script");
                
                // Try to notify content script that it should check recovery state
                setTimeout(() => {
                    chrome.tabs.sendMessage(tabId, {
                        action: "checkRecoveryState"
                    }, function(response) {
                        // Handle potential errors when content script isn't ready yet
                        if (chrome.runtime.lastError) {
                            console.log("Content script not ready yet, will retry");
                            // Retry after another delay
                            setTimeout(() => {
                                chrome.tabs.sendMessage(tabId, {
                                    action: "checkRecoveryState"
                                });
                            }, 1000);
                        }
                    });
                }, 500); // Small delay to ensure content script is loaded
            }
        }
    });
});

// Helper function to update badge with progress
function updateBadge(current, total) {
    const percent = Math.floor((current / total) * 100);
    chrome.action.setBadgeText({ text: `${percent}%` });
    chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });
}

// Helper function to update extension icon based on state
function updateIconBasedOnState(state) {
    let iconPath = {
        16: "icons/NA-RH-inactive-16x16.png",
        32: "icons/NA-RH-inactive-32x32.png",
        48: "icons/NA-RH-inactive-48x48.png",
        128: "icons/NA-RH-inactive-128x128.png"
    };
    
    if (state === STATE.RUNNING) {
        iconPath = {
            16: "icons/NA-RH-active-16x16.png",
            32: "icons/NA-RH-active-32x32.png",
            48: "icons/NA-RH-active-48x48.png",
            128: "icons/NA-RH-active-128x128.png"
        };
    } else if (state === STATE.PAUSED) {
        iconPath = {
            16: "icons/NA-RH-paused-16x16.png",
            32: "icons/NA-RH-paused-32x32.png",
            48: "icons/NA-RH-paused-48x48.png",
            128: "icons/NA-RH-paused-128x128.png"
        };
    } else if (state === STATE.RETRYING) {
        iconPath = {
            16: "icons/NA-RH-retry-16x16.png",
            32: "icons/NA-RH-retry-32x32.png",
            48: "icons/NA-RH-retry-48x48.png",
            128: "icons/NA-RH-retry-128x128.png"
        };
    }
    
    chrome.action.setIcon({ path: iconPath });
}

// When the extension is installed or updated
chrome.runtime.onInstalled.addListener(() => {
    // Set default values in storage
    chrome.storage.local.set({
        refundLimit: 500,
        refundsToProcess: 200,
        initialTimeout: 30000,
        retryTimeout: 10000,
        extendedTimeout: 20000,
        maxRetries: 3,
        extensionState: STATE.NOT_RUNNING,
        currentProgress: { current: 0, total: 0 },
        statistics: {
            startTime: null,
            endTime: null,
            totalProcessed: 0,
            successful: 0,
            skipped: 0,
            failed: 0,
            retryAttempts: 0,
            averageProcessingTime: 0,
            totalProcessingTime: 0
        }
    });
    
    // Initialize the extension with the popup
    chrome.action.setPopup({popup: "popup.html"});
    
    // Reset badge
    chrome.action.setBadgeText({ text: "" });
});