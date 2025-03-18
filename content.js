/*
Name: Brice Blanchard
Date: 3/17/2025
Project: Nellis Auction Refund Handler
Version: 3.0
*/

// Import all modules
import { STATE, Config } from './modules/constants.js';
import { Logger } from './modules/logger.js';
import { RefundProcessor } from './modules/refundProcessor.js';
import { NavigationManager } from './modules/navigationManager.js';
import { StatisticsManager } from './modules/statisticsManager.js';
import { ErrorHandler } from './modules/errorHandler.js';
import { StateManager } from './modules/stateManager.js';
import { HeartbeatMonitor } from './modules/heartbeatMonitor.js';

// Initialize logger
const logger = new Logger({
    logLevel: 'info',
    enableConsoleOutput: true,
    enableStorageOutput: true,
    maxLogEntries: 500
});

// Initialize configurations
let config = new Config();

// Core module instances
const stateManager = new StateManager(logger);
const statsManager = new StatisticsManager(logger);
const errorHandler = new ErrorHandler(logger, stateManager, statsManager);
const navigationManager = new NavigationManager(logger);
const heartbeatMonitor = new HeartbeatMonitor(logger, config, errorHandler);
const refundProcessor = new RefundProcessor(
    logger, 
    stateManager, 
    statsManager, 
    navigationManager, 
    errorHandler,
    heartbeatMonitor,
    config
);

// Listen for messages from popup and background
chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    logger.debug(`Received message: ${request.action}`);

    switch (request.action) {
        case "startRefundProcess":
            handleStartRefundProcess(request, sendResponse);
            break;

        case "pauseRefundProcess":
            handlePauseRefundProcess(sendResponse);
            break;

        case "resumeRefundProcess":
            handleResumeRefundProcess(sendResponse);
            break;

        case "stopRefundProcess":
            handleStopRefundProcess(sendResponse);
            break;

        case "getState":
            handleGetState(sendResponse);
            break;

        case "getStatistics":
            handleGetStatistics(sendResponse);
            break;

        case "checkRecoveryState":
            handleCheckRecoveryState(sendResponse);
            break;
            
        case "getLogs":
            handleGetLogs(sendResponse);
            break;
    }
    
    return true; // Keep the message channel open for async response
});

// Handler functions for message actions
async function handleStartRefundProcess(request, sendResponse) {
    // Update settings from popup
    config.refundLimit = request.refundLimit || 500;
    const refundsToProcess = request.refundsToProcess || 200;

    // Update configuration if provided
    if (request.config) {
        config.updateFromObject(request.config);
    }

    // Reset state and statistics
    stateManager.reset();
    statsManager.reset();
    
    // Start error monitoring and heartbeat
    errorHandler.startMonitoring();
    heartbeatMonitor.start();
    
    // Set state to running
    stateManager.setState(STATE.RUNNING);

    // Start the refund process
    refundProcessor.startProcessing(refundsToProcess);

    // Send success response
    sendResponse({ success: true });
    logger.info(`Started refund processing for ${refundsToProcess} refunds`);
}

function handlePauseRefundProcess(sendResponse) {
    stateManager.setPaused(true);
    stateManager.setState(STATE.PAUSED);
    
    // Clear any pending timeout
    refundProcessor.clearTimeout();
    
    logger.info("Refund processing paused");
    sendResponse({
        success: true,
        progress: refundProcessor.getProgress(),
        statistics: statsManager.getSummary()
    });
}

function handleResumeRefundProcess(sendResponse) {
    stateManager.setPaused(false);
    stateManager.setState(STATE.RUNNING);
    
    refundProcessor.resetTimeout();
    
    // Continue from where it left off
    if (refundProcessor.getCurrentIteration() < refundProcessor.getTotalRefunds()) {
        refundProcessor.continueProcessing();
    }
    
    logger.info("Refund processing resumed");
    sendResponse({
        success: true,
        progress: refundProcessor.getProgress(),
        statistics: statsManager.getSummary()
    });
}

function handleStopRefundProcess(sendResponse) {
    refundProcessor.stopProcessing();
    statsManager.updateStatistics('end');
    
    logger.info("Refund processing stopped");
    sendResponse({
        success: true,
        statistics: statsManager.getSummary()
    });
}

function handleGetState(sendResponse) {
    sendResponse({
        state: stateManager.getState(),
        progress: refundProcessor.getProgress(),
        statistics: statsManager.getSummary()
    });
}

function handleGetStatistics(sendResponse) {
    sendResponse({
        statistics: statsManager.getSummary()
    });
}

function handleGetLogs(sendResponse) {
    sendResponse({
        logs: logger.getRecentLogs()
    });
}

async function handleCheckRecoveryState(sendResponse) {
    logger.debug("Received recovery state check request");

    try {
        const result = await chrome.storage.local.get(['extensionState', 'recoveryTarget']);
        
        if (result.extensionState === STATE.RETRYING && result.recoveryTarget) {
            logger.info("Found recovery target, starting recovery process");

            // Start recovery with a short delay to ensure page is ready
            setTimeout(() => {
                // Set the local extension state from storage
                stateManager.setState(STATE.RUNNING);

                // Apply recovery target settings
                if (result.recoveryTarget.action === 'skip') {
                    refundProcessor.setCurrentIteration(result.recoveryTarget.iteration);
                    refundProcessor.setSkipCurrentRefund(false);
                    refundProcessor.setRetryCount(0);
                } else if (result.recoveryTarget.action === 'retry') {
                    refundProcessor.setCurrentIteration(result.recoveryTarget.iteration);
                    refundProcessor.setRetryCount(result.recoveryTarget.retryCount);
                }

                // Clear recovery target
                chrome.storage.local.remove(['recoveryTarget']);

                // Notify background script of state change
                chrome.runtime.sendMessage({
                    action: "stateChanged",
                    state: STATE.RUNNING
                });

                // Start processing again with appropriate timeout
                refundProcessor.resetTimeout();
                heartbeatMonitor.start();
                errorHandler.startMonitoring();
                refundProcessor.continueProcessing();
            }, 1000);
        }
    } catch (error) {
        logger.error(`Error checking recovery state: ${error.message}`);
    }

    // Send immediate response to prevent errors
    sendResponse({ acknowledged: true });
}

// Send initial state when content script loads
chrome.runtime.sendMessage({
    action: "contentScriptLoaded",
    state: stateManager.getState(),
    progress: refundProcessor.getProgress()
});

// Initialize recovery on script load
refundProcessor.initializeWithRecovery();