/*
Name: Brice Blanchard
Date: 3/17/2025
Project: Nellis Auction Refund Handler
Version: 3.0
*/

/**
 * Manages statistics for the refund processing
 */
export class StatisticsManager {
    constructor(logger) {
        this.logger = logger;
        
        // Initialize statistics object
        this.statistics = {
            startTime: null,
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
        
        // Load from storage
        this._initFromStorage();
    }
    
    /**
     * Initialize statistics from storage
     */
    async _initFromStorage() {
        try {
            const data = await new Promise(resolve => {
                chrome.storage.local.get(['statistics'], resolve);
            });
            
            if (data.statistics) {
                this.statistics = data.statistics;
                this.logger.debug('Statistics loaded from storage');
            }
        } catch (error) {
            this.logger.error('Failed to load statistics from storage', error);
        }
    }
    
    /**
     * Save statistics to storage
     */
    async _saveToStorage() {
        try {
            await new Promise(resolve => {
                chrome.storage.local.set({ statistics: this.statistics }, resolve);
            });
        } catch (error) {
            this.logger.error('Failed to save statistics to storage', error);
        }
    }
    
    /**
     * Reset statistics for a new run
     */
    reset() {
        this.statistics = {
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
        
        this._saveToStorage();
        this.logger.info('Statistics reset for new run');
    }
    
    /**
     * Update statistics based on action type
     */
    updateStatistics(action, details = {}) {
        switch (action) {
            case 'success':
                this._handleSuccess(details);
                break;
                
            case 'skip':
                this._handleSkip(details);
                break;
                
            case 'fail':
                this._handleFail(details);
                break;
                
            case 'retry':
                this._handleRetry(details);
                break;
                
            case 'end':
                this._handleEnd();
                break;
                
            default:
                this.logger.warn(`Unknown statistics action: ${action}`);
        }
        
        // Save updated statistics to storage
        this._saveToStorage();
        
        // Notify background script of statistics update
        chrome.runtime.sendMessage({
            action: "statisticsUpdate",
            summary: this.getSummary()
        });
    }
    
    /**
     * Handle successful refund processing
     */
    _handleSuccess(details) {
        this.statistics.totalProcessed++;
        this.statistics.successful++;
        
        // Process timing information
        if (details.processingTime) {
            // Update the total processing time
            this.statistics.totalProcessingTime += details.processingTime;
            
            // Update the average processing time (weighted average)
            this.statistics.averageProcessingTime = 
                this.statistics.totalProcessingTime / this.statistics.successful;
        }
        
        // Add to refund details
        this.statistics.refundDetails.push({
            id: details.refundId || `refund-${this.statistics.totalProcessed}`,
            amount: details.amount || 0,
            status: 'success',
            timestamp: new Date().toISOString(),
            processingTime: details.processingTime || 0,
            retries: details.retries || 0
        });
        
        this.logger.info(`Successful refund processed: ${details.refundId || 'Unknown ID'}`, {
            amount: details.amount,
            processingTime: details.processingTime
        });
    }
    
    /**
     * Handle skipped refund
     */
    _handleSkip(details) {
        this.statistics.totalProcessed++;
        this.statistics.skipped++;
        
        // Add to refund details
        this.statistics.refundDetails.push({
            id: details.refundId || `refund-${this.statistics.totalProcessed}`,
            amount: details.amount || 0,
            status: 'skipped',
            timestamp: new Date().toISOString(),
            reason: details.errorMessage || 'Unknown reason',
            processingTime: details.processingTime || 0,
            retries: details.retries || 0
        });
        
        this.logger.warn(`Skipped refund: ${details.refundId || 'Unknown ID'}`, {
            amount: details.amount,
            reason: details.errorMessage
        });
    }
    
    /**
     * Handle failed refund
     */
    _handleFail(details) {
        this.statistics.totalProcessed++;
        this.statistics.failed++;
        
        // Add to refund details
        this.statistics.refundDetails.push({
            id: details.refundId || `refund-${this.statistics.totalProcessed}`,
            amount: details.amount || 0,
            status: 'failed',
            timestamp: new Date().toISOString(),
            error: details.errorMessage || 'Unknown error',
            processingTime: details.processingTime || 0,
            retries: details.retries || 0
        });
        
        this.logger.error(`Failed refund: ${details.refundId || 'Unknown ID'}`, {
            amount: details.amount,
            error: details.errorMessage
        });
    }
    
    /**
     * Handle retry attempt
     */
    _handleRetry(details) {
        this.statistics.retryAttempts++;
        
        // Update the existing refund detail if possible
        if (details.refundId && this.statistics.refundDetails.length > 0) {
            const existingDetailIndex = this.statistics.refundDetails.findIndex(
                detail => detail.id === details.refundId
            );
            
            if (existingDetailIndex >= 0) {
                this.statistics.refundDetails[existingDetailIndex].retries = 
                    (this.statistics.refundDetails[existingDetailIndex].retries || 0) + 1;
            }
        }
        
        this.logger.warn(`Retry attempt for refund: ${details.refundId || 'Unknown ID'}`, {
            retryCount: details.retryCount
        });
    }
    
    /**
     * Handle end of processing
     */
    _handleEnd() {
        this.statistics.endTime = Date.now();
        this.logger.info('Refund processing completed', this.getSummary());
    }
    
    /**
     * Get a summary of the statistics (without detailed refund info)
     */
    getSummary() {
        // Create a summary of statistics for sending to the popup
        return {
            totalProcessed: this.statistics.totalProcessed,
            successful: this.statistics.successful,
            skipped: this.statistics.skipped,
            failed: this.statistics.failed,
            retryAttempts: this.statistics.retryAttempts,
            averageProcessingTime: this.statistics.averageProcessingTime,
            startTime: this.statistics.startTime,
            endTime: this.statistics.endTime || Date.now(), // Use current time if not ended
            runningTime: this.statistics.startTime 
                ? ((this.statistics.endTime || Date.now()) - this.statistics.startTime) 
                : 0
        };
    }
    
    /**
     * Get detailed statistics including all refund details
     */
    getDetailedStatistics() {
        return this.statistics;
    }
    
    /**
     * Export statistics to JSON
     */
    exportStatistics() {
        return JSON.stringify(this.statistics, null, 2);
    }
    
    /**
     * Add specific refund detail
     */
    addRefundDetail(detail) {
        this.statistics.refundDetails.push({
            timestamp: new Date().toISOString(),
            ...detail
        });
        
        this._saveToStorage();
    }
    
    /**
     * Get specific refund detail by ID
     */
    getRefundDetailById(refundId) {
        return this.statistics.refundDetails.find(detail => detail.id === refundId);
    }
    
    /**
     * Get success rate as percentage
     */
    getSuccessRate() {
        if (this.statistics.totalProcessed === 0) {
            return 0;
        }
        
        return (this.statistics.successful / this.statistics.totalProcessed) * 100;
    }
    
    /**
     * Get average refund amount
     */
    getAverageRefundAmount() {
        const refundsWithAmount = this.statistics.refundDetails.filter(detail => detail.amount > 0);
        
        if (refundsWithAmount.length === 0) {
            return 0;
        }
        
        const total = refundsWithAmount.reduce((sum, detail) => sum + detail.amount, 0);
        return total / refundsWithAmount.length;
    }
    
    /**
     * Get total refund amount
     */
    getTotalRefundAmount() {
        return this.statistics.refundDetails.reduce((sum, detail) => sum + (detail.amount || 0), 0);
    }
    
    /**
     * Get statistics for a specific time period
     */
    getStatisticsForTimePeriod(startTime, endTime) {
        const filteredDetails = this.statistics.refundDetails.filter(detail => {
            const timestamp = new Date(detail.timestamp).getTime();
            return timestamp >= startTime && timestamp <= endTime;
        });
        
        const periodStats = {
            totalProcessed: filteredDetails.length,
            successful: filteredDetails.filter(detail => detail.status === 'success').length,
            skipped: filteredDetails.filter(detail => detail.status === 'skipped').length,
            failed: filteredDetails.filter(detail => detail.status === 'failed').length,
            retryAttempts: filteredDetails.reduce((total, detail) => total + (detail.retries || 0), 0),
            totalAmount: filteredDetails.reduce((total, detail) => total + (detail.amount || 0), 0),
            startTime: startTime,
            endTime: endTime
        };
        
        return periodStats;
    }
    
    /**
     * Get frequency of error types
     */
    getErrorFrequency() {
        const errorDetails = this.statistics.refundDetails.filter(
            detail => detail.status === 'failed' || detail.status === 'skipped'
        );
        
        const errorFrequency = {};
        
        errorDetails.forEach(detail => {
            const errorMessage = detail.error || detail.reason || 'Unknown error';
            errorFrequency[errorMessage] = (errorFrequency[errorMessage] || 0) + 1;
        });
        
        return errorFrequency;
    }
    
    /**
     * Get the number of refunds by status
     */
    getRefundCountByStatus() {
        return {
            success: this.statistics.successful,
            skipped: this.statistics.skipped,
            failed: this.statistics.failed
        };
    }
    
    /**
     * Get the most recent processing session information
     */
    getMostRecentSession() {
        if (!this.statistics.startTime) {
            return null;
        }
        
        return {
            startTime: this.statistics.startTime,
            endTime: this.statistics.endTime,
            duration: this.statistics.endTime 
                ? (this.statistics.endTime - this.statistics.startTime) 
                : (Date.now() - this.statistics.startTime),
            totalProcessed: this.statistics.totalProcessed,
            successful: this.statistics.successful,
            skipped: this.statistics.skipped,
            failed: this.statistics.failed,
            retryAttempts: this.statistics.retryAttempts,
            averageProcessingTime: this.statistics.averageProcessingTime
        };
    }
    
    /**
     * Update all-time statistics with current session
     */
    updateAllTimeStats() {
        return new Promise(resolve => {
            chrome.storage.local.get(['allTimeStats'], data => {
                const allTimeStats = data.allTimeStats || {
                    totalProcessed: 0,
                    successful: 0,
                    skipped: 0,
                    failed: 0,
                    totalRetries: 0,
                    totalRuntime: 0,
                    avgProcessingTime: 0,
                    sessions: []
                };
                
                // Only add if we have a valid session
                if (this.statistics.startTime && this.statistics.endTime && this.statistics.totalProcessed > 0) {
                    const sessionRuntime = this.statistics.endTime - this.statistics.startTime;
                    
                    // Check if this session is already recorded
                    const sessionAlreadyExists = allTimeStats.sessions.some(
                        session => session.startTime === this.statistics.startTime
                    );
                    
                    if (!sessionAlreadyExists) {
                        allTimeStats.sessions.push({
                            startTime: this.statistics.startTime,
                            endTime: this.statistics.endTime,
                            totalProcessed: this.statistics.totalProcessed,
                            successful: this.statistics.successful,
                            skipped: this.statistics.skipped,
                            failed: this.statistics.failed,
                            retryAttempts: this.statistics.retryAttempts,
                            runtime: sessionRuntime,
                            avgProcessingTime: this.statistics.averageProcessingTime
                        });
                        
                        // Update totals
                        allTimeStats.totalProcessed += this.statistics.totalProcessed;
                        allTimeStats.successful += this.statistics.successful;
                        allTimeStats.skipped += this.statistics.skipped;
                        allTimeStats.failed += this.statistics.failed;
                        allTimeStats.totalRetries += this.statistics.retryAttempts;
                        allTimeStats.totalRuntime += sessionRuntime;
                        
                        // Recalculate average processing time (weighted average)
                        if (allTimeStats.successful > 0) {
                            const prevTotal = allTimeStats.avgProcessingTime * 
                                (allTimeStats.successful - this.statistics.successful);
                            const sessionTotal = this.statistics.averageProcessingTime * 
                                this.statistics.successful;
                            allTimeStats.avgProcessingTime = 
                                (prevTotal + sessionTotal) / allTimeStats.successful;
                        }
                        
                        // Save updated all-time stats
                        chrome.storage.local.set({ allTimeStats }, resolve);
                    } else {
                        resolve();
                    }
                } else {
                    resolve();
                }
            });
        });
    }
}