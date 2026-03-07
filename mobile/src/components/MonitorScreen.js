import React, { useState, useRef, useEffect } from 'react';
import { View, Text, TouchableOpacity, Dimensions, StatusBar, Platform, PanResponder, Vibration } from 'react-native';
import { RTCView } from 'react-native-webrtc';
import Svg, { Polygon, Rect, Text as SvgText, Circle, Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import useCattleConnection from '../hooks/useCattleConnection';
import useStore from '../store/useStore';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// Mock dimensions of the backend video for scaling
const VIDEO_WIDTH = 640;
const VIDEO_HEIGHT = 480;

const DraggablePoint = ({ x, y, onMove }) => {
    const panResponder = useRef(
        PanResponder.create({
            onStartShouldSetPanResponder: () => true,
            onPanResponderMove: (evt) => {
                onMove(evt.nativeEvent.pageX, evt.nativeEvent.pageY);
            },
            onPanResponderRelease: (evt) => {
                onMove(evt.nativeEvent.pageX, evt.nativeEvent.pageY);
            }
        })
    ).current;

    return (
        <View
            {...panResponder.panHandlers}
            style={{
                position: 'absolute',
                left: x - 35, // Increased touch target
                top: y - 35,
                width: 70,
                height: 70,
                justifyContent: 'center',
                alignItems: 'center',
                zIndex: 10,
            }}
        >
            <View className="w-8 h-8 rounded-full bg-cyan-400 border-[4px] border-white shadow-xl opacity-90" />
        </View>
    );
};

const MonitorScreen = () => {
    const insets = useSafeAreaInsets();
    const { remoteStream, pcState, updateZone, updateTargets } = useCattleConnection();
    const { zones, cows, isConnected, setIsEditing, targetClass, setTargetClass } = useStore();
    const [editMode, setEditMode] = useState(false);
    const [editablePoints, setEditablePoints] = useState([]);

    // Trigger vibration if there is an OUT breach
    useEffect(() => {
        const hasBreach = cows.some(c => c.status === 'OUT');
        if (hasBreach) {
            // Vibrate pattern: 500ms on, 500ms off, 500ms on
            Vibration.vibrate([0, 500, 500, 500]);
        }
    }, [cows]);

    // Calculate scaling for 'contain' instead of 'cover'
    // This ensures no part of the video is cropped out.
    const scale = Math.min(SCREEN_WIDTH / VIDEO_WIDTH, SCREEN_HEIGHT / VIDEO_HEIGHT);

    // Center the video within the screen bounds
    const translateX = (SCREEN_WIDTH - VIDEO_WIDTH * scale) / 2;
    const translateY = (SCREEN_HEIGHT - VIDEO_HEIGHT * scale) / 2;

    const toggleEditMode = () => {
        if (!editMode) {
            if (zones.safe_zone && zones.safe_zone.length > 2) {
                // Backend provides relative points, convert to standard reference dimensions (e.g. 640x480) 
                // for the editable logic which handles physical coordinates.
                const absolutePoints = zones.safe_zone.map(p => ({
                    x: p.x <= 1.5 ? p.x * VIDEO_WIDTH : p.x,
                    y: p.y <= 1.5 ? p.y * VIDEO_HEIGHT : p.y
                }));
                setEditablePoints(absolutePoints);
            } else {
                setEditablePoints([
                    { x: 100, y: 100 },
                    { x: VIDEO_WIDTH - 100, y: 100 },
                    { x: VIDEO_WIDTH - 100, y: VIDEO_HEIGHT - 100 },
                    { x: 100, y: VIDEO_HEIGHT - 100 }
                ]);
            }
            setEditMode(true);
            setIsEditing(true);
        } else {
            // Only save if it's a valid polygon (at least 3 points) or empty
            if (editablePoints.length === 0 || editablePoints.length > 2) {
                // Convert to relative before saving
                const relativePoints = editablePoints.map(p => ({
                    x: Number((p.x / VIDEO_WIDTH).toFixed(4)),
                    y: Number((p.y / VIDEO_HEIGHT).toFixed(4))
                }));
                updateZone({ safe_zone: relativePoints });
                setEditMode(false);
                setIsEditing(false);
            } else {
                alert("A fence must have at least 3 points, or be completely clear.");
            }
        }
    };

    const addNode = () => {
        // Add a node roughly in the middle of the screen
        const newPoint = {
            x: Math.round(VIDEO_WIDTH / 2),
            y: Math.round(VIDEO_HEIGHT / 2)
        };
        setEditablePoints([...editablePoints, newPoint]);
    };

    const clearFence = () => {
        setEditablePoints([]);
    };

    const handlePointMove = (index, screenX, screenY) => {
        const backendX = (screenX - translateX) / scale;
        const backendY = (screenY - translateY) / scale;

        const newPoints = [...editablePoints];
        newPoints[index] = {
            x: Math.round(Math.max(0, Math.min(VIDEO_WIDTH, backendX))),
            y: Math.round(Math.max(0, Math.min(VIDEO_HEIGHT, backendY)))
        };
        setEditablePoints(newPoints);
    };

    const getColor = (status) => {
        switch (status) {
            case 'INTERNAL': return '#4ade80'; // green-400
            case 'WARNING': return '#facc15'; // yellow-400
            case 'OUT': return '#ef4444'; // red-500
            default: return '#ffffff';
        }
    };

    const pointsToSvgPoints = (points) => {
        if (!points) return "";
        return points.map(p => {
            // Check if point is relative or absolute (legacy). 
            // In display time, we convert backend's (which are relative) to screen space
            const rawX = p.x <= 1.5 ? p.x * VIDEO_WIDTH : p.x;
            const rawY = p.y <= 1.5 ? p.y * VIDEO_HEIGHT : p.y;
            const x = rawX * scale + translateX;
            const y = rawY * scale + translateY;
            return `${x},${y}`;
        }).join(' ');
    };

    const handleFilterChange = (filterType) => {
        let newClasses = [];
        if (filterType === 'COW') newClasses = [19];
        else if (filterType === 'SHEEP') newClasses = [18];
        else newClasses = [19, 18]; // BOTH

        setTargetClass(newClasses);
        updateTargets(newClasses);
    };

    // Calculate Stats
    const totalCows = cows.length;
    const warningCows = cows.filter(c => c.status === 'WARNING').length;
    const outCows = cows.filter(c => c.status === 'OUT').length;
    const safetyScore = totalCows > 0 ? Math.round(((totalCows - outCows) / totalCows) * 100) : 100;

    return (
        <View className="flex-1 bg-gray-900 relative">
            <StatusBar barStyle="light-content" />

            {/* 1. Video Layer */}
            <View className="absolute inset-0 w-full h-full overflow-hidden">
                {remoteStream ? (
                    <RTCView
                        streamURL={remoteStream.toURL()}
                        style={{ width: SCREEN_WIDTH, height: SCREEN_HEIGHT }}
                        objectFit="contain"
                        zOrder={0}
                    />
                ) : (
                    <View className="flex-1 justify-center items-center bg-gray-900">
                        <View className="w-16 h-16 rounded-full border-4 border-gray-700 border-t-blue-500 animate-spin mb-4" />
                        <Text className="text-gray-400 font-medium tracking-widest text-xs uppercase">
                            Establishing Uplink...
                        </Text>
                        <Text className="text-gray-600 text-[10px] mt-2">
                            {isConnected ? "Signaling Connected" : "Searching for Base Station..."}
                        </Text>
                    </View>
                )}
            </View>

            {/* 2. Augmented Reality Overlay (SVG) */}
            <View className="absolute inset-0" pointerEvents="none">
                <Svg height="100%" width="100%">
                    {/* Safe Zone */}
                    {(editMode ? editablePoints.length > 0 : (zones.safe_zone && zones.safe_zone.length > 0)) && (
                        <Polygon
                            points={pointsToSvgPoints(editMode ? editablePoints : zones.safe_zone)}
                            fill="rgba(16, 185, 129, 0.15)" // Emerald
                            stroke={editMode ? "#22d3ee" : "#10b981"} // Cyan or Emerald
                            strokeWidth={editMode ? "3" : "2"}
                            strokeDasharray={editMode ? "10, 5" : ""}
                        />
                    )}

                    {/* Cow Targets */}
                    {cows.map(cow => {
                        const x = cow.bbox[0] * scale + translateX;
                        const y = cow.bbox[1] * scale + translateY;
                        const w = (cow.bbox[2] - cow.bbox[0]) * scale;
                        const h = (cow.bbox[3] - cow.bbox[1]) * scale;
                        const color = getColor(cow.status);

                        return (
                            <React.Fragment key={cow.id}>
                                {/* Corner Brackets Look */}
                                <Rect
                                    x={x} y={y} width={w} height={h}
                                    fill="transparent"
                                    stroke={color}
                                    strokeWidth="2"
                                />
                                {/* Label Tag */}
                                <Rect
                                    x={x} y={y - 20} width={60} height={20}
                                    fill={color}
                                    opacity={0.8}
                                />
                                <SvgText
                                    x={x + 5}
                                    y={y - 6}
                                    fill="black"
                                    fontSize="12"
                                    fontWeight="bold"
                                >
                                    ID {cow.id}
                                </SvgText>
                            </React.Fragment>
                        );
                    })}
                </Svg>
            </View>

            {/* Draggable Handles for Edit Mode */}
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

            {/* 3. UI Layer (Controls) */}
            <View className="flex-1" pointerEvents="box-none" style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}>

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

                    {/* Mini Stats Pill */}
                    <View className="bg-gray-800/80 px-3 py-1.5 rounded-full border border-gray-700 flex-row items-center backdrop-blur-md">
                        <Text className="text-gray-400 text-xs mr-2 font-bold">SAFETY</Text>
                        <Text className={`text-xs font-black ${safetyScore === 100 ? 'text-green-400' : 'text-yellow-400'}`}>
                            {safetyScore}%
                        </Text>
                    </View>
                </View>

                {/* Spacer */}
                <View className="flex-1" />

                {/* Bottom Deck */}
                <View className="px-6 mb-4">
                    {/* Glass Panel */}
                    <View className="bg-gray-900/90 rounded-3xl p-5 border border-gray-800 shadow-2xl backdrop-blur-xl">

                        {/* Filter Row */}
                        {!editMode && (
                            <View className="flex-row bg-gray-800 rounded-xl p-1 mb-4 border border-gray-700">
                                <TouchableOpacity
                                    onPress={() => handleFilterChange('COW')}
                                    className={`flex-1 py-2 rounded-lg items-center ${targetClass.length === 1 && targetClass[0] === 19 ? 'bg-indigo-600' : ''}`}
                                >
                                    <Text className={`text-xs font-bold ${targetClass.length === 1 && targetClass[0] === 19 ? 'text-white' : 'text-gray-400'}`}>COWS</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    onPress={() => handleFilterChange('SHEEP')}
                                    className={`flex-1 py-2 rounded-lg items-center ${targetClass.length === 1 && targetClass[0] === 18 ? 'bg-indigo-600' : ''}`}
                                >
                                    <Text className={`text-xs font-bold ${targetClass.length === 1 && targetClass[0] === 18 ? 'text-white' : 'text-gray-400'}`}>SHEEP</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    onPress={() => handleFilterChange('BOTH')}
                                    className={`flex-1 py-2 rounded-lg items-center ${targetClass.length === 2 ? 'bg-indigo-600' : ''}`}
                                >
                                    <Text className={`text-xs font-bold ${targetClass.length === 2 ? 'text-white' : 'text-gray-400'}`}>BOTH</Text>
                                </TouchableOpacity>
                            </View>
                        )}

                        {/* Metrics Row */}
                        <View className="flex-row justify-between mb-6">
                            <View className="items-center">
                                <Text className="text-gray-500 text-[10px] uppercase font-bold mb-1">Total Head</Text>
                                <Text className="text-white text-2xl font-light">{totalCows}</Text>
                            </View>
                            <View className="items-center">
                                <Text className="text-gray-500 text-[10px] uppercase font-bold mb-1">Secure</Text>
                                <Text className="text-green-400 text-2xl font-light">{totalCows - outCows - warningCows}</Text>
                            </View>
                            <View className="items-center">
                                <Text className="text-gray-500 text-[10px] uppercase font-bold mb-1">Breach</Text>
                                <Text className="text-red-500 text-2xl font-light">{outCows}</Text>
                            </View>
                        </View>

                        {/* Action Bar */}
                        <View className="flex-row space-x-2">
                            {editMode ? (
                                <>
                                    <TouchableOpacity
                                        onPress={clearFence}
                                        className="flex-1 py-4 rounded-2xl items-center justify-center border-b-4 active:border-b-0 active:mt-1 bg-rose-600 border-rose-800"
                                    >
                                        <Text className="text-white font-bold tracking-wider text-xs">CLEAR</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        onPress={addNode}
                                        className="flex-1 py-4 rounded-2xl items-center justify-center border-b-4 active:border-b-0 active:mt-1 bg-indigo-600 border-indigo-800"
                                    >
                                        <Text className="text-white font-bold tracking-wider text-xs">+ NODE</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        onPress={toggleEditMode}
                                        className="flex-1 py-4 rounded-2xl items-center justify-center border-b-4 active:border-b-0 active:mt-1 bg-emerald-500 border-emerald-700"
                                    >
                                        <Text className="text-white font-bold tracking-wider text-xs">SAVE</Text>
                                    </TouchableOpacity>
                                </>
                            ) : (
                                <TouchableOpacity
                                    onPress={toggleEditMode}
                                    className="flex-1 py-4 rounded-2xl items-center justify-center border-b-4 active:border-b-0 active:mt-1 bg-indigo-600 border-indigo-800 w-full"
                                >
                                    <Text className="text-white font-bold tracking-wider text-sm">EDIT FENCE</Text>
                                </TouchableOpacity>
                            )}
                        </View>
                    </View>
                </View>
            </View>
        </View>
    );
};

export default MonitorScreen;
