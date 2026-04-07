import React, { useState, useRef, useCallback } from 'react';
import {
    View, Text, TouchableOpacity, Dimensions, StatusBar,
    PanResponder, TextInput, KeyboardAvoidingView, Platform, Modal,
} from 'react-native';
import { RTCView } from 'react-native-webrtc';
import Svg, { Polygon, Rect, Text as SvgText } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import useCattleConnection from '../hooks/useCattleConnection';
import useStore from '../store/useStore';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// Backend video resolution
const VIDEO_WIDTH = 640;
const VIDEO_HEIGHT = 480;

/**
 * DraggablePoint — uses a callback ref so onMove is never stale.
 */
const DraggablePoint = ({ x, y, onMove }) => {
    // Keep latest onMove in a ref to avoid stale closure inside PanResponder
    const onMoveRef = useRef(onMove);
    onMoveRef.current = onMove;

    const panResponder = useRef(
        PanResponder.create({
            onStartShouldSetPanResponder: () => true,
            onPanResponderMove: (evt) => {
                onMoveRef.current(evt.nativeEvent.pageX, evt.nativeEvent.pageY);
            },
            onPanResponderRelease: (evt) => {
                onMoveRef.current(evt.nativeEvent.pageX, evt.nativeEvent.pageY);
            },
        })
    ).current;

    return (
        <View
            {...panResponder.panHandlers}
            style={{
                position: 'absolute',
                left: x - 25,
                top: y - 25,
                width: 50,
                height: 50,
                justifyContent: 'center',
                alignItems: 'center',
            }}
        >
            <View className="w-6 h-6 rounded-full bg-cyan-400 border-[3px] border-white shadow-xl" />
        </View>
    );
};

const MonitorScreen = () => {
    const insets = useSafeAreaInsets();
    const { remoteStream, pcState, updateZone } = useCattleConnection();
    const { zones, cows, isConnected, serverUrl, authToken, setServerUrl, setAuthToken } = useStore();

    const [editMode, setEditMode] = useState(false);
    const [editablePoints, setEditablePoints] = useState([]);
    const [showSettings, setShowSettings] = useState(false);
    const [draftUrl, setDraftUrl] = useState(serverUrl);
    const [draftToken, setDraftToken] = useState(authToken);

    // Scale to fill screen (cover)
    const scale = Math.max(SCREEN_WIDTH / VIDEO_WIDTH, SCREEN_HEIGHT / VIDEO_HEIGHT);
    const translateX = (SCREEN_WIDTH - VIDEO_WIDTH * scale) / 2;
    const translateY = (SCREEN_HEIGHT - VIDEO_HEIGHT * scale) / 2;

    const toggleEditMode = () => {
        if (!editMode) {
            if (zones.safe_zone && zones.safe_zone.length > 2) {
                setEditablePoints([...zones.safe_zone]);
            } else {
                setEditablePoints([
                    { x: 100, y: 100 },
                    { x: VIDEO_WIDTH - 100, y: 100 },
                    { x: VIDEO_WIDTH - 100, y: VIDEO_HEIGHT - 100 },
                    { x: 100, y: VIDEO_HEIGHT - 100 },
                ]);
            }
            setEditMode(true);
        } else {
            updateZone({ safe_zone: editablePoints });
            setEditMode(false);
        }
    };

    const handlePointMove = useCallback((index, screenX, screenY) => {
        const backendX = (screenX - translateX) / scale;
        const backendY = (screenY - translateY) / scale;
        setEditablePoints((prev) => {
            const next = [...prev];
            next[index] = {
                x: Math.round(Math.max(0, Math.min(VIDEO_WIDTH, backendX))),
                y: Math.round(Math.max(0, Math.min(VIDEO_HEIGHT, backendY))),
            };
            return next;
        });
    }, [scale, translateX, translateY]);

    const getColor = (status) => {
        switch (status) {
            case 'INTERNAL': return '#4ade80';
            case 'WARNING':  return '#facc15';
            case 'OUT':      return '#ef4444';
            default:         return '#ffffff';
        }
    };

    const pointsToSvgPoints = (points) => {
        if (!points) return "";
        return points.map(p => {
            const x = p.x * scale + translateX;
            const y = p.y * scale + translateY;
            return `${x},${y}`;
        }).join(' ');
    };

    // Stats — consistent: WARNING cows are NOT counted as secure
    const totalCows   = cows.length;
    const warningCows = cows.filter(c => c.status === 'WARNING').length;
    const outCows     = cows.filter(c => c.status === 'OUT').length;
    const secureCows  = totalCows - warningCows - outCows;
    const safetyScore = totalCows > 0
        ? Math.round((secureCows / totalCows) * 100)
        : 100;

    const saveSettings = () => {
        setServerUrl(draftUrl.trim());
        setAuthToken(draftToken.trim());
        setShowSettings(false);
    };

    return (
        <View className="flex-1 bg-gray-900 relative">
            <StatusBar barStyle="light-content" />

            {/* 1. Video Layer */}
            <View className="absolute inset-0 w-full h-full overflow-hidden">
                {remoteStream ? (
                    <RTCView
                        streamURL={remoteStream.toURL()}
                        style={{ width: SCREEN_WIDTH, height: SCREEN_HEIGHT }}
                        objectFit="cover"
                        zOrder={0}
                    />
                ) : (
                    <View className="flex-1 justify-center items-center bg-gray-900">
                        <View className="w-16 h-16 rounded-full border-4 border-gray-700 border-t-blue-500 mb-4" />
                        <Text className="text-gray-400 font-medium tracking-widest text-xs uppercase">
                            Establishing Uplink...
                        </Text>
                        <Text className="text-gray-600 text-[10px] mt-2">
                            {isConnected ? "Signaling Connected" : "Searching for Base Station..."}
                        </Text>
                    </View>
                )}
            </View>

            {/* 2. AR Overlay (SVG) */}
            <View className="absolute inset-0" pointerEvents="none">
                <Svg height="100%" width="100%">
                    {(editMode ? editablePoints.length > 0 : (zones.safe_zone && zones.safe_zone.length > 0)) && (
                        <Polygon
                            points={pointsToSvgPoints(editMode ? editablePoints : zones.safe_zone)}
                            fill="rgba(16, 185, 129, 0.15)"
                            stroke={editMode ? "#22d3ee" : "#10b981"}
                            strokeWidth={editMode ? "3" : "2"}
                            strokeDasharray={editMode ? "10, 5" : ""}
                        />
                    )}

                    {cows.map(cow => {
                        const x = cow.bbox[0] * scale + translateX;
                        const y = cow.bbox[1] * scale + translateY;
                        const w = (cow.bbox[2] - cow.bbox[0]) * scale;
                        const h = (cow.bbox[3] - cow.bbox[1]) * scale;
                        const color = getColor(cow.status);
                        return (
                            <React.Fragment key={cow.id}>
                                <Rect x={x} y={y} width={w} height={h}
                                    fill="transparent" stroke={color} strokeWidth="2" />
                                <Rect x={x} y={y - 20} width={60} height={20}
                                    fill={color} opacity={0.8} />
                                <SvgText x={x + 5} y={y - 6}
                                    fill="black" fontSize="12" fontWeight="bold">
                                    ID {cow.id}
                                </SvgText>
                            </React.Fragment>
                        );
                    })}
                </Svg>
            </View>

            {/* 3. Draggable handles (edit mode) */}
            {editMode && (
                <View className="absolute inset-0" pointerEvents="box-none">
                    {editablePoints.map((point, index) => {
                        const screenX = point.x * scale + translateX;
                        const screenY = point.y * scale + translateY;
                        return (
                            <DraggablePoint
                                key={index}
                                x={screenX}
                                y={screenY}
                                onMove={(x, y) => handlePointMove(index, x, y)}
                            />
                        );
                    })}
                </View>
            )}

            {/* 4. UI Layer */}
            <View className="flex-1" pointerEvents="box-none"
                style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}>

                {/* Header */}
                <View className="flex-row justify-between items-center px-6 py-4">
                    <View>
                        <Text className="text-white font-black text-xl italic tracking-tighter">
                            CATTLE<Text className="text-blue-500">GUARD</Text>
                        </Text>
                        <View className="flex-row items-center mt-1">
                            <View className={`w-2 h-2 rounded-full mr-2 ${pcState === 'connected' ? 'bg-green-500' : 'bg-red-500'}`} />
                            <Text className="text-gray-400 text-[10px] uppercase font-bold">
                                {pcState === 'connected' ? 'LIVE FEED' : pcState.toUpperCase()}
                            </Text>
                        </View>
                    </View>

                    <View className="flex-row items-center">
                        {/* Safety pill */}
                        <View className="bg-gray-800/80 px-3 py-1.5 rounded-full border border-gray-700 flex-row items-center mr-3">
                            <Text className="text-gray-400 text-xs mr-2 font-bold">SAFETY</Text>
                            <Text className={`text-xs font-black ${safetyScore === 100 ? 'text-green-400' : safetyScore >= 75 ? 'text-yellow-400' : 'text-red-400'}`}>
                                {safetyScore}%
                            </Text>
                        </View>
                        {/* Settings button */}
                        <TouchableOpacity
                            pointerEvents="auto"
                            onPress={() => {
                                setDraftUrl(serverUrl);
                                setDraftToken(authToken);
                                setShowSettings(true);
                            }}
                            className="bg-gray-800/80 w-9 h-9 rounded-full border border-gray-700 items-center justify-center"
                        >
                            <Text className="text-gray-300 text-base">⚙</Text>
                        </TouchableOpacity>
                    </View>
                </View>

                <View className="flex-1" />

                {/* Bottom Deck */}
                <View className="px-6 mb-4">
                    <View className="bg-gray-900/90 rounded-3xl p-5 border border-gray-800 shadow-2xl">
                        <View className="flex-row justify-between mb-6">
                            <View className="items-center">
                                <Text className="text-gray-500 text-[10px] uppercase font-bold mb-1">Total Head</Text>
                                <Text className="text-white text-2xl font-light">{totalCows}</Text>
                            </View>
                            <View className="items-center">
                                <Text className="text-gray-500 text-[10px] uppercase font-bold mb-1">Secure</Text>
                                <Text className="text-green-400 text-2xl font-light">{secureCows}</Text>
                            </View>
                            <View className="items-center">
                                <Text className="text-gray-500 text-[10px] uppercase font-bold mb-1">Breach</Text>
                                <Text className="text-red-500 text-2xl font-light">{outCows}</Text>
                            </View>
                        </View>

                        <TouchableOpacity
                            pointerEvents="auto"
                            onPress={toggleEditMode}
                            className={`flex-1 py-4 rounded-2xl items-center justify-center border-b-4 active:border-b-0 active:mt-1 ${
                                editMode ? 'bg-cyan-600 border-cyan-800' : 'bg-indigo-600 border-indigo-800'
                            }`}
                        >
                            <Text className="text-white font-bold tracking-wider text-sm">
                                {editMode ? 'SAVE CONFIG' : 'EDIT FENCE'}
                            </Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </View>

            {/* Settings Modal */}
            <Modal visible={showSettings} transparent animationType="slide">
                <KeyboardAvoidingView
                    behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                    className="flex-1 justify-end"
                >
                    <View className="bg-gray-900 border-t border-gray-700 rounded-t-3xl p-6"
                        style={{ paddingBottom: insets.bottom + 16 }}>
                        <Text className="text-white font-bold text-lg mb-5">Connection Settings</Text>

                        <Text className="text-gray-400 text-xs mb-1 uppercase font-bold">Server URL</Text>
                        <TextInput
                            value={draftUrl}
                            onChangeText={setDraftUrl}
                            placeholder="http://192.168.1.100:5001"
                            placeholderTextColor="#4b5563"
                            autoCapitalize="none"
                            autoCorrect={false}
                            keyboardType="url"
                            className="bg-gray-800 text-white px-4 py-3 rounded-xl mb-4 text-sm border border-gray-700"
                        />

                        <Text className="text-gray-400 text-xs mb-1 uppercase font-bold">
                            Auth Token <Text className="text-gray-600">(leave empty if not required)</Text>
                        </Text>
                        <TextInput
                            value={draftToken}
                            onChangeText={setDraftToken}
                            placeholder="your-secret-token"
                            placeholderTextColor="#4b5563"
                            autoCapitalize="none"
                            autoCorrect={false}
                            secureTextEntry
                            className="bg-gray-800 text-white px-4 py-3 rounded-xl mb-6 text-sm border border-gray-700"
                        />

                        <View className="flex-row space-x-3">
                            <TouchableOpacity
                                onPress={() => setShowSettings(false)}
                                className="flex-1 py-4 rounded-2xl items-center bg-gray-800 border border-gray-700"
                            >
                                <Text className="text-gray-400 font-bold">Cancel</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                onPress={saveSettings}
                                className="flex-1 py-4 rounded-2xl items-center bg-indigo-600 border-b-4 border-indigo-800"
                            >
                                <Text className="text-white font-bold">Connect</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </KeyboardAvoidingView>
            </Modal>
        </View>
    );
};

export default MonitorScreen;
