import { create } from 'zustand';

const useStore = create((set) => ({
    serverUrl: 'http://192.168.1.100:5001',
    setServerUrl: (url) => set({ serverUrl: url }),

    // Auth token sent to the backend (leave empty if AUTH_TOKEN not set on server)
    authToken: '',
    setAuthToken: (token) => set({ authToken: token }),

    isConnected: false,
    setIsConnected: (status) => set({ isConnected: status }),

    zones: { safe_zone: [] },
    setZones: (zones) => set({ zones }),

    cows: [],
    setCows: (cows) => set({ cows }),
}));

export default useStore;
