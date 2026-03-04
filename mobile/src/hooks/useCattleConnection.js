import { useEffect, useRef, useState } from 'react';
import io from 'socket.io-client';
import {
    RTCPeerConnection,
    RTCIceCandidate,
    RTCSessionDescription,
    RTCView,
    mediaDevices,
} from 'react-native-webrtc';
import useStore from '../store/useStore';

const useCattleConnection = () => {
    const { serverUrl, setIsConnected, setZones, setCows } = useStore();
    const socketRef = useRef(null);
    const pcRef = useRef(null);
    const [remoteStream, setRemoteStream] = useState(null);
    const [pcState, setPcState] = useState("new");

    useEffect(() => {
        if (!serverUrl) return;

        // Initialize Socket
        const socket = io(serverUrl, {
            transports: ['websocket', 'polling'], // Allow polling as fallback
            reconnectionAttempts: 5,
        });
        socketRef.current = socket;

        socket.on('connect', () => {
            console.log('Socket Connected');
            setIsConnected(true);
            startWebRTC();
        });

        socket.on('disconnect', () => {
            console.log('Socket Disconnected');
            setIsConnected(false);
        });

        socket.on('zones', (data) => {
            setZones(data);
        });

        socket.on('state', (payload) => {
            // payload = { cows: [...], zones: ... }
            if (payload.cows) setCows(payload.cows);
            // We can optional sync zones here too or stick to explicit 'update_zone' events
        });

        socket.on('ice_candidate', async (data) => {
            try {
                const pc = pcRef.current;
                if (pc) {
                    await pc.addIceCandidate(new RTCIceCandidate(data));
                }
            } catch (e) {
                console.error('Error adding ice candidate', e);
            }
        });

        // Cleanup
        return () => {
            socket.disconnect();
            if (pcRef.current) {
                pcRef.current.close();
            }
        };
    }, [serverUrl]);

    const startWebRTC = async () => {
        const configuration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
        const pc = new RTCPeerConnection(configuration);
        pcRef.current = pc;

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                socketRef.current.emit('ice_candidate', event.candidate);
            }
        };

        pc.oniceconnectionstatechange = (event) => {
            console.log("ICE State:", pc.iceConnectionState);
            setPcState(pc.iceConnectionState);
        };

        pc.ontrack = (event) => {
            console.log('Received Remote Stream (ontrack)');
            // event.streams[0] is the MediaStream
            if (event.streams && event.streams[0]) {
                setRemoteStream(event.streams[0]);
            }
        };

        // Create Offer
        // Add transceiver to tell server we want to receive video
        pc.addTransceiver('video', { direction: 'recvonly' });

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        // waiting for server answer interaction
        const response = await new Promise((resolve) => {
            socketRef.current.emit('offer', { sdp: offer.sdp, type: offer.type }, (ans) => {
                resolve(ans);
            });
        });

        // Handle Answer
        if (response) {
            await pc.setRemoteDescription(new RTCSessionDescription(response));
        }
    };

    const updateZone = (newZones) => {
        if (socketRef.current) {
            socketRef.current.emit("update_zone", newZones);
        }
    };

    return { remoteStream, updateZone, pcState };
};

export default useCattleConnection;
