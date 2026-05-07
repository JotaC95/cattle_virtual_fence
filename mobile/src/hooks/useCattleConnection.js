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
    const {
        serverUrl,
        setIsConnected,
        setZones,
        setCows,
        setPersons,
        setFenceActive,
        setAllowedCowIds,
        addAlert,
    } = useStore();
    const socketRef = useRef(null);
    const pcRef = useRef(null);
    const [remoteStream, setRemoteStream] = useState(null);
    const [pcState, setPcState] = useState("new");

    useEffect(() => {
        if (!serverUrl) return;

        const socket = io(serverUrl, {
            transports: ['websocket', 'polling'],
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

        socket.on('fence_config', (data) => {
            setFenceActive(data.fence_active);
            setAllowedCowIds(data.allowed_ids || []);
        });

        socket.on('state', (payload) => {
            if (payload.cows) setCows(payload.cows);
            if (payload.persons) setPersons(payload.persons);
        });

        socket.on('actuator_event', (data) => addAlert(data));
        socket.on('alert', (data) => addAlert(data));

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
            if (event.streams && event.streams[0]) {
                setRemoteStream(event.streams[0]);
            }
        };

        pc.addTransceiver('video', { direction: 'recvonly' });

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        const response = await new Promise((resolve) => {
            socketRef.current.emit('offer', { sdp: offer.sdp, type: offer.type }, (ans) => {
                resolve(ans);
            });
        });

        if (response) {
            await pc.setRemoteDescription(new RTCSessionDescription(response));
        }
    };

    const updateZone = (newZones) => {
        if (socketRef.current) {
            socketRef.current.emit("update_zone", newZones);
        }
    };

    const toggleFence = () => {
        if (socketRef.current) {
            socketRef.current.emit("toggle_fence", {});
        }
    };

    const setCowException = (cowId, allowed) => {
        if (socketRef.current) {
            socketRef.current.emit("set_cow_exception", { cow_id: cowId, allowed });
        }
    };

    return { remoteStream, updateZone, pcState, toggleFence, setCowException };
};

export default useCattleConnection;
