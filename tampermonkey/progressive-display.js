// Progressive Display Manager for Concurrent Driver Loading
// Handles immediate rendering of individual driver stats as they complete

const ProgressiveDisplayManager = {
    // Driver-to-element mapping for progressive updates
    driverElementMap: new Map(),
    
    // Track completion status of individual drivers
    completionStatus: new Map(),
    
    // Track loading states for pending drivers
    loadingStates: new Map(),
    
    // Display driver stats immediately when individual request completes
    displayDriverStats(driverName, driverData) {
        if (!driverName || !driverData) {
            console.warn('ProgressiveDisplayManager.displayDriverStats: Missing required parameters');
            return false;
        }
        
        console.log(`Progressive display: Rendering stats for driver ${driverName}`);
        
        // Get all elements associated with this driver
        const elements = this.getElementsForDriver(driverName);
        
        if (elements.length === 0) {
            console.warn(`ProgressiveDisplayManager.displayDriverStats: No elements found for driver ${driverName}`);
            return false;
        }
        
        let successCount = 0;
        
        // Update all elements for this driver
        elements.forEach(element => {
            try {
                // Check if this element has driver data in the expected format
                if (driverData[driverName] && driverData[driverName].member_info) {
                    // Use existing rendering logic from main script
                    this.renderDriverStatsToElement(element, driverName, driverData[driverName]);
                    successCount++;
                } else {
                    // Handle case where driver data doesn't have expected structure
                    console.warn(`Progressive display: Invalid data structure for driver ${driverName}`);
                    this.displayDriverError(driverName, 'Stats failed to load');
                }
            } catch (error) {
                console.error(`Progressive display: Error rendering driver ${driverName}:`, error);
                this.displayDriverError(driverName, 'Stats failed to load');
            }
        });
        
        // Mark driver as completed
        this.markDriverComplete(driverName);
        
        console.log(`Progressive display: Successfully rendered ${successCount} elements for driver ${driverName}`);
        return successCount > 0;
    },
    
    // Display error message for individual driver
    displayDriverError(driverName, errorMessage) {
        if (!driverName || !errorMessage) {
            console.warn('ProgressiveDisplayManager.displayDriverError: Missing required parameters');
            return false;
        }
        
        console.log(`Progressive display: Showing error for driver ${driverName}: ${errorMessage}`);
        
        // Get all elements associated with this driver
        const elements = this.getElementsForDriver(driverName);
        
        if (elements.length === 0) {
            console.warn(`ProgressiveDisplayManager.displayDriverError: No elements found for driver ${driverName}`);
            return false;
        }
        
        let errorCount = 0;
        
        // Show error for all elements of this driver
        elements.forEach(element => {
            try {
                // Use LoadingManager to show error for this specific element
                if (typeof LoadingManager !== 'undefined' && LoadingManager.showErrorForElement) {
                    LoadingManager.showErrorForElement(element, errorMessage);
                    errorCount++;
                } else {
                    // Fallback error display
                    element.innerHTML = `<span class="error-message fs90">${errorMessage}</span>`;
                    errorCount++;
                }
            } catch (error) {
                console.error(`Progressive display: Error showing error for driver ${driverName}:`, error);
            }
        });
        
        // Mark driver as completed (with error)
        this.markDriverComplete(driverName, true);
        
        console.log(`Progressive display: Showed error for ${errorCount} elements of driver ${driverName}`);
        return errorCount > 0;
    },
    
    // Associate driver name with DOM elements
    associateDriverWithElements(driverName, elements) {
        if (!driverName) {
            console.warn('ProgressiveDisplayManager.associateDriverWithElements: Missing driver name');
            return false;
        }
        
        // Ensure elements is an array
        const elementArray = Array.isArray(elements) ? elements : [elements].filter(Boolean);
        
        if (elementArray.length === 0) {
            console.warn(`ProgressiveDisplayManager.associateDriverWithElements: No valid elements for driver ${driverName}`);
            return false;
        }
        
        // Get existing elements or create new array
        const existingElements = this.driverElementMap.get(driverName) || [];
        
        // Add new elements, avoiding duplicates
        elementArray.forEach(element => {
            if (element && !existingElements.includes(element)) {
                existingElements.push(element);
            }
        });
        
        // Update the map
        this.driverElementMap.set(driverName, existingElements);
        
        console.log(`Progressive display: Associated driver ${driverName} with ${existingElements.length} elements`);
        return true;
    },
    
    // Find all DOM elements associated with a driver
    getElementsForDriver(driverName) {
        return this.driverElementMap.get(driverName) || [];
    },
    
    // Mark driver as completed
    markDriverComplete(driverName, hasError = false) {
        this.completionStatus.set(driverName, {
            completed: true,
            hasError: hasError,
            completedAt: Date.now()
        });
        
        // Remove from loading states
        this.loadingStates.delete(driverName);
        
        console.log(`Progressive display: Marked driver ${driverName} as ${hasError ? 'completed with error' : 'completed successfully'}`);
    },
    
    // Check if driver is completed
    isDriverComplete(driverName) {
        const status = this.completionStatus.get(driverName);
        return status ? status.completed : false;
    },
    
    // Handle out-of-order completion of requests
    handleOutOfOrderCompletion(driverName, driverData, isError = false) {
        console.log(`Progressive display: Handling out-of-order completion for driver ${driverName}`);
        
        // Check if this driver was already completed
        if (this.isDriverComplete(driverName)) {
            console.log(`Progressive display: Driver ${driverName} already completed, skipping`);
            return false;
        }
        
        // Display the driver stats or error immediately
        if (isError) {
            return this.displayDriverError(driverName, driverData);
        } else {
            return this.displayDriverStats(driverName, driverData);
        }
    },
    
    // Maintain loading states for pending drivers
    maintainLoadingState(driverName, element) {
        if (!driverName || !element) {
            console.warn('ProgressiveDisplayManager.maintainLoadingState: Missing required parameters');
            return false;
        }
        
        // Don't show loading if driver is already completed
        if (this.isDriverComplete(driverName)) {
            console.log(`Progressive display: Driver ${driverName} already completed, not showing loading state`);
            return false;
        }
        
        // Track loading state
        const loadingInfo = {
            driverName: driverName,
            element: element,
            startTime: Date.now()
        };
        
        this.loadingStates.set(driverName, loadingInfo);
        
        // Use LoadingManager to show loading state
        if (typeof LoadingManager !== 'undefined' && LoadingManager.showLoading) {
            LoadingManager.showLoading(driverName, element);
        } else {
            // Fallback loading display
            element.innerHTML = '<div class="loading-spinner">Loading stats...</div>';
        }
        
        console.log(`Progressive display: Maintaining loading state for driver ${driverName}`);
        return true;
    },
    
    // Render driver stats to specific element (extracted from main rendering logic)
    renderDriverStatsToElement(element, driverName, driverData) {
        if (!element || !driverName || !driverData) {
            console.warn('ProgressiveDisplayManager.renderDriverStatsToElement: Missing required parameters');
            return false;
        }
        
        try {
            // Check if we have member_info
            if (!driverData.member_info) {
                console.warn(`Progressive display: No member_info for driver ${driverName}`);
                this.displayDriverError(driverName, 'Stats failed to load');
                return false;
            }
            
            const member = driverData.member_info;
            
            // Build driver stats HTML (simplified version of main rendering logic)
            let driver_stats = '';
            
            // Add basic member info
            if (member.display_name) {
                driver_stats += `<div class="driver-name">${member.display_name}</div>`;
            }
            
            // Add iRating if available
            if (member.irating) {
                driver_stats += `<div class="irating">iRating: ${member.irating}</div>`;
            }
            
            // Add license info if available
            if (member.license) {
                const license = member.license;
                if (license.license_level !== undefined) {
                    driver_stats += `<div class="license">License: ${license.license_level}</div>`;
                }
            }
            
            // Add member since info if available
            if (member.member_since) {
                const memberSince = new Date(member.member_since);
                const years = Math.floor((Date.now() - memberSince.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
                driver_stats += `<div class="member-since">Member: ${years} years</div>`;
            }
            
            // Create final HTML structure
            const statsHtml = `<div id="driver_infos" class="fwb fs12">${driver_stats}</div>`;
            
            // Use LoadingManager to properly replace content
            if (typeof LoadingManager !== 'undefined' && LoadingManager.hideLoadingForElement) {
                LoadingManager.hideLoadingForElement(element, statsHtml);
            } else {
                // Fallback direct replacement
                element.innerHTML = statsHtml;
            }
            
            console.log(`Progressive display: Successfully rendered stats for driver ${driverName}`);
            return true;
            
        } catch (error) {
            console.error(`Progressive display: Error rendering driver ${driverName}:`, error);
            this.displayDriverError(driverName, 'Stats failed to load');
            return false;
        }
    },
    
    // Get statistics about progressive display state
    getProgressiveStats() {
        return {
            associatedDrivers: this.driverElementMap.size,
            completedDrivers: this.completionStatus.size,
            loadingDrivers: this.loadingStates.size,
            driverElementCounts: Array.from(this.driverElementMap.entries()).map(([driver, elements]) => ({
                driver: driver,
                elementCount: elements.length
            })),
            completionDetails: Array.from(this.completionStatus.entries()).map(([driver, status]) => ({
                driver: driver,
                completed: status.completed,
                hasError: status.hasError,
                completedAt: status.completedAt
            }))
        };
    },
    
    // Clean up all progressive display state
    cleanup() {
        this.driverElementMap.clear();
        this.completionStatus.clear();
        this.loadingStates.clear();
        console.log('ProgressiveDisplayManager: Cleaned up all progressive display state');
    },
    
    // Initialize progressive display system
    initialize() {
        console.log('ProgressiveDisplayManager: Initializing progressive display system');
        
        // Clear any existing state
        this.cleanup();
        
        console.log('ProgressiveDisplayManager: Progressive display system initialized');
    }
};

// Auto-initialize when script loads
if (typeof window !== 'undefined') {
    // Initialize on DOM ready or immediately if already loaded
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            ProgressiveDisplayManager.initialize();
        });
    } else {
        ProgressiveDisplayManager.initialize();
    }
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ProgressiveDisplayManager };
}