import { useEffect, useRef, useState } from 'react';
import io from 'socket.io-client';
import {
    RTCPeerConnection,
    RTCIceCandidate,
    RTCSessionDescription,
} from 'react-native-webrtc';
import useStore from '../store/useStore';

const useCattleConnection = () => {
    const { serverUrl, authToken, setIsConnected, setZones, setCows } = useStore();
    const socketRef = useRef(null);
    const pcRef = useRef(null);
    const [remoteStream, setRemoteStream] = useState(null);
    const [pcState, setPcState] = useState("new");

    // Close and clean up the current RTCPeerConnection, if any
    const closePeerConnection = () => {
        if (pcRef.current) {
            pcRef.current.close();
            pcRef.current = null;
        }
    };

    useEffect(() => {
        if (!serverUrl) return;

        // Build connection URL — append token as query param if configured
        const query = authToken ? `?token=${encodeURIComponent(authToken)}` : '';
        const socketUrl = `${serverUrl}${query}`;

        const socket = io(socketUrl, {
            transports: ['websocket', 'polling'],
            reconnectionAttempts: 5,
        });
        socketRef.current = socket;

        socket.on('connect', () => {
            console.log('Socket Connected');
            setIsConnected(true);
            // Close any stale peer connection before creating a new one
            closePeerConnection();
            startWebRTC(socket);
        });

        socket.on('disconnect', () => {
            console.log('Socket Disconnected');
            setIsConnected(false);
            setPcState("disconnected");
        });

        socket.on('zones', (data) => {
            setZones(data);
        });

        socket.on('state', (payload) => {
            if (payload.cows) setCows(payload.cows);
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

        socket.on('error', (data) => {
            console.warn('Server error:', data?.message);
        });

        return () => {
            closePeerConnection();
            socket.disconnect();
        };
    }, [serverUrl, authToken]);

    const startWebRTC = async (socket) => {
        try {
            const configuration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
            const pc = new RTCPeerConnection(configuration);
            pcRef.current = pc;

            pc.onicecandidate = (event) => {
                if (event.candidate) {
                    socket.emit('ice_candidate', event.candidate);
                }
            };

            pc.oniceconnectionstatechange = () => {
                console.log("ICE State:", pc.iceConnectionState);
                setPcState(pc.iceConnectionState);
            };

            pc.ontrack = (event) => {
                console.log('Received Remote Stream (ontrack)');
                if (event.streams && event.streams[0]) {
                    setRemoteStream(event.streams[0]);
                }
            };

            pc.addTransceiver('video', { direction: 'recvonly' });

            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            const response = await new Promise((resolve) => {
                socket.emit('offer', { sdp: offer.sdp, type: offer.type }, (ans) => {
                    resolve(ans);
                });
            });

            if (response) {
                await pc.setRemoteDescription(new RTCSessionDescription(response));
            }
        } catch (e) {
            console.error('WebRTC setup error:', e);
            setPcState("failed");
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
