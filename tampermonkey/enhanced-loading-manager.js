// Enhanced Loading Manager for Individual Driver Completion
// Extends existing LoadingManager to handle progressive display and individual driver states

const EnhancedLoadingManager = {
    // Inherit from existing LoadingManager
    ...LoadingManager,
    
    // Track individual driver loading states (per driver, not per element)
    driverLoadingStates: new Map(),
    
    // Track which drivers are completed
    completedDrivers: new Set(),
    
    // Show loading indicator for individual driver (enhanced version)
    showLoadingForDriver(driverName, elements) {
        if (!driverName) {
            console.warn('EnhancedLoadingManager.showLoadingForDriver: Missing driver name');
            return false;
        }
        
        // Ensure elements is an array
        const elementArray = Array.isArray(elements) ? elements : [elements].filter(Boolean);
        
        if (elementArray.length === 0) {
            console.warn(`EnhancedLoadingManager.showLoadingForDriver: No valid elements for driver ${driverName}`);
            return false;
        }
        
        // Don't show loading if driver is already completed
        if (this.isDriverCompleted(driverName)) {
            console.log(`EnhancedLoadingManager: Driver ${driverName} already completed, not showing loading`);
            return false;
        }
        
        const startTime = Date.now();
        
        // Track driver-level loading state
        this.driverLoadingStates.set(driverName, {
            driverName: driverName,
            elements: elementArray,
            startTime: startTime,
            estimatedDuration: 10000, // 10 seconds for individual requests
            status: 'loading'
        });
        
        // Show loading for each element using original LoadingManager
        elementArray.forEach(element => {
            if (element) {
                this.showLoading(driverName, element);
            }
        });
        
        console.log(`EnhancedLoadingManager: Started loading for driver ${driverName} with ${elementArray.length} elements`);
        return true;
    },
    
    // Hide loading and show content for individual driver completion
    hideLoadingForDriver(driverName, content = null) {
        if (!driverName) {
            console.warn('EnhancedLoadingManager.hideLoadingForDriver: Missing driver name');
            return false;
        }
        
        const driverState = this.driverLoadingStates.get(driverName);
        if (!driverState) {
            console.warn(`EnhancedLoadingManager.hideLoadingForDriver: No loading state found for driver ${driverName}`);
            return false;
        }
        
        // Calculate loading time
        const loadingTime = Date.now() - driverState.startTime;
        console.log(`EnhancedLoadingManager: Completed loading for driver ${driverName} in ${loadingTime}ms`);
        
        // Hide loading for all elements of this driver
        let hiddenCount = 0;
        driverState.elements.forEach(element => {
            if (element) {
                try {
                    this.hideLoadingForElement(element, content);
                    hiddenCount++;
                } catch (error) {
                    console.error(`EnhancedLoadingManager: Error hiding loading for driver ${driverName}:`, error);
                }
            }
        });
        
        // Mark driver as completed
        this.markDriverCompleted(driverName);
        
        // Clean up driver loading state
        this.driverLoadingStates.delete(driverName);
        
        console.log(`EnhancedLoadingManager: Hidden loading for ${hiddenCount} elements of driver ${driverName}`);
        return hiddenCount > 0;
    },
    
    // Show error for individual driver
    showErrorForDriver(driverName, errorMessage) {
        if (!driverName || !errorMessage) {
            console.warn('EnhancedLoadingManager.showErrorForDriver: Missing required parameters');
            return false;
        }
        
        const driverState = this.driverLoadingStates.get(driverName);
        if (!driverState) {
            console.warn(`EnhancedLoadingManager.showErrorForDriver: No loading state found for driver ${driverName}`);
            return false;
        }
        
        // Calculate loading time
        const loadingTime = Date.now() - driverState.startTime;
        console.log(`EnhancedLoadingManager: Error for driver ${driverName} after ${loadingTime}ms: ${errorMessage}`);
        
        // Show error for all elements of this driver
        let errorCount = 0;
        driverState.elements.forEach(element => {
            if (element) {
                try {
                    this.showErrorForElement(element, errorMessage);
                    errorCount++;
                } catch (error) {
                    console.error(`EnhancedLoadingManager: Error showing error for driver ${driverName}:`, error);
                }
            }
        });
        
        // Mark driver as completed (with error)
        this.markDriverCompleted(driverName, true);
        
        // Clean up driver loading state
        this.driverLoadingStates.delete(driverName);
        
        console.log(`EnhancedLoadingManager: Showed error for ${errorCount} elements of driver ${driverName}`);
        return errorCount > 0;
    },
    
    // Mark driver as completed
    markDriverCompleted(driverName, hasError = false) {
        this.completedDrivers.add(driverName);
        
        console.log(`EnhancedLoadingManager: Marked driver ${driverName} as ${hasError ? 'completed with error' : 'completed successfully'}`);
    },
    
    // Check if driver is completed
    isDriverCompleted(driverName) {
        return this.completedDrivers.has(driverName);
    },
    
    // Check if driver is currently loading
    isDriverLoading(driverName) {
        return this.driverLoadingStates.has(driverName);
    },
    
    // Get all elements for a driver that are currently loading
    getLoadingElementsForDriver(driverName) {
        const driverState = this.driverLoadingStates.get(driverName);
        return driverState ? driverState.elements : [];
    },
    
    // Update loading states per driver instead of batch
    updateDriverLoadingState(driverName, status, progress = null) {
        const driverState = this.driverLoadingStates.get(driverName);
        if (!driverState) {
            console.warn(`EnhancedLoadingManager.updateDriverLoadingState: No loading state found for driver ${driverName}`);
            return false;
        }
        
        // Update driver status
        driverState.status = status;
        
        // Update progress if provided
        if (progress !== null && typeof progress === 'number') {
            driverState.progress = Math.min(Math.max(progress, 0), 100);
            
            // Update progress bars for all elements of this driver
            driverState.elements.forEach(element => {
                if (element) {
                    const progressBar = element.querySelector('.progress-bar');
                    if (progressBar) {
                        progressBar.style.width = driverState.progress + '%';
                    }
                }
            });
        }
        
        console.log(`EnhancedLoadingManager: Updated driver ${driverName} status to ${status}${progress !== null ? ` (${progress}%)` : ''}`);
        return true;
    },
    
    // Maintain visual consistency with current loading indicators
    createEnhancedSpinner(driverName) {
        return `
            <div class="loading-spinner" data-driver="${driverName}">
                <div class="spinner-circle"></div>
                <span class="loading-text">Loading ${driverName}...</span>
                <div class="loading-progress">
                    <div class="progress-bar"></div>
                </div>
                <div class="loading-driver-info">
                    <small class="driver-name">${driverName}</small>
                </div>
            </div>
        `;
    },
    
    // Enhanced spinner creation with driver-specific information
    createSpinner(driverName = null) {
        if (driverName) {
            return this.createEnhancedSpinner(driverName);
        }
        
        // Fall back to original spinner
        return `
            <div class="loading-spinner">
                <div class="spinner-circle"></div>
                <span class="loading-text">Loading stats...</span>
                <div class="loading-progress">
                    <div class="progress-bar"></div>
                </div>
            </div>
        `;
    },
    
    // Get enhanced loading statistics
    getEnhancedLoadingStats() {
        const originalStats = this.getLoadingStats();
        
        return {
            ...originalStats,
            driverLoadingStates: this.driverLoadingStates.size,
            completedDrivers: this.completedDrivers.size,
            loadingDrivers: Array.from(this.driverLoadingStates.keys()),
            completedDriversList: Array.from(this.completedDrivers),
            driverElementCounts: Array.from(this.driverLoadingStates.entries()).map(([driver, state]) => ({
                driver: driver,
                elementCount: state.elements.length,
                status: state.status,
                loadingTime: Date.now() - state.startTime
            }))
        };
    },
    
    // Enhanced cleanup that handles both individual and batch states
    cleanup() {
        // Clean up driver-specific states
        this.driverLoadingStates.clear();
        this.completedDrivers.clear();
        
        // Call original cleanup
        if (typeof LoadingManager !== 'undefined' && LoadingManager.cleanup) {
            LoadingManager.cleanup.call(this);
        } else {
            // Fallback cleanup
            this.loadingStates.forEach((state, loadingId) => {
                if (state.progressInterval) {
                    clearInterval(state.progressInterval);
                }
            });
            this.loadingStates.clear();
        }
        
        console.log('EnhancedLoadingManager: Cleaned up all loading states (individual and batch)');
    },
    
    // Initialize enhanced loading manager
    initialize() {
        console.log('EnhancedLoadingManager: Initializing enhanced loading manager');
        
        // Clear any existing state
        this.cleanup();
        
        console.log('EnhancedLoadingManager: Enhanced loading manager initialized');
    },
    
    // Batch completion handler for backward compatibility
    handleBatchCompletion(driverResults) {
        if (!driverResults || typeof driverResults !== 'object') {
            console.warn('EnhancedLoadingManager.handleBatchCompletion: Invalid driver results');
            return false;
        }
        
        let handledCount = 0;
        
        // Handle each driver result individually
        Object.keys(driverResults).forEach(driverName => {
            const driverData = driverResults[driverName];
            
            if (driverData && driverData.error) {
                // Handle error case
                this.showErrorForDriver(driverName, driverData.errorMessage || 'Stats failed to load');
            } else if (driverData) {
                // Handle success case - create wrapper object for compatibility
                const wrappedData = { [driverName]: driverData };
                this.hideLoadingForDriver(driverName, this.createDriverStatsHtml(driverName, driverData));
            }
            
            handledCount++;
        });
        
        console.log(`EnhancedLoadingManager: Handled batch completion for ${handledCount} drivers`);
        return handledCount > 0;
    },
    
    // Create driver stats HTML (simplified version for loading manager)
    createDriverStatsHtml(driverName, driverData) {
        if (!driverData || !driverData.member_info) {
            return `<span class="error-message fs90">Stats failed to load</span>`;
        }
        
        const member = driverData.member_info;
        let stats = '';
        
        if (member.display_name) {
            stats += `<div class="driver-name">${member.display_name}</div>`;
        }
        
        if (member.irating) {
            stats += `<div class="irating">iRating: ${member.irating}</div>`;
        }
        
        return `<div id="driver_infos" class="fwb fs12">${stats}</div>`;
    }
};

// Auto-initialize when script loads
if (typeof window !== 'undefined') {
    // Initialize on DOM ready or immediately if already loaded
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            EnhancedLoadingManager.initialize();
        });
    } else {
        EnhancedLoadingManager.initialize();
    }
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { EnhancedLoadingManager };
}