// Individual Error Handler for Concurrent Driver Loading
// Handles per-driver error display and integrates with existing ErrorHandler

// Enhanced Error Handler for Individual Driver Errors
const IndividualErrorHandler = {
    // Inherit error types and messages from existing ErrorHandler
    ERROR_TYPES: {
        NETWORK: 'network',
        API: 'api',
        DATA: 'data',
        TIMEOUT: 'timeout',
        UNKNOWN: 'unknown'
    },

    // User-friendly error messages (same format as current system)
    ERROR_MESSAGES: {
        network: 'Stats unavailable - network error',
        api: 'Stats unavailable - API error',
        data: 'Stats failed to load',
        timeout: 'Stats unavailable - timeout',
        unknown: 'Unable to load stats'
    },

    // Track individual driver errors for metrics
    driverErrors: new Map(),
    
    // Error statistics for concurrent requests
    errorStats: {
        totalErrors: 0,
        networkErrors: 0,
        apiErrors: 0,
        dataErrors: 0,
        timeoutErrors: 0,
        unknownErrors: 0,
        driversWithErrors: new Set(),
        successfulDrivers: new Set()
    },

    // Handle individual driver error (main entry point)
    handleIndividualDriverError(error, driverName) {
        if (!driverName) {
            console.warn('IndividualErrorHandler.handleIndividualDriverError: Missing driver name');
            return null;
        }

        const errorType = this.categorizeError(error);
        const message = this.getErrorMessage(errorType);

        // Create error info object
        const errorInfo = {
            type: errorType,
            message: message,
            driverName: driverName,
            timestamp: new Date().toISOString(),
            originalError: error
        };

        // Log the error with driver context
        this.logIndividualError(error, errorInfo);

        // Track error for metrics
        this.trackDriverError(driverName, errorInfo);

        // Update error statistics
        this.updateErrorStats(errorType, driverName);

        return errorInfo;
    },

    // Show error message for individual failed driver
    showIndividualDriverError(driverName, errorMessage, elements = null) {
        if (!driverName || !errorMessage) {
            console.warn('IndividualErrorHandler.showIndividualDriverError: Missing required parameters');
            return false;
        }

        // Get elements associated with this driver if not provided
        let targetElements = elements;
        if (!targetElements && typeof RequestDeduplicationManager !== 'undefined') {
            targetElements = RequestDeduplicationManager.getElementsForDriver(driverName);
        }

        // Ensure we have elements to update
        if (!targetElements || (Array.isArray(targetElements) && targetElements.length === 0)) {
            console.warn(`IndividualErrorHandler.showIndividualDriverError: No elements found for driver ${driverName}`);
            return false;
        }

        // Convert to array if single element
        const elementArray = Array.isArray(targetElements) ? targetElements : [targetElements];

        let updatedCount = 0;

        // Show error for each element associated with this driver
        elementArray.forEach(element => {
            if (element) {
                try {
                    // Use enhanced loading manager if available, otherwise fall back to direct DOM manipulation
                    if (typeof EnhancedLoadingManager !== 'undefined' && EnhancedLoadingManager.showErrorForDriver) {
                        // Use enhanced loading manager for consistent error display
                        EnhancedLoadingManager.showErrorForDriver(driverName, errorMessage);
                    } else if (typeof LoadingManager !== 'undefined' && LoadingManager.showErrorForElement) {
                        // Use existing loading manager
                        LoadingManager.showErrorForElement(element, errorMessage);
                    } else {
                        // Direct DOM manipulation as fallback
                        this.showErrorInElement(element, errorMessage, driverName);
                    }
                    updatedCount++;
                } catch (error) {
                    console.error(`IndividualErrorHandler: Error showing error for driver ${driverName}:`, error);
                }
            }
        });

        console.log(`IndividualErrorHandler: Showed error for driver ${driverName} in ${updatedCount} elements: ${errorMessage}`);
        return updatedCount > 0;
    },

    // Direct DOM manipulation for error display (fallback method)
    showErrorInElement(element, errorMessage, driverName) {
        if (!element) {
            return;
        }

        // Create error HTML with same format as current system
        const errorHtml = `<span class="error-message fs90" data-driver="${driverName}">${errorMessage}</span>`;
        
        // Add error styling class
        element.classList.add('driver-error');
        element.innerHTML = errorHtml;

        // Log that we're showing an error to user
        console.log(`IndividualErrorHandler: Showing error in element for driver "${driverName}": ${errorMessage}`);
    },

    // Ensure other drivers continue loading when one fails
    handleDriverFailureIsolation(failedDriverName, allDriverNames, ongoingRequests) {
        if (!failedDriverName || !Array.isArray(allDriverNames)) {
            console.warn('IndividualErrorHandler.handleDriverFailureIsolation: Invalid parameters');
            return false;
        }

        // Mark this driver as failed
        this.errorStats.driversWithErrors.add(failedDriverName);

        // Get list of drivers that should continue loading
        const continuingDrivers = allDriverNames.filter(name => name !== failedDriverName);

        console.log(`IndividualErrorHandler: Driver ${failedDriverName} failed. ${continuingDrivers.length} other drivers continuing to load.`);

        // Verify that ongoing requests for other drivers are not affected
        if (ongoingRequests && typeof ongoingRequests === 'object') {
            const activeDrivers = Object.keys(ongoingRequests).filter(name => name !== failedDriverName);
            console.log(`IndividualErrorHandler: ${activeDrivers.length} drivers still have active requests: ${activeDrivers.join(', ')}`);
        }

        return true;
    },

    // Categorize errors (same logic as existing ErrorHandler)
    categorizeError(error) {
        if (!error) {
            return this.ERROR_TYPES.UNKNOWN;
        }

        // Network-related errors
        if (error.name === 'TypeError' && error.message && error.message.includes('fetch')) {
            return this.ERROR_TYPES.NETWORK;
        }

        // Timeout errors
        if (error.name === 'AbortError' || (error.message && error.message.includes('timeout'))) {
            return this.ERROR_TYPES.TIMEOUT;
        }

        // HTTP errors (API errors)
        if (error.status && (error.status >= 400 && error.status < 600)) {
            return this.ERROR_TYPES.API;
        }

        // Data parsing errors
        if (error instanceof SyntaxError || (error.message && error.message.includes('JSON'))) {
            return this.ERROR_TYPES.DATA;
        }

        // Default to API error for unknown errors
        return this.ERROR_TYPES.API;
    },

    // Get user-friendly error message (same format as current system)
    getErrorMessage(errorType) {
        return this.ERROR_MESSAGES[errorType] || this.ERROR_MESSAGES.unknown;
    },

    // Log individual driver error with enhanced context
    logIndividualError(error, errorInfo) {
        const logData = {
            error: {
                name: error?.name || 'Unknown',
                message: error?.message || 'No message',
                stack: error?.stack || 'No stack trace',
                status: error?.status || null
            },
            context: {
                type: errorInfo.type,
                driverName: errorInfo.driverName,
                timestamp: errorInfo.timestamp,
                errorHandlerType: 'individual'
            },
            userAgent: navigator.userAgent,
            url: window.location.href
        };

        console.error('iRacing Forum Extension Individual Driver Error:', logData);

        // Also log a simplified version for easier debugging
        console.error(`Individual error ${errorInfo.type} for driver "${errorInfo.driverName}":`, error);
    },

    // Track driver error for metrics and analysis
    trackDriverError(driverName, errorInfo) {
        // Store error info for this driver
        this.driverErrors.set(driverName, errorInfo);

        // Update driver-specific error tracking
        this.errorStats.driversWithErrors.add(driverName);

        console.log(`IndividualErrorHandler: Tracked error for driver ${driverName}: ${errorInfo.type}`);
    },

    // Update error statistics for concurrent request metrics
    updateErrorStats(errorType, driverName) {
        this.errorStats.totalErrors++;

        // Update type-specific counters
        switch (errorType) {
            case this.ERROR_TYPES.NETWORK:
                this.errorStats.networkErrors++;
                break;
            case this.ERROR_TYPES.API:
                this.errorStats.apiErrors++;
                break;
            case this.ERROR_TYPES.DATA:
                this.errorStats.dataErrors++;
                break;
            case this.ERROR_TYPES.TIMEOUT:
                this.errorStats.timeoutErrors++;
                break;
            default:
                this.errorStats.unknownErrors++;
                break;
        }

        console.log(`IndividualErrorHandler: Updated error stats - Total: ${this.errorStats.totalErrors}, Type: ${errorType}`);
    },

    // Mark driver as successful (for success/failure rate metrics)
    markDriverSuccess(driverName) {
        if (!driverName) {
            return;
        }

        this.errorStats.successfulDrivers.add(driverName);
        console.log(`IndividualErrorHandler: Marked driver ${driverName} as successful`);
    },

    // Get error information for a specific driver
    getDriverError(driverName) {
        return this.driverErrors.get(driverName) || null;
    },

    // Check if a driver has an error
    hasDriverError(driverName) {
        return this.driverErrors.has(driverName);
    },

    // Get list of drivers with errors
    getDriversWithErrors() {
        return Array.from(this.errorStats.driversWithErrors);
    },

    // Get list of successful drivers
    getSuccessfulDrivers() {
        return Array.from(this.errorStats.successfulDrivers);
    },

    // Get comprehensive error statistics
    getErrorStats() {
        const totalDrivers = this.errorStats.driversWithErrors.size + this.errorStats.successfulDrivers.size;
        const successRate = totalDrivers > 0 ? (this.errorStats.successfulDrivers.size / totalDrivers) * 100 : 0;
        const failureRate = totalDrivers > 0 ? (this.errorStats.driversWithErrors.size / totalDrivers) * 100 : 0;

        return {
            ...this.errorStats,
            totalDrivers: totalDrivers,
            successRate: Math.round(successRate * 100) / 100,
            failureRate: Math.round(failureRate * 100) / 100,
            driversWithErrorsList: this.getDriversWithErrors(),
            successfulDriversList: this.getSuccessfulDrivers(),
            errorBreakdown: {
                network: this.errorStats.networkErrors,
                api: this.errorStats.apiErrors,
                data: this.errorStats.dataErrors,
                timeout: this.errorStats.timeoutErrors,
                unknown: this.errorStats.unknownErrors
            }
        };
    },

    // Reset error statistics (useful for testing)
    resetErrorStats() {
        this.driverErrors.clear();
        this.errorStats = {
            totalErrors: 0,
            networkErrors: 0,
            apiErrors: 0,
            dataErrors: 0,
            timeoutErrors: 0,
            unknownErrors: 0,
            driversWithErrors: new Set(),
            successfulDrivers: new Set()
        };
        console.log('IndividualErrorHandler: Error statistics reset');
    },

    // Clean up error tracking (for page navigation)
    cleanup() {
        this.driverErrors.clear();
        this.resetErrorStats();
        console.log('IndividualErrorHandler: Cleaned up all error tracking');
    },

    // Integration helper: Process concurrent request results
    processDriverResults(driverResults) {
        if (!driverResults || typeof driverResults !== 'object') {
            console.warn('IndividualErrorHandler.processDriverResults: Invalid driver results');
            return false;
        }

        let processedCount = 0;

        Object.keys(driverResults).forEach(driverName => {
            const driverData = driverResults[driverName];

            if (driverData && driverData.error) {
                // Handle error case
                const errorInfo = this.handleIndividualDriverError(driverData.originalError || new Error(driverData.errorMessage), driverName);
                this.showIndividualDriverError(driverName, errorInfo.message);
            } else if (driverData) {
                // Handle success case
                this.markDriverSuccess(driverName);
            }

            processedCount++;
        });

        console.log(`IndividualErrorHandler: Processed results for ${processedCount} drivers`);
        return processedCount > 0;
    }
};

// Enhanced Error Handler Integration (extends existing ErrorHandler)
const EnhancedErrorHandler = {
    // Inherit from existing ErrorHandler if available
    ...(typeof ErrorHandler !== 'undefined' ? ErrorHandler : {}),
    
    // Add individual error handling capabilities
    ...IndividualErrorHandler,

    // Enhanced handleApiError that supports individual drivers
    handleApiError(error, driverName = null) {
        if (driverName) {
            // Use individual error handling for specific drivers
            return this.handleIndividualDriverError(error, driverName);
        } else {
            // Fall back to original error handling for batch operations
            if (typeof ErrorHandler !== 'undefined' && ErrorHandler.handleApiError) {
                return ErrorHandler.handleApiError.call(this, error, driverName);
            } else {
                // Fallback implementation
                const errorType = this.categorizeError(error);
                const message = this.getErrorMessage(errorType);
                
                this.logError(error, {
                    type: errorType,
                    driverName: driverName,
                    timestamp: new Date().toISOString()
                });

                return {
                    type: errorType,
                    message: message,
                    driverName: driverName
                };
            }
        }
    },

    // Enhanced showError that supports individual drivers
    showError(elementOrDriverName, message, driverName = null) {
        // Check if first parameter is a driver name (string) rather than element
        if (typeof elementOrDriverName === 'string' && !driverName) {
            // Called as showError(driverName, message)
            return this.showIndividualDriverError(elementOrDriverName, message);
        } else {
            // Called as showError(element, message, driverName) - original format
            if (typeof ErrorHandler !== 'undefined' && ErrorHandler.showError) {
                return ErrorHandler.showError.call(this, elementOrDriverName, message, driverName);
            } else {
                // Fallback implementation
                if (elementOrDriverName && elementOrDriverName.innerHTML !== undefined) {
                    const errorHtml = `<span class="error-message fs90">${message}</span>`;
                    elementOrDriverName.innerHTML = errorHtml;
                    console.warn(`Showing error to user for driver "${driverName || 'unknown'}": ${message}`);
                }
            }
        }
    },

    // Initialize enhanced error handler
    initialize() {
        console.log('EnhancedErrorHandler: Initializing enhanced error handler with individual driver support');
        
        // Reset error statistics
        this.resetErrorStats();
        
        console.log('EnhancedErrorHandler: Enhanced error handler initialized');
    }
};

// Auto-initialize when script loads
if (typeof window !== 'undefined') {
    // Initialize on DOM ready or immediately if already loaded
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            EnhancedErrorHandler.initialize();
        });
    } else {
        EnhancedErrorHandler.initialize();
    }
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { 
        IndividualErrorHandler, 
        EnhancedErrorHandler 
    };
}