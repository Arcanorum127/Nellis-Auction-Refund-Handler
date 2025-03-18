/* 
Name: Brice Blanchard
Date: 3/17/2025
Project: Nellis Auction Refund Handler
Version: 3.0
*/

// Global variables for pagination
let currentPage = 1;
let totalPages = 1;
let logsPerPage = 50;
let filteredLogs = [];
let allLogs = [];

// Initialize the page
document.addEventListener('DOMContentLoaded', function() {
    // Load logs
    loadLogs();
    
    // Set up event listeners
    document.getElementById('search-button').addEventListener('click', applyFilters);
    document.getElementById('search-input').addEventListener('keyup', function(event) {
        if (event.key === 'Enter') {
            applyFilters();
        }
    });
    
    document.getElementById('level-filter').addEventListener('change', applyFilters);
    document.getElementById('time-range').addEventListener('change', handleTimeRangeChange);
    document.getElementById('max-entries').addEventListener('change', applyFilters);
    
    document.getElementById('refresh-button').addEventListener('click', loadLogs);
    document.getElementById('export-button').addEventListener('click', exportLogs);
    document.getElementById('clear-button').addEventListener('click', clearLogs);
    
    document.getElementById('prev-page').addEventListener('click', goToPreviousPage);
    document.getElementById('next-page').addEventListener('click', goToNextPage);
    
    // Modal functionality
    const modal = document.getElementById('log-detail-modal');
    const closeButton = document.querySelector('.close-button');
    
    closeButton.addEventListener('click', () => {
        modal.style.display = 'none';
    });
    
    window.addEventListener('click', (event) => {
        if (event.target === modal) {
            modal.style.display = 'none';
        }
    });
    
    // Custom time range inputs
    const startTimeInput = document.getElementById('start-time');
    const endTimeInput = document.getElementById('end-time');
    
    // Set default values for custom time range (today)
    const now = new Date();
    const today = now.toISOString().slice(0, 16); // Format: YYYY-MM-DDTHH:MM
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 16);
    
    startTimeInput.value = yesterday;
    endTimeInput.value = today;
    
    startTimeInput.addEventListener('change', applyFilters);
    endTimeInput.addEventListener('change', applyFilters);
});

/**
 * Load logs from storage
 */
function loadLogs() {
    chrome.storage.local.get(['logs'], function(data) {
        if (data.logs && Array.isArray(data.logs)) {
            allLogs = data.logs;
            updateLogStatistics(allLogs);
            applyFilters();
        } else {
            allLogs = [];
            filteredLogs = [];
            updateLogStatistics([]);
            displayLogs([]);
            showNoLogsMessage(true);
        }
    });
}

/**
 * Apply filters to logs
 */
function applyFilters() {
    const searchText = document.getElementById('search-input').value.toLowerCase();
    const levelFilter = document.getElementById('level-filter').value;
    const timeRange = document.getElementById('time-range').value;
    const maxEntries = document.getElementById('max-entries').value;
    
    let startTime = 0;
    let endTime = Date.now();
    
    // Handle time range
    if (timeRange === 'hour') {
        startTime = Date.now() - (60 * 60 * 1000); // 1 hour ago
    } else if (timeRange === 'day') {
        startTime = Date.now() - (24 * 60 * 60 * 1000); // 24 hours ago
    } else if (timeRange === 'week') {
        startTime = Date.now() - (7 * 24 * 60 * 60 * 1000); // 7 days ago
    } else if (timeRange === 'custom') {
        const startTimeInput = document.getElementById('start-time').value;
        const endTimeInput = document.getElementById('end-time').value;
        
        if (startTimeInput) {
            startTime = new Date(startTimeInput).getTime();
        }
        
        if (endTimeInput) {
            endTime = new Date(endTimeInput).getTime();
        }
    }
    
    // Filter logs
    filteredLogs = allLogs.filter(log => {
        // Check log level
        if (levelFilter !== 'all' && log.level !== levelFilter) {
            return false;
        }
        
        // Check time range
        const logTime = new Date(log.timestamp).getTime();
        if (logTime < startTime || logTime > endTime) {
            return false;
        }
        
        // Check search text
        if (searchText) {
            const logText = (log.message + ' ' + JSON.stringify(log.data)).toLowerCase();
            return logText.includes(searchText);
        }
        
        return true;
    });
    
    // Apply max entries limit
    if (maxEntries !== 'all') {
        filteredLogs = filteredLogs.slice(-parseInt(maxEntries));
    }
    
    // Sort by timestamp (newest first)
    filteredLogs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    
    // Set up pagination
    currentPage = 1;
    totalPages = Math.ceil(filteredLogs.length / logsPerPage);
    
    // Display logs
    displayLogsForCurrentPage();
    updatePagination();
    
    // Show/hide no logs message
    showNoLogsMessage(filteredLogs.length === 0);
}

/**
 * Display logs for the current page
 */
function displayLogsForCurrentPage() {
    const start = (currentPage - 1) * logsPerPage;
    const end = start + logsPerPage;
    const logsToDisplay = filteredLogs.slice(start, end);
    
    displayLogs(logsToDisplay);
}

/**
 * Display logs in the table
 */
function displayLogs(logs) {
    const logEntriesContainer = document.getElementById('log-entries');
    logEntriesContainer.innerHTML = '';
    
    logs.forEach((log, index) => {
        const row = document.createElement('tr');
        
        // Format timestamp
        const timestamp = new Date(log.timestamp);
        const formattedTime = timestamp.toLocaleString();
        
        // Create log row
        row.innerHTML = `
            <td class="log-time">${formattedTime}</td>
            <td><span class="log-level ${log.level.toLowerCase()}">${log.level}</span></td>
            <td class="log-message">${escapeHtml(log.message)}</td>
            <td>
                ${log.data ? '<button class="detail-button" data-index="' + index + '">View Details</button>' : '-'}
            </td>
        `;
        
        // Add event listener to detail button
        const detailButton = row.querySelector('.detail-button');
        if (detailButton) {
            detailButton.addEventListener('click', () => showLogDetails(log));
        }
        
        logEntriesContainer.appendChild(row);
    });
}

/**
 * Show log details in modal
 */
function showLogDetails(log) {
    const modal = document.getElementById('log-detail-modal');
    
    // Format timestamp
    const timestamp = new Date(log.timestamp);
    const formattedTime = timestamp.toLocaleString();
    
    // Set modal content
    document.getElementById('detail-timestamp').textContent = formattedTime;
    document.getElementById('detail-level').textContent = log.level;
    document.getElementById('detail-message').textContent = log.message;
    
    // Format data as JSON
    const detailData = document.getElementById('detail-data');
    if (log.data) {
        try {
            const formattedJson = JSON.stringify(log.data, null, 2);
            detailData.textContent = formattedJson;
            detailData.style.display = 'block';
        } catch (error) {
            detailData.textContent = 'Error formatting data: ' + error.message;
        }
    } else {
        detailData.textContent = 'No additional data';
        detailData.style.display = 'block';
    }
    
    // Show modal
    modal.style.display = 'block';
}

/**
 * Update log statistics
 */
function updateLogStatistics(logs) {
    document.getElementById('total-logs').textContent = logs.length;
    
    // Count by level
    const countByLevel = {
        DEBUG: 0,
        INFO: 0,
        WARN: 0,
        ERROR: 0
    };
    
    logs.forEach(log => {
        if (countByLevel[log.level] !== undefined) {
            countByLevel[log.level]++;
        }
    });
    
    document.getElementById('debug-logs').textContent = countByLevel.DEBUG;
    document.getElementById('info-logs').textContent = countByLevel.INFO;
    document.getElementById('warn-logs').textContent = countByLevel.WARN;
    document.getElementById('error-logs').textContent = countByLevel.ERROR;
}

/**
 * Navigate to previous page
 */
function goToPreviousPage() {
    if (currentPage > 1) {
        currentPage--;
        displayLogsForCurrentPage();
        updatePagination();
    }
}

/**
 * Navigate to next page
 */
function goToNextPage() {
    if (currentPage < totalPages) {
        currentPage++;
        displayLogsForCurrentPage();
        updatePagination();
    }
}

/**
 * Update pagination controls
 */
function updatePagination() {
    document.getElementById('page-info').textContent = `Page ${currentPage} of ${totalPages || 1}`;
    document.getElementById('prev-page').disabled = currentPage <= 1;
    document.getElementById('next-page').disabled = currentPage >= totalPages;
}

/**
 * Show or hide the no logs message
 */
function showNoLogsMessage(show) {
    const noLogsMessage = document.getElementById('no-logs-message');
    const logTable = document.getElementById('log-table');
    const pagination = document.querySelector('.pagination');
    
    if (show) {
        noLogsMessage.style.display = 'block';
        logTable.style.display = 'none';
        pagination.style.display = 'none';
    } else {
        noLogsMessage.style.display = 'none';
        logTable.style.display = 'table';
        pagination.style.display = 'flex';
    }
}

/**
 * Handle time range change
 */
function handleTimeRangeChange() {
    const timeRange = document.getElementById('time-range').value;
    const customTimeContainer = document.getElementById('custom-time-container');
    
    if (timeRange === 'custom') {
        customTimeContainer.style.display = 'block';
    } else {
        customTimeContainer.style.display = 'none';
    }
    
    applyFilters();
}

/**
 * Export logs to JSON file
 */
function exportLogs() {
    // Determine which logs to export (filtered or all)
    const logsToExport = filteredLogs.length > 0 ? filteredLogs : allLogs;
    
    // Create a JSON blob
    const jsonData = JSON.stringify(logsToExport, null, 2);
    const blob = new Blob([jsonData], { type: 'application/json' });
    
    // Create download link
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    
    // Prepare filename with timestamp
    const date = new Date();
    const timestamp = date.toISOString().replace(/:/g, '-').replace(/\..+/, '');
    const filename = `refund-handler-logs-${timestamp}.json`;
    
    a.href = url;
    a.download = filename;
    
    // Trigger download
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    // Clean up
    setTimeout(() => {
        URL.revokeObjectURL(url);
    }, 100);
}

/**
 * Clear all logs
 */
function clearLogs() {
    if (confirm('Are you sure you want to clear all logs? This cannot be undone.')) {
        chrome.storage.local.remove(['logs'], function() {
            allLogs = [];
            filteredLogs = [];
            updateLogStatistics([]);
            displayLogs([]);
            showNoLogsMessage(true);
            
            // Update pagination
            currentPage = 1;
            totalPages = 1;
            updatePagination();
            
            alert('All logs have been cleared.');
        });
    }
}

/**
 * Helper function to escape HTML in log messages
 */
function escapeHtml(text) {
    if (!text) return '';
    
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}