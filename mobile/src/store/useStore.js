import { create } from 'zustand';

const useStore = create((set, get) => ({
    serverUrl: 'http://192.168.0.190:5001', // LAN IP for WebRTC stability
    setServerUrl: (url) => set({ serverUrl: url }),

    isConnected: false,
    setIsConnected: (status) => set({ isConnected: status }),

    zones: { safe_zone: [] },
    setZones: (zones) => set({ zones }),

    isEditing: false,
    setIsEditing: (status) => set({ isEditing: status }),

    targetClass: [19, 18], // Default to both Cow (19) and Sheep (18)
    setTargetClass: (classes) => set({ targetClass: classes }),

    cows: [],
    setCows: (cows) => set({ cows }),

    updateZone: (newZones) => {
        set({ zones: newZones });
        // Logic to actually emit socket event will be in the component or service hook
    }
}));

export default useStore;
