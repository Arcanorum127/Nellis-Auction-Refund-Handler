document.addEventListener('DOMContentLoaded', function() {
    // Elements
    const startButton = document.getElementById('start-button');
    const pauseButton = document.getElementById('pause-button');
    const resumeButton = document.getElementById('resume-button');
    const stopButton = document.getElementById('stop-button');
    const statusText = document.getElementById('status-text');
    const statusIndicator = document.getElementById('status-indicator');
    const progressInfo = document.getElementById('progress-info');
    const statisticsContainer = document.getElementById('statistics-container');
    
    // Statistics elements
    const statProcessed = document.getElementById('stat-processed');
    const statSuccessful = document.getElementById('stat-successful');
    const statSkipped = document.getElementById('stat-skipped');
    const statFailed = document.getElementById('stat-failed');
    const statAvgTime = document.getElementById('stat-avg-time');
    const statRunningTime = document.getElementById('stat-running-time');
    
    // Set default date values (today and a week from today)
    const today = new Date();
    const nextWeek = new Date();
    nextWeek.setDate(today.getDate() + 7);
    
    document.getElementById('start-date').valueAsDate = today;
    document.getElementById('end-date').valueAsDate = nextWeek;
    
    // Add event listeners to buttons
    startButton.addEventListener('click', startProcessing);
    pauseButton.addEventListener('click', pauseProcessing);
    resumeButton.addEventListener('click', resumeProcessing);
    stopButton.addEventListener('click', stopProcessing);
    
    // Load settings and update UI based on current state
    loadSettingsAndUpdateUI();
    
    // Check if extension is running and update UI
    checkExtensionState();
    
    // Set up periodic refresh for statistics (every 5 seconds)
    const statsRefreshInterval = setInterval(refreshStatistics, 5000);
    
    // Clear interval when popup closes
    window.addEventListener('unload', () => {
        clearInterval(statsRefreshInterval);
    });
});

function loadSettingsAndUpdateUI() {
    chrome.storage.local.get(['refundLimit', 'refundsToProcess', 'startDate', 'endDate', 'extensionState', 'currentProgress', 'statistics', 'recoveryTarget'], function(data) {
        // Load saved settings
        if (data.refundLimit) {
            document.getElementById('refund-limit').value = data.refundLimit;
        }
        if (data.refundsToProcess) {
            document.getElementById('refunds-to-process').value = data.refundsToProcess;
        }
        if (data.startDate) {
            document.getElementById('start-date').value = data.startDate;
        }
        if (data.endDate) {
            document.getElementById('end-date').value = data.endDate;
        }
        
        // Update UI based on extension state, handling retrying state specially
        updateUIState(data.extensionState || 'notRunning', data.currentProgress, data.recoveryTarget);
        
        // Update statistics if available
        if (data.statistics) {
            updateStatisticsDisplay(data.statistics);
        }
    });
}

function refreshStatistics() {
    chrome.storage.local.get(['statistics', 'extensionState', 'currentProgress', 'recoveryTarget'], function(data) {
        if (data.statistics) {
            updateStatisticsDisplay(data.statistics);
        }
        
        // Also refresh the state in case it changed
        if (data.extensionState) {
            updateUIState(data.extensionState, data.currentProgress, data.recoveryTarget, true); // Only update state, not progress
        }
    });
}

function updateStatisticsDisplay(statistics) {
    const statisticsContainer = document.getElementById('statistics-container');
    
    // Only show statistics if there's data to display
    if (statistics.totalProcessed > 0 || statistics.startTime) {
        statisticsContainer.classList.remove('hidden');
        
        // Update statistics values
        document.getElementById('stat-processed').textContent = statistics.totalProcessed || 0;
        document.getElementById('stat-successful').textContent = statistics.successful || 0;
        document.getElementById('stat-skipped').textContent = statistics.skipped || 0;
        document.getElementById('stat-failed').textContent = statistics.failed || 0;
        
        // Format average processing time in seconds
        const avgTimeInSeconds = statistics.averageProcessingTime ? (statistics.averageProcessingTime / 1000).toFixed(1) : 0;
        document.getElementById('stat-avg-time').textContent = `${avgTimeInSeconds}s`;
        
        // Calculate and format running time
        let runningTimeMs = 0;
        if (statistics.startTime) {
            const endTime = statistics.endTime || Date.now();
            runningTimeMs = endTime - statistics.startTime;
        }
        
        document.getElementById('stat-running-time').textContent = formatDuration(runningTimeMs);
    } else {
        statisticsContainer.classList.add('hidden');
    }
}

function formatDuration(ms) {
    if (!ms) return '0s';
    
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
        return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
        return `${minutes}m ${seconds % 60}s`;
    } else {
        return `${seconds}s`;
    }
}

function checkExtensionState() {
    // Query active tab to check if the extension is running
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        if (tabs.length > 0) {
            chrome.tabs.sendMessage(tabs[0].id, {
                action: "getState"
            }, function(response) {
                if (chrome.runtime.lastError) {
                    // If content script isn't available, check storage for state
                    // This is crucial for handling retrying state during page navigation
                    chrome.storage.local.get(['extensionState', 'currentProgress', 'recoveryTarget'], function(data) {
                        if (data.extensionState === 'retrying') {
                            // Show recovery in progress UI during page navigation
                            updateUIState('retrying', data.currentProgress, data.recoveryTarget);
                            showStatusMessage("Recovery in progress. Navigating to refund page...", "warning");
                        } else if (data.extensionState === 'running' || data.extensionState === 'paused') {
                            updateUIState(data.extensionState, data.currentProgress);
                            showStatusMessage("Connected to Nellis Auction site. Waiting for page to load...", "warning");
                        } else {
                            updateUIState('notRunning');
                            showStatusMessage("Not connected to Nellis Auction site. Navigate to the site first.", "warning");
                        }
                    });
                } else if (response) {
                    // Update UI based on response from content script
                    updateUIState(response.state, response.progress);
                    
                    // Update statistics if available
                    if (response.statistics) {
                        updateStatisticsDisplay(response.statistics);
                    }
                }
            });
        }
    });
}

function updateUIState(state, progress, recoveryTarget, stateOnly = false) {
    const startButton = document.getElementById('start-button');
    const pauseButton = document.getElementById('pause-button');
    const resumeButton = document.getElementById('resume-button');
    const stopButton = document.getElementById('stop-button');
    const statusText = document.getElementById('status-text');
    const statusIndicator = document.getElementById('status-indicator');
    const progressInfo = document.getElementById('progress-info');
    
    // Hide all buttons first
    startButton.style.display = 'none';
    pauseButton.style.display = 'none';
    resumeButton.style.display = 'none';
    stopButton.style.display = 'none';
    
    // Disable form inputs when running, paused or retrying
    const formInputs = document.querySelectorAll('input[type="number"], input[type="date"]');
    formInputs.forEach(input => {
        input.disabled = state === 'running' || state === 'paused' || state === 'retrying';
    });
    
    // Update UI based on state
    switch(state) {
        case 'running':
            statusText.textContent = 'Running';
            statusIndicator.className = 'running';
            pauseButton.style.display = 'block';
            stopButton.style.display = 'block';
            if (progress && !stateOnly) {
                progressInfo.textContent = `Processing refund ${progress.current} of ${progress.total}`;
                progressInfo.className = ''; // Clear any message styling
            }
            break;
            
        case 'paused':
            statusText.textContent = 'Paused';
            statusIndicator.className = 'paused';
            resumeButton.style.display = 'block';
            stopButton.style.display = 'block';
            if (progress && !stateOnly) {
                progressInfo.textContent = `Paused at refund ${progress.current} of ${progress.total}`;
                progressInfo.className = ''; // Clear any message styling
            }
            break;
            
        case 'retrying':
            statusText.textContent = 'Retrying';
            statusIndicator.className = 'retrying';
            // Important: Show the stop button during retrying
            stopButton.style.display = 'block';
            
            if (progress && !stateOnly) {
                // Display different message based on recoveryTarget
                if (recoveryTarget && recoveryTarget.action === 'skip') {
                    progressInfo.textContent = `Skipping problematic refund ${progress.current}...`;
                } else if (recoveryTarget && recoveryTarget.action === 'retry') {
                    progressInfo.textContent = `Retrying refund ${progress.current} of ${progress.total} (attempt ${recoveryTarget.retryCount || 1})`;
                } else {
                    progressInfo.textContent = `Retrying refund ${progress.current} of ${progress.total}`;
                }
                progressInfo.className = 'warning';
            } else if (!stateOnly) {
                progressInfo.textContent = 'Attempting to recover from error...';
                progressInfo.className = 'warning';
            }
            break;
            
        case 'notRunning':
        default:
            statusText.textContent = 'Not Running';
            statusIndicator.className = 'not-running';
            startButton.style.display = 'block';
            if (!stateOnly) {
                progressInfo.textContent = '';
                progressInfo.className = ''; // Clear any message styling
            }
            break;
    }
}

function startProcessing() {
    // Get values from form
    const startDate = document.getElementById('start-date').value;
    const endDate = document.getElementById('end-date').value;
    const refundLimitInput = document.getElementById('refund-limit').value;
    const refundsToProcessInput = document.getElementById('refunds-to-process').value;
    
    // Set default values if not provided
    const refundLimit = refundLimitInput ? parseInt(refundLimitInput) : 500;
    const refundsToProcess = refundsToProcessInput ? parseInt(refundsToProcessInput) : 200;
    
    // Get advanced config from storage
    chrome.storage.local.get(['initialTimeout', 'retryTimeout', 'extendedTimeout', 'maxRetries'], function(config) {
        // Save settings
        chrome.storage.local.set({
            refundLimit: refundLimit,
            refundsToProcess: refundsToProcess,
            startDate: startDate,
            endDate: endDate,
            extensionState: 'running',
            currentProgress: { current: 0, total: refundsToProcess },
            // Clear any recovery target that might be lingering
            recoveryTarget: null
        });
        
        // Send message to content script
        chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
            if (tabs.length > 0) {
                chrome.tabs.sendMessage(tabs[0].id, {
                    action: "startRefundProcess",
                    refundLimit: refundLimit,
                    refundsToProcess: refundsToProcess,
                    startDate: startDate,
                    endDate: endDate,
                    // Pass advanced configuration
                    config: {
                        initialTimeout: config.initialTimeout || 30000,
                        retryTimeout: config.retryTimeout || 10000,
                        extendedTimeout: config.extendedTimeout || 20000,
                        maxRetries: config.maxRetries || 3
                    }
                }, function(response) {
                    if (chrome.runtime.lastError) {
                        updateUIState('notRunning');
                        showStatusMessage("Page not ready. Please navigate to Nellis Auction site first.", "error");
                    } else if (response && response.success) {
                        updateUIState('running', { current: 0, total: refundsToProcess });
                        showStatusMessage("Refund processing started!", "success");
                        
                        // Clear previous statistics
                        chrome.storage.local.get(['statistics'], function(data) {
                            // Reset statistics for new run
                            const newStatistics = {
                                startTime: Date.now(),
                                endTime: null,
                                totalProcessed: 0,
                                successful: 0,
                                skipped: 0,
                                failed: 0,
                                retryAttempts: 0,
                                averageProcessingTime: 0,
                                totalProcessingTime: 0,
                                refundDetails: []
                            };
                            
                            chrome.storage.local.set({ statistics: newStatistics });
                            updateStatisticsDisplay(newStatistics);
                        });
                    } else {
                        updateUIState('notRunning');
                        showStatusMessage("Failed to start. Try again.", "error");
                    }
                });
            }
        });
    });
}

function pauseProcessing() {
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        if (tabs.length > 0) {
            chrome.tabs.sendMessage(tabs[0].id, {
                action: "pauseRefundProcess"
            }, function(response) {
                if (chrome.runtime.lastError) {
                    // If connection error, still update local state
                    chrome.storage.local.set({ extensionState: 'paused' });
                    updateUIState('paused');
                    showStatusMessage("Processing paused (connection error)", "warning");
                } else if (response && response.success) {
                    chrome.storage.local.set({ extensionState: 'paused' });
                    updateUIState('paused', response.progress);
                    showStatusMessage("Processing paused", "success");
                    
                    // Update statistics
                    if (response.statistics) {
                        updateStatisticsDisplay(response.statistics);
                    }
                } else {
                    showStatusMessage("Failed to pause processing", "error");
                }
            });
        }
    });
}

function resumeProcessing() {
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        if (tabs.length > 0) {
            chrome.tabs.sendMessage(tabs[0].id, {
                action: "resumeRefundProcess"
            }, function(response) {
                if (chrome.runtime.lastError) {
                    showStatusMessage("Cannot resume: page is navigating or loading. Try again in a moment.", "error");
                } else if (response && response.success) {
                    chrome.storage.local.set({ extensionState: 'running' });
                    updateUIState('running', response.progress);
                    showStatusMessage("Processing resumed", "success");
                    
                    // Update statistics
                    if (response.statistics) {
                        updateStatisticsDisplay(response.statistics);
                    }
                } else {
                    showStatusMessage("Failed to resume processing", "error");
                }
            });
        }
    });
}

function stopProcessing() {
    // Show confirmation dialog
    if (confirm("Are you sure you want to stop processing? Progress cannot be resumed from this point.")) {
        // First update local state immediately
        chrome.storage.local.set({ 
            extensionState: 'notRunning',
            currentProgress: null,
            recoveryTarget: null
        });
        
        // Update UI immediately for better user feedback
        updateUIState('notRunning');
        showStatusMessage("Processing stopped", "success");
        
        // Then try to notify content script if it's available
        chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
            if (tabs.length > 0) {
                chrome.tabs.sendMessage(tabs[0].id, {
                    action: "stopRefundProcess"
                }, function(response) {
                    // If we can't reach content script, that's fine, we already updated local state
                    if (!chrome.runtime.lastError && response && response.statistics) {
                        // Update final statistics if available
                        updateStatisticsDisplay(response.statistics);
                    }
                });
            }
        });
    }
}

function showStatusMessage(message, type) {
    const progressInfo = document.getElementById('progress-info');
    progressInfo.textContent = message;
    progressInfo.className = type;
    
    // Clear message after a few seconds for success messages
    if (type === 'success') {
        setTimeout(() => {
            if (progressInfo.className === type) {
                progressInfo.className = '';
            }
        }, 3000);
    }
}