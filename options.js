/* 
Name: Brice Blanchard
Date: 3/17/2025
Project: Nellis Auction Refund Handler
Version: 2.0
*/

// Default configuration
const DEFAULT_CONFIG = {
    initialTimeout: 30000,       // 30 seconds for initial timeout
    retryTimeout: 10000,         // 10 seconds for first retry
    extendedTimeout: 20000,      // 20 seconds for extended retry
    maxRetries: 3,               // Maximum retry attempts per refund
    heartbeatInterval: 5000      // Check every 5 seconds if processing is still active
};

// Global variables
let chartInstance = null;
let allTimeStats = {
    totalProcessed: 0,
    successful: 0,
    skipped: 0, 
    failed: 0,
    totalRetries: 0,
    totalRuntime: 0,
    avgProcessingTime: 0,
    sessions: []  // Store data for individual processing sessions
};

// Initialize the page
document.addEventListener('DOMContentLoaded', function() {
    // Load saved settings
    loadSettings();
    
    // Load statistics
    loadStatistics();
    
    // Set up event listeners
    document.getElementById('save').addEventListener('click', saveSettings);
    document.getElementById('reset').addEventListener('click', resetToDefaults);
    document.getElementById('clearStats').addEventListener('click', clearStatistics);
    
    // Initialize tooltips
    initializeTooltips();
});

// Load saved settings from storage
function loadSettings() {
    chrome.storage.local.get([
        'initialTimeout', 
        'retryTimeout', 
        'extendedTimeout', 
        'maxRetries',
        'heartbeatInterval'
    ], function(items) {
        // Set input values from storage or use defaults
        document.getElementById('initialTimeout').value = 
            items.initialTimeout || DEFAULT_CONFIG.initialTimeout;
        document.getElementById('retryTimeout').value = 
            items.retryTimeout || DEFAULT_CONFIG.retryTimeout;
        document.getElementById('extendedTimeout').value = 
            items.extendedTimeout || DEFAULT_CONFIG.extendedTimeout;
        document.getElementById('maxRetries').value = 
            items.maxRetries || DEFAULT_CONFIG.maxRetries;
        document.getElementById('heartbeatInterval').value = 
            items.heartbeatInterval || DEFAULT_CONFIG.heartbeatInterval;
    });
}

// Save settings to storage
function saveSettings() {
    const initialTimeout = parseInt(document.getElementById('initialTimeout').value);
    const retryTimeout = parseInt(document.getElementById('retryTimeout').value);
    const extendedTimeout = parseInt(document.getElementById('extendedTimeout').value);
    const maxRetries = parseInt(document.getElementById('maxRetries').value);
    const heartbeatInterval = parseInt(document.getElementById('heartbeatInterval').value);
    
    // Validate inputs
    if (!initialTimeout || initialTimeout < 5000) {
        showMessage('Initial timeout must be at least 5000ms (5 seconds)', 'error');
        return;
    }
    
    if (!retryTimeout || retryTimeout < 5000) {
        showMessage('Retry timeout must be at least 5000ms (5 seconds)', 'error');
        return;
    }
    
    if (!extendedTimeout || extendedTimeout < 10000) {
        showMessage('Extended timeout must be at least 10000ms (10 seconds)', 'error');
        return;
    }
    
    if (!maxRetries || maxRetries < 1) {
        showMessage('Maximum retries must be at least 1', 'error');
        return;
    }
    
    if (!heartbeatInterval || heartbeatInterval < 1000) {
        showMessage('Heartbeat interval must be at least 1000ms (1 second)', 'error');
        return;
    }
    
    // Save to storage
    chrome.storage.local.set({
        initialTimeout: initialTimeout,
        retryTimeout: retryTimeout,
        extendedTimeout: extendedTimeout,
        maxRetries: maxRetries,
        heartbeatInterval: heartbeatInterval
    }, function() {
        showMessage('Settings saved successfully!', 'success');
    });
}

// Reset settings to defaults
function resetToDefaults() {
    if (confirm('Are you sure you want to reset all settings to default values?')) {
        document.getElementById('initialTimeout').value = DEFAULT_CONFIG.initialTimeout;
        document.getElementById('retryTimeout').value = DEFAULT_CONFIG.retryTimeout;
        document.getElementById('extendedTimeout').value = DEFAULT_CONFIG.extendedTimeout;
        document.getElementById('maxRetries').value = DEFAULT_CONFIG.maxRetries;
        document.getElementById('heartbeatInterval').value = DEFAULT_CONFIG.heartbeatInterval;
        
        saveSettings();
    }
}

// Load statistics from storage
function loadStatistics() {
    chrome.storage.local.get(['allTimeStats', 'statistics'], function(data) {
        // Initialize statistics if not present
        if (data.allTimeStats) {
            allTimeStats = data.allTimeStats;
        }
        
        // Add current session to all-time stats if available
        if (data.statistics) {
            updateAllTimeStats(data.statistics);
        }
        
        // Update the statistics display
        updateStatisticsDisplay();
        
        // Initialize the chart
        initializeChart();
    });
}

// Update all-time statistics with session data
function updateAllTimeStats(sessionStats) {
    if (sessionStats.startTime && sessionStats.endTime) {
        const sessionRuntime = sessionStats.endTime - sessionStats.startTime;
        
        // Only count completed sessions
        if (sessionStats.totalProcessed > 0) {
            // Add session if it's not already in the list
            const sessionAlreadyExists = allTimeStats.sessions.some(
                session => session.startTime === sessionStats.startTime
            );
            
            if (!sessionAlreadyExists) {
                allTimeStats.sessions.push({
                    startTime: sessionStats.startTime,
                    endTime: sessionStats.endTime,
                    totalProcessed: sessionStats.totalProcessed || 0,
                    successful: sessionStats.successful || 0,
                    skipped: sessionStats.skipped || 0,
                    failed: sessionStats.failed || 0,
                    retryAttempts: sessionStats.retryAttempts || 0,
                    runtime: sessionRuntime,
                    avgProcessingTime: sessionStats.averageProcessingTime || 0
                });
                
                // Update totals
                allTimeStats.totalProcessed += sessionStats.totalProcessed || 0;
                allTimeStats.successful += sessionStats.successful || 0;
                allTimeStats.skipped += sessionStats.skipped || 0;
                allTimeStats.failed += sessionStats.failed || 0;
                allTimeStats.totalRetries += sessionStats.retryAttempts || 0;
                allTimeStats.totalRuntime += sessionRuntime;
                
                // Recalculate average processing time (weighted average)
                const totalSuccessful = allTimeStats.successful;
                if (totalSuccessful > 0) {
                    const currentTotal = allTimeStats.avgProcessingTime * (totalSuccessful - sessionStats.successful);
                    const sessionTotal = sessionStats.averageProcessingTime * sessionStats.successful;
                    allTimeStats.avgProcessingTime = (currentTotal + sessionTotal) / totalSuccessful;
                }
                
                // Save updated all-time stats
                chrome.storage.local.set({ allTimeStats: allTimeStats });
            }
        }
    }
}

// Update the statistics display elements
function updateStatisticsDisplay() {
    document.getElementById('total-processed').textContent = allTimeStats.totalProcessed;
    document.getElementById('total-successful').textContent = allTimeStats.successful;
    document.getElementById('total-failed').textContent = allTimeStats.failed;
    document.getElementById('total-skipped').textContent = allTimeStats.skipped;
    document.getElementById('total-retries').textContent = allTimeStats.totalRetries;
    
    // Calculate success rate
    const successRate = allTimeStats.totalProcessed > 0 
        ? ((allTimeStats.successful / allTimeStats.totalProcessed) * 100).toFixed(1) 
        : 0;
    document.getElementById('success-rate').textContent = successRate + '%';
    
    // Format average processing time
    const avgTime = allTimeStats.avgProcessingTime 
        ? (allTimeStats.avgProcessingTime / 1000).toFixed(2) 
        : 0;
    document.getElementById('avg-processing-time').textContent = avgTime + 's';
    
    // Format total runtime
    document.getElementById('total-runtime').textContent = formatDuration(allTimeStats.totalRuntime);
}

// Initialize the statistics chart
function initializeChart() {
    // Destroy existing chart if it exists
    if (chartInstance) {
        chartInstance.destroy();
    }
    
    // Sort sessions by start time
    const sortedSessions = [...allTimeStats.sessions].sort((a, b) => a.startTime - b.startTime);
    
    // Prepare chart data
    const labels = sortedSessions.map(session => new Date(session.startTime).toLocaleDateString());
    const successData = sortedSessions.map(session => session.successful);
    const skipData = sortedSessions.map(session => session.skipped);
    const failData = sortedSessions.map(session => session.failed);
    
    // Get the chart context
    const ctx = document.getElementById('stats-chart').getContext('2d');
    
    // Create the chart
    chartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Successful',
                    data: successData,
                    backgroundColor: '#28a745',
                    stack: 'Stack 0'
                },
                {
                    label: 'Skipped',
                    data: skipData,
                    backgroundColor: '#f39c12',
                    stack: 'Stack 0'
                },
                {
                    label: 'Failed',
                    data: failData,
                    backgroundColor: '#dc3545',
                    stack: 'Stack 0'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: {
                    display: true,
                    text: 'Refund Processing History'
                },
                tooltip: {
                    mode: 'index',
                    intersect: false
                }
            },
            scales: {
                x: {
                    title: {
                        display: true,
                        text: 'Session Date'
                    }
                },
                y: {
                    title: {
                        display: true,
                        text: 'Number of Refunds'
                    },
                    beginAtZero: true
                }
            }
        }
    });
}

// Clear all statistics
function clearStatistics() {
    if (confirm('Are you sure you want to clear all statistics data? This cannot be undone.')) {
        // Reset all-time stats
        allTimeStats = {
            totalProcessed: 0,
            successful: 0,
            skipped: 0,
            failed: 0,
            totalRetries: 0,
            totalRuntime: 0,
            avgProcessingTime: 0,
            sessions: []
        };
        
        // Save to storage
        chrome.storage.local.set({ allTimeStats: allTimeStats }, function() {
            // Update UI
            updateStatisticsDisplay();
            initializeChart();
            showMessage('Statistics cleared successfully', 'success');
        });
    }
}

// Helper function to format duration in hours and minutes
function formatDuration(ms) {
    if (!ms) return '0h 0m';
    
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    return `${hours}h ${minutes % 60}m`;
}

// Helper function to show messages
function showMessage(message, type) {
    // Remove any existing message
    const existingMessage = document.querySelector('.message');
    if (existingMessage) {
        existingMessage.remove();
    }
    
    // Create message element
    const messageElement = document.createElement('div');
    messageElement.className = `message ${type}`;
    messageElement.textContent = message;
    
    // Insert before the first section
    const firstSection = document.querySelector('.config-section');
    firstSection.parentNode.insertBefore(messageElement, firstSection);
    
    // Remove after animation completes
    setTimeout(() => {
        if (messageElement.parentNode) {
            messageElement.parentNode.removeChild(messageElement);
        }
    }, 5000);
}

// Initialize tooltips
function initializeTooltips() {
    document.querySelectorAll('.info-tooltip').forEach(tooltip => {
        tooltip.setAttribute('tabindex', '0');
        
        // Add keyboard support for tooltips
        tooltip.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' || e.key === ' ') {
                const toolTipText = this.getAttribute('title');
                showMessage(toolTipText, 'info');
                e.preventDefault();
            }
        });
    });
}