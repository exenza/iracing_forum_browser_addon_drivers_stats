// Progressive Display Integration
// Integrates ProgressiveDisplayManager with ConcurrentRequestManager and EnhancedLoadingManager

const ProgressiveIntegration = {
    // Initialize the progressive display system
    initialize() {
        console.log('ProgressiveIntegration: Initializing progressive display integration');
        
        // Ensure all required components are available
        if (typeof ProgressiveDisplayManager === 'undefined') {
            console.error('ProgressiveIntegration: ProgressiveDisplayManager not available');
            return false;
        }
        
        if (typeof EnhancedLoadingManager === 'undefined') {
            console.error('ProgressiveIntegration: EnhancedLoadingManager not available');
            return false;
        }
        
        if (typeof ConcurrentRequestManager === 'undefined') {
            console.error('ProgressiveIntegration: ConcurrentRequestManager not available');
            return false;
        }
        
        // Initialize all components
        ProgressiveDisplayManager.initialize();
        EnhancedLoadingManager.initialize();
        
        console.log('ProgressiveIntegration: Progressive display integration initialized');
        return true;
    },
    
    // Enhanced concurrent fetch with progressive display
    async fetchDriversWithProgressiveDisplay(driverNames, driverElementMap) {
        if (!Array.isArray(driverNames) || driverNames.length === 0) {
            console.warn('ProgressiveIntegration.fetchDriversWithProgressiveDisplay: Invalid driver names');
            return {};
        }
        
        console.log(`ProgressiveIntegration: Starting progressive fetch for ${driverNames.length} drivers`);
        
        // Associate drivers with their elements for progressive display
        if (driverElementMap && typeof driverElementMap === 'object') {
            Object.keys(driverElementMap).forEach(driverName => {
                const elements = driverElementMap[driverName];
                if (elements) {
                    ProgressiveDisplayManager.associateDriverWithElements(driverName, elements);
                    EnhancedLoadingManager.showLoadingForDriver(driverName, elements);
                }
            });
        }
        
        // Create individual request promises with progressive handling
        const requestPromises = driverNames.map(driverName => 
            this.createProgressiveRequest(driverName)
        );
        
        // Use Promise.allSettled to handle individual completions
        const results = await Promise.allSettled(requestPromises);
        
        // Process results and handle any remaining errors
        const combinedData = {};
        
        results.forEach((result, index) => {
            const driverName = driverNames[index];
            
            if (result.status === 'fulfilled') {
                // Success case - data should already be displayed progressively
                if (result.value && typeof result.value === 'object') {
                    Object.assign(combinedData, result.value);
                }
            } else {
                // Error case - show error if not already handled
                const error = result.reason;
                if (!ProgressiveDisplayManager.isDriverComplete(driverName)) {
                    const errorMessage = this.getErrorMessage(error);
                    ProgressiveDisplayManager.displayDriverError(driverName, errorMessage);
                }
                
                combinedData[driverName] = {
                    error: true,
                    errorType: this.categorizeError(error),
                    errorMessage: this.getErrorMessage(error),
                    driverName: driverName
                };
            }
        });
        
        console.log(`ProgressiveIntegration: Progressive fetch completed for ${driverNames.length} drivers`);
        return combinedData;
    },
    
    // Create a progressive request that displays results immediately
    async createProgressiveRequest(driverName) {
        try {
            console.log(`ProgressiveIntegration: Starting progressive request for driver ${driverName}`);
            
            // Make the individual request using ConcurrentRequestManager
            const result = await ConcurrentRequestManager.createManagedRequest(driverName);
            
            // Display the result immediately (progressive display)
            if (result && typeof result === 'object') {
                // Handle successful response
                const success = ProgressiveDisplayManager.displayDriverStats(driverName, result);
                
                if (success) {
                    console.log(`ProgressiveIntegration: Successfully displayed progressive result for driver ${driverName}`);
                } else {
                    console.warn(`ProgressiveIntegration: Failed to display progressive result for driver ${driverName}`);
                    // Show error if display failed
                    ProgressiveDisplayManager.displayDriverError(driverName, 'Stats failed to display');
                }
            } else {
                // Invalid response format
                console.warn(`ProgressiveIntegration: Invalid response format for driver ${driverName}`);
                ProgressiveDisplayManager.displayDriverError(driverName, 'Invalid response format');
            }
            
            return result;
            
        } catch (error) {
            console.error(`ProgressiveIntegration: Error in progressive request for driver ${driverName}:`, error);
            
            // Display error immediately
            const errorMessage = this.getErrorMessage(error);
            ProgressiveDisplayManager.displayDriverError(driverName, errorMessage);
            
            // Re-throw for Promise.allSettled handling
            throw error;
        }
    },
    
    // Handle out-of-order completion with proper state management
    handleOutOfOrderCompletion(driverName, driverData, isError = false) {
        console.log(`ProgressiveIntegration: Handling out-of-order completion for driver ${driverName}`);
        
        // Use ProgressiveDisplayManager to handle the completion
        const handled = ProgressiveDisplayManager.handleOutOfOrderCompletion(driverName, driverData, isError);
        
        if (handled) {
            // Update EnhancedLoadingManager state
            if (isError) {
                EnhancedLoadingManager.showErrorForDriver(driverName, driverData);
            } else {
                EnhancedLoadingManager.hideLoadingForDriver(driverName);
            }
        }
        
        return handled;
    },
    
    // Associate driver with elements and start loading
    startProgressiveLoading(driverName, elements) {
        if (!driverName || !elements) {
            console.warn('ProgressiveIntegration.startProgressiveLoading: Missing required parameters');
            return false;
        }
        
        // Associate driver with elements
        const associated = ProgressiveDisplayManager.associateDriverWithElements(driverName, elements);
        
        if (associated) {
            // Start loading state
            const loadingStarted = EnhancedLoadingManager.showLoadingForDriver(driverName, elements);
            
            if (loadingStarted) {
                console.log(`ProgressiveIntegration: Started progressive loading for driver ${driverName}`);
                return true;
            }
        }
        
        console.warn(`ProgressiveIntegration: Failed to start progressive loading for driver ${driverName}`);
        return false;
    },
    
    // Complete progressive loading for a driver
    completeProgressiveLoading(driverName, driverData, isError = false) {
        if (!driverName) {
            console.warn('ProgressiveIntegration.completeProgressiveLoading: Missing driver name');
            return false;
        }
        
        console.log(`ProgressiveIntegration: Completing progressive loading for driver ${driverName}`);
        
        let success = false;
        
        if (isError) {
            // Handle error completion
            success = ProgressiveDisplayManager.displayDriverError(driverName, driverData);
            if (success) {
                EnhancedLoadingManager.showErrorForDriver(driverName, driverData);
            }
        } else {
            // Handle successful completion
            success = ProgressiveDisplayManager.displayDriverStats(driverName, driverData);
            if (success) {
                EnhancedLoadingManager.hideLoadingForDriver(driverName);
            }
        }
        
        if (success) {
            console.log(`ProgressiveIntegration: Successfully completed progressive loading for driver ${driverName}`);
        } else {
            console.warn(`ProgressiveIntegration: Failed to complete progressive loading for driver ${driverName}`);
        }
        
        return success;
    },
    
    // Get comprehensive progressive display statistics
    getProgressiveStats() {
        const progressiveStats = ProgressiveDisplayManager.getProgressiveStats();
        const loadingStats = EnhancedLoadingManager.getEnhancedLoadingStats();
        const concurrentStats = ConcurrentRequestManager.getRequestStats();
        
        return {
            progressive: progressiveStats,
            loading: loadingStats,
            concurrent: concurrentStats,
            integration: {
                totalDrivers: progressiveStats.associatedDrivers,
                completedDrivers: progressiveStats.completedDrivers,
                loadingDrivers: loadingStats.driverLoadingStates,
                activeRequests: concurrentStats.activeRequests
            }
        };
    },
    
    // Error categorization (shared with ConcurrentRequestManager)
    categorizeError(error) {
        if (!error) {
            return 'unknown';
        }
        
        // Network-related errors
        if (error.name === 'TypeError' && error.message && error.message.includes('fetch')) {
            return 'network';
        }
        
        // Timeout errors
        if (error.name === 'AbortError' || (error.message && error.message.includes('timeout'))) {
            return 'timeout';
        }
        
        // HTTP errors (API errors)
        if (error.status && (error.status >= 400 && error.status < 600)) {
            return 'api';
        }
        
        // Data parsing errors
        if (error instanceof SyntaxError || (error.message && error.message.includes('JSON'))) {
            return 'data';
        }
        
        // Default to API error for unknown errors
        return 'api';
    },
    
    // Get user-friendly error message
    getErrorMessage(error) {
        const errorType = this.categorizeError(error);
        
        const messages = {
            network: 'Stats unavailable - network error',
            api: 'Stats unavailable - API error',
            data: 'Stats failed to load',
            timeout: 'Stats unavailable - timeout',
            unknown: 'Unable to load stats'
        };
        
        return messages[errorType] || messages.unknown;
    },
    
    // Clean up all progressive display components
    cleanup() {
        console.log('ProgressiveIntegration: Cleaning up progressive display integration');
        
        if (typeof ProgressiveDisplayManager !== 'undefined') {
            ProgressiveDisplayManager.cleanup();
        }
        
        if (typeof EnhancedLoadingManager !== 'undefined') {
            EnhancedLoadingManager.cleanup();
        }
        
        console.log('ProgressiveIntegration: Progressive display integration cleaned up');
    }
};

// Auto-initialize when script loads
if (typeof window !== 'undefined') {
    // Initialize on DOM ready or immediately if already loaded
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            ProgressiveIntegration.initialize();
        });
    } else {
        ProgressiveIntegration.initialize();
    }
    
    // Register cleanup on page unload
    window.addEventListener('beforeunload', () => {
        ProgressiveIntegration.cleanup();
    });
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ProgressiveIntegration };
}