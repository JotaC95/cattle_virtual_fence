import { create } from 'zustand';

const useStore = create((set, get) => ({
    serverUrl: 'http://192.168.1.100:5001', // LAN IP for WebRTC stability
    setServerUrl: (url) => set({ serverUrl: url }),

    isConnected: false,
    setIsConnected: (status) => set({ isConnected: status }),

    zones: { safe_zone: [] },
    setZones: (zones) => set({ zones }),

    cows: [],
    setCows: (cows) => set({ cows }),

    persons: [],
    setPersons: (persons) => set({ persons }),

    fenceActive: true,
    setFenceActive: (v) => set({ fenceActive: v }),

    allowedCowIds: [],
    setAllowedCowIds: (ids) => set({ allowedCowIds: ids }),

    alerts: [],
    addAlert: (alert) => set(state => ({
        alerts: [{ ...alert, _id: Date.now() }, ...state.alerts].slice(0, 10),
    })),
    dismissAlert: (id) => set(state => ({
        alerts: state.alerts.filter(a => a._id !== id),
    })),

    memorySummary: [],
    setMemorySummary: (items) => set({ memorySummary: items }),

    memoryResults: null,
    setMemoryResults: (results) => set({ memoryResults: results }),

    updateZone: (newZones) => {
        set({ zones: newZones });
        // Logic to actually emit socket event will be in the component or service hook
    }
}));

export default useStore;
