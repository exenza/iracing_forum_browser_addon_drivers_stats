// Enhanced Error Handler Integration
// Integrates individual error handling with existing ErrorHandler
// Maintains error logging and categorization while adding concurrent request metrics

// Enhanced Error Handler Integration that extends the existing ErrorHandler
const ErrorHandlerIntegration = {
    // Store reference to original ErrorHandler methods
    originalErrorHandler: null,
    
    // Initialize integration with existing ErrorHandler
    initialize() {
        console.log('ErrorHandlerIntegration: Initializing integration with existing ErrorHandler');
        
        // Store reference to original ErrorHandler if it exists
        if (typeof ErrorHandler !== 'undefined') {
            this.originalErrorHandler = { ...ErrorHandler };
            console.log('ErrorHandlerIntegration: Found existing ErrorHandler, creating backup');
        }
        
        // Extend existing ErrorHandler with individual driver capabilities
        this.extendErrorHandler();
        
        // Initialize metrics tracking
        this.initializeMetrics();
        
        console.log('ErrorHandlerIntegration: Integration initialized successfully');
    },
    
    // Extend existing ErrorHandler with individual driver support
    extendErrorHandler() {
        if (typeof ErrorHandler === 'undefined') {
            console.warn('ErrorHandlerIntegration: No existing ErrorHandler found, skipping extension');
            return;
        }
        
        // Add individual error handling methods to existing ErrorHandler
        ErrorHandler.handleIndividualDriverError = IndividualErrorHandler.handleIndividualDriverError.bind(IndividualErrorHandler);
        ErrorHandler.showIndividualDriverError = IndividualErrorHandler.showIndividualDriverError.bind(IndividualErrorHandler);
        ErrorHandler.handleDriverFailureIsolation = IndividualErrorHandler.handleDriverFailureIsolation.bind(IndividualErrorHandler);
        ErrorHandler.markDriverSuccess = IndividualErrorHandler.markDriverSuccess.bind(IndividualErrorHandler);
        ErrorHandler.getErrorStats = IndividualErrorHandler.getErrorStats.bind(IndividualErrorHandler);
        ErrorHandler.resetErrorStats = IndividualErrorHandler.resetErrorStats.bind(IndividualErrorHandler);
        ErrorHandler.processDriverResults = IndividualErrorHandler.processDriverResults.bind(IndividualErrorHandler);
        
        // Store original handleApiError method
        const originalHandleApiError = ErrorHandler.handleApiError;
        
        // Enhance handleApiError to support individual drivers
        ErrorHandler.handleApiError = function(error, driverName = null) {
            if (driverName) {
                // Use individual error handling for specific drivers
                return IndividualErrorHandler.handleIndividualDriverError(error, driverName);
            } else {
                // Use original error handling for batch operations
                return originalHandleApiError.call(this, error, driverName);
            }
        };
        
        // Store original showError method
        const originalShowError = ErrorHandler.showError;
        
        // Enhance showError to support individual drivers
        ErrorHandler.showError = function(elementOrDriverName, message, driverName = null) {
            // Check if first parameter is a driver name (string) rather than element
            if (typeof elementOrDriverName === 'string' && !driverName) {
                // Called as showError(driverName, message)
                return IndividualErrorHandler.showIndividualDriverError(elementOrDriverName, message);
            } else {
                // Called as showError(element, message, driverName) - original format
                return originalShowError.call(this, elementOrDriverName, message, driverName);
            }
        };
        
        // Add cleanup method
        const originalCleanup = ErrorHandler.cleanup || function() {};
        ErrorHandler.cleanup = function() {
            IndividualErrorHandler.cleanup();
            originalCleanup.call(this);
        };
        
        console.log('ErrorHandlerIntegration: Extended existing ErrorHandler with individual driver capabilities');
    },
    
    // Initialize metrics tracking for concurrent requests
    initializeMetrics() {
        // Initialize individual error handler metrics
        if (typeof IndividualErrorHandler !== 'undefined') {
            IndividualErrorHandler.resetErrorStats();
        }
        
        // Add metrics collection to concurrent request manager if available
        if (typeof ConcurrentRequestManager !== 'undefined') {
            this.integrateConcurrentRequestMetrics();
        }
        
        console.log('ErrorHandlerIntegration: Metrics tracking initialized');
    },
    
    // Integrate metrics collection with concurrent request manager
    integrateConcurrentRequestMetrics() {
        if (typeof ConcurrentRequestManager === 'undefined') {
            console.warn('ErrorHandlerIntegration: ConcurrentRequestManager not found, skipping metrics integration');
            return;
        }
        
        // Store original fetchAllDrivers method
        const originalFetchAllDrivers = ConcurrentRequestManager.fetchAllDrivers;
        
        // Enhance fetchAllDrivers to collect error metrics
        ConcurrentRequestManager.fetchAllDrivers = async function(driverNames) {
            console.log('ErrorHandlerIntegration: Starting concurrent request with metrics collection');
            
            const startTime = Date.now();
            let result;
            
            try {
                // Call original method
                result = await originalFetchAllDrivers.call(this, driverNames);
                
                // Process results for error metrics
                if (result && typeof result === 'object') {
                    ErrorHandlerIntegration.processRequestResults(result, driverNames, startTime);
                }
                
                return result;
                
            } catch (error) {
                // Handle batch-level errors
                console.error('ErrorHandlerIntegration: Batch request failed:', error);
                
                // Mark all drivers as failed
                if (Array.isArray(driverNames)) {
                    driverNames.forEach(driverName => {
                        IndividualErrorHandler.handleIndividualDriverError(error, driverName);
                    });
                }
                
                throw error;
            }
        };
        
        console.log('ErrorHandlerIntegration: Integrated metrics collection with ConcurrentRequestManager');
    },
    
    // Process request results and update metrics
    processRequestResults(results, originalDriverNames, startTime) {
        if (!results || typeof results !== 'object') {
            console.warn('ErrorHandlerIntegration.processRequestResults: Invalid results');
            return;
        }
        
        const endTime = Date.now();
        const totalTime = endTime - startTime;
        
        let successCount = 0;
        let errorCount = 0;
        
        // Process each driver result
        Object.keys(results).forEach(driverName => {
            const driverData = results[driverName];
            
            if (driverData && driverData.error) {
                // Handle error case
                errorCount++;
                IndividualErrorHandler.handleIndividualDriverError(
                    driverData.originalError || new Error(driverData.errorMessage), 
                    driverName
                );
            } else if (driverData) {
                // Handle success case
                successCount++;
                IndividualErrorHandler.markDriverSuccess(driverName);
            }
        });
        
        // Log metrics summary
        const totalDrivers = originalDriverNames ? originalDriverNames.length : Object.keys(results).length;
        const successRate = totalDrivers > 0 ? (successCount / totalDrivers) * 100 : 0;
        const failureRate = totalDrivers > 0 ? (errorCount / totalDrivers) * 100 : 0;
        
        console.log(`ErrorHandlerIntegration: Request completed in ${totalTime}ms`);
        console.log(`ErrorHandlerIntegration: Success: ${successCount}/${totalDrivers} (${successRate.toFixed(1)}%)`);
        console.log(`ErrorHandlerIntegration: Failures: ${errorCount}/${totalDrivers} (${failureRate.toFixed(1)}%)`);
        
        // Update concurrent request manager stats if available
        if (typeof ConcurrentRequestManager !== 'undefined' && ConcurrentRequestManager.stats) {
            ConcurrentRequestManager.stats.successRate = successRate;
            ConcurrentRequestManager.stats.failureRate = failureRate;
            ConcurrentRequestManager.stats.lastRequestTime = totalTime;
        }
    },
    
    // Get comprehensive error and success metrics
    getComprehensiveMetrics() {
        const individualStats = IndividualErrorHandler.getErrorStats();
        const concurrentStats = typeof ConcurrentRequestManager !== 'undefined' ? 
            ConcurrentRequestManager.getRequestStats() : {};
        
        return {
            timestamp: new Date().toISOString(),
            individual: individualStats,
            concurrent: concurrentStats,
            integration: {
                originalErrorHandlerAvailable: this.originalErrorHandler !== null,
                concurrentRequestManagerIntegrated: typeof ConcurrentRequestManager !== 'undefined',
                enhancedLoadingManagerAvailable: typeof EnhancedLoadingManager !== 'undefined'
            }
        };
    },
    
    // Log comprehensive metrics summary
    logMetricsSummary() {
        const metrics = this.getComprehensiveMetrics();
        
        console.log('=== Error Handler Integration Metrics Summary ===');
        console.log(`Total Drivers Processed: ${metrics.individual.totalDrivers}`);
        console.log(`Success Rate: ${metrics.individual.successRate}%`);
        console.log(`Failure Rate: ${metrics.individual.failureRate}%`);
        console.log(`Total Errors: ${metrics.individual.totalErrors}`);
        console.log('Error Breakdown:', metrics.individual.errorBreakdown);
        
        if (metrics.concurrent.totalRequests) {
            console.log(`Concurrent Requests: ${metrics.concurrent.totalRequests}`);
            console.log(`Average Response Time: ${metrics.concurrent.averageResponseTime}ms`);
            console.log(`Peak Concurrent Count: ${metrics.concurrent.concurrentPeakCount}`);
        }
        
        console.log('=== End Metrics Summary ===');
    },
    
    // Restore original ErrorHandler (for testing or rollback)
    restoreOriginalErrorHandler() {
        if (this.originalErrorHandler && typeof ErrorHandler !== 'undefined') {
            // Restore original methods
            Object.keys(this.originalErrorHandler).forEach(key => {
                ErrorHandler[key] = this.originalErrorHandler[key];
            });
            
            // Remove added methods
            delete ErrorHandler.handleIndividualDriverError;
            delete ErrorHandler.showIndividualDriverError;
            delete ErrorHandler.handleDriverFailureIsolation;
            delete ErrorHandler.markDriverSuccess;
            delete ErrorHandler.getErrorStats;
            delete ErrorHandler.resetErrorStats;
            delete ErrorHandler.processDriverResults;
            
            console.log('ErrorHandlerIntegration: Restored original ErrorHandler');
            return true;
        }
        
        console.warn('ErrorHandlerIntegration: No original ErrorHandler to restore');
        return false;
    },
    
    // Check integration status
    getIntegrationStatus() {
        return {
            initialized: this.originalErrorHandler !== null,
            errorHandlerExtended: typeof ErrorHandler !== 'undefined' && 
                                 typeof ErrorHandler.handleIndividualDriverError === 'function',
            concurrentManagerIntegrated: typeof ConcurrentRequestManager !== 'undefined' &&
                                        ConcurrentRequestManager.fetchAllDrivers.toString().includes('ErrorHandlerIntegration'),
            metricsActive: typeof IndividualErrorHandler !== 'undefined' &&
                          IndividualErrorHandler.errorStats.totalErrors >= 0
        };
    },
    
    // Cleanup integration
    cleanup() {
        console.log('ErrorHandlerIntegration: Cleaning up integration');
        
        // Clean up individual error handler
        if (typeof IndividualErrorHandler !== 'undefined') {
            IndividualErrorHandler.cleanup();
        }
        
        // Restore original error handler if needed
        this.restoreOriginalErrorHandler();
        
        console.log('ErrorHandlerIntegration: Cleanup completed');
    }
};

// Auto-initialize integration when script loads
if (typeof window !== 'undefined') {
    // Initialize on DOM ready or immediately if already loaded
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            // Wait a bit for other scripts to load
            setTimeout(() => {
                ErrorHandlerIntegration.initialize();
            }, 100);
        });
    } else {
        // Initialize immediately but allow other scripts to load first
        setTimeout(() => {
            ErrorHandlerIntegration.initialize();
        }, 100);
    }
}

// Add cleanup on page unload
if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', () => {
        ErrorHandlerIntegration.cleanup();
    });
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ErrorHandlerIntegration };
}