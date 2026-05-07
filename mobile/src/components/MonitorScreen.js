import React, { useState, useRef, useEffect } from 'react';
import { View, Text, TouchableOpacity, Dimensions, StatusBar, Platform, PanResponder, ScrollView, TextInput } from 'react-native';
import { RTCView } from 'react-native-webrtc';
import Svg, { Polygon, Rect, Text as SvgText, Circle, Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import useCattleConnection from '../hooks/useCattleConnection';
import useStore from '../store/useStore';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const VIDEO_WIDTH = 640;
const VIDEO_HEIGHT = 480;

// ------------------------------------------------------------------ //
// DraggablePoint — supports drag + optional remove button             //
// ------------------------------------------------------------------ //
const DraggablePoint = ({ x, y, onMove, onRemove, canRemove }) => {
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
            <View {...panResponder.panHandlers}
                style={{ justifyContent: 'center', alignItems: 'center' }}>
                <View className="w-6 h-6 rounded-full bg-cyan-400 border-[3px] border-white shadow-xl" />
            </View>
            {canRemove && (
                <TouchableOpacity
                    onPress={onRemove}
                    style={{
                        position: 'absolute',
                        top: 0,
                        right: 0,
                        width: 18,
                        height: 18,
                        borderRadius: 9,
                        backgroundColor: '#ef4444',
                        justifyContent: 'center',
                        alignItems: 'center',
                    }}
                >
                    <Text style={{ color: 'white', fontSize: 10, fontWeight: 'bold', lineHeight: 12 }}>×</Text>
                </TouchableOpacity>
            )}
        </View>
    );
};

// ------------------------------------------------------------------ //
// AlertBanner — auto-dismisses after 8 s                              //
// ------------------------------------------------------------------ //
const AlertBanner = ({ alert, onDismiss }) => {
    useEffect(() => {
        const t = setTimeout(onDismiss, 8000);
        return () => clearTimeout(t);
    }, []);

    const isPerson = alert.type === 'person_alert';
    const bgColor = isPerson ? '#dc2626' : (alert.action === 'activated' ? '#ea580c' : '#16a34a');
    const icon = isPerson ? '👤' : (alert.action === 'activated' ? '⚠️' : '✅');
    let msg;
    if (isPerson) {
        msg = `Person detected (${alert.count} in frame)`;
    } else if (alert.action === 'activated') {
        msg = `Cow #${alert.cow_id} exited the fence`;
    } else {
        msg = `Cow #${alert.cow_id} returned inside`;
    }

    return (
        <View style={{
            backgroundColor: bgColor,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: 14,
            paddingVertical: 8,
            borderRadius: 12,
            opacity: 0.93,
        }}>
            <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 13, flex: 1 }}>
                {icon}  {msg}
            </Text>
            <TouchableOpacity onPress={onDismiss} style={{ paddingLeft: 12 }}>
                <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 18 }}>×</Text>
            </TouchableOpacity>
        </View>
    );
};

// ------------------------------------------------------------------ //
// MonitorScreen                                                        //
// ------------------------------------------------------------------ //
const MonitorScreen = () => {
    const insets = useSafeAreaInsets();
    const { remoteStream, pcState, updateZone, toggleFence, setCowException, queryMemory } = useCattleConnection();
    const { zones, cows, persons, isConnected, fenceActive, allowedCowIds, alerts, dismissAlert, memorySummary, memoryResults } = useStore();
    const [editMode, setEditMode] = useState(false);
    const [editablePoints, setEditablePoints] = useState([]);
    const [memoryOpen, setMemoryOpen] = useState(false);
    const [queryText, setQueryText] = useState('');

    // Scaling & translation so video fills screen
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
                    { x: 100, y: VIDEO_HEIGHT - 100 }
                ]);
            }
            setEditMode(true);
        } else {
            updateZone({ safe_zone: editablePoints });
            setEditMode(false);
        }
    };

    const handlePointMove = (index, screenX, screenY) => {
        const backendX = (screenX - translateX) / scale;
        const backendY = (screenY - translateY) / scale;
        const newPoints = [...editablePoints];
        newPoints[index] = {
            x: Math.round(Math.max(0, Math.min(VIDEO_WIDTH, backendX))),
            y: Math.round(Math.max(0, Math.min(VIDEO_HEIGHT, backendY))),
        };
        setEditablePoints(newPoints);
    };

    const addFencePoint = () => {
        const cx = Math.round(editablePoints.reduce((s, p) => s + p.x, 0) / editablePoints.length);
        const cy = Math.round(editablePoints.reduce((s, p) => s + p.y, 0) / editablePoints.length);
        setEditablePoints([...editablePoints, { x: cx, y: cy }]);
    };

    const removeFencePoint = (index) => {
        if (editablePoints.length <= 3) return;
        setEditablePoints(editablePoints.filter((_, i) => i !== index));
    };

    const getColor = (status) => {
        switch (status) {
            case 'INTERNAL': return '#4ade80';  // green-400
            case 'WARNING':  return '#facc15';  // yellow-400
            case 'OUT':      return '#ef4444';  // red-500
            case 'ALLOWED':  return '#00c864';  // lime-green
            case 'INACTIVE': return '#9ca3af';  // gray-400
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

    // Stats
    const totalCows = cows.length;
    const warningCows = cows.filter(c => c.status === 'WARNING').length;
    const outCows = cows.filter(c => c.status === 'OUT').length;
    const allowedOutCows = cows.filter(c => c.status === 'ALLOWED').length;
    const safetyScore = totalCows > 0
        ? Math.round(((totalCows - outCows) / totalCows) * 100)
        : 100;

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

            {/* 2. AR Overlay (SVG) — non-interactive */}
            <View className="absolute inset-0" pointerEvents="none">
                <Svg height="100%" width="100%">
                    {/* Safe Zone polygon */}
                    {(editMode ? editablePoints.length > 0 : (zones.safe_zone && zones.safe_zone.length > 0)) && (
                        <Polygon
                            points={pointsToSvgPoints(editMode ? editablePoints : zones.safe_zone)}
                            fill={fenceActive ? "rgba(16, 185, 129, 0.15)" : "rgba(120,120,120,0.10)"}
                            stroke={editMode ? "#22d3ee" : (fenceActive ? "#10b981" : "#6b7280")}
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
                                <Rect
                                    x={x} y={y} width={w} height={h}
                                    fill="transparent"
                                    stroke={color}
                                    strokeWidth="2"
                                />
                                <Rect
                                    x={x} y={y - 20} width={60} height={20}
                                    fill={color}
                                    opacity={0.85}
                                />
                                <SvgText
                                    x={x + 5}
                                    y={y - 6}
                                    fill="black"
                                    fontSize="11"
                                    fontWeight="bold"
                                >
                                    ID {cow.id}
                                </SvgText>
                            </React.Fragment>
                        );
                    })}

                    {/* Person Targets */}
                    {persons && persons.map(person => {
                        const x = person.bbox[0] * scale + translateX;
                        const y = person.bbox[1] * scale + translateY;
                        const w = (person.bbox[2] - person.bbox[0]) * scale;
                        const h = (person.bbox[3] - person.bbox[1]) * scale;

                        return (
                            <React.Fragment key={`person-${person.id}`}>
                                <Rect
                                    x={x} y={y} width={w} height={h}
                                    fill="rgba(59, 130, 246, 0.1)"
                                    stroke="#3b82f6"
                                    strokeWidth="2"
                                    strokeDasharray="6, 3"
                                />
                                <Rect
                                    x={x} y={y - 20} width={75} height={20}
                                    fill="#3b82f6"
                                    opacity={0.85}
                                />
                                <SvgText
                                    x={x + 5}
                                    y={y - 6}
                                    fill="white"
                                    fontSize="11"
                                    fontWeight="bold"
                                >
                                    PERSON {person.id}
                                </SvgText>
                            </React.Fragment>
                        );
                    })}
                </Svg>
            </View>

            {/* 3. Cow tap targets — invisible touchable areas over each cow box */}
            {!editMode && (
                <View className="absolute inset-0" pointerEvents="box-none">
                    {cows.map(cow => {
                        const screenX = cow.bbox[0] * scale + translateX;
                        const screenY = cow.bbox[1] * scale + translateY;
                        const w = (cow.bbox[2] - cow.bbox[0]) * scale;
                        const h = (cow.bbox[3] - cow.bbox[1]) * scale;
                        const isAllowed = allowedCowIds.includes(cow.id);
                        return (
                            <TouchableOpacity
                                key={`tap-${cow.id}`}
                                onPress={() => setCowException(cow.id, !isAllowed)}
                                style={{
                                    position: 'absolute',
                                    left: screenX,
                                    top: screenY,
                                    width: w,
                                    height: h,
                                }}
                            />
                        );
                    })}
                </View>
            )}

            {/* 4. Draggable handles for edit mode */}
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
                                onRemove={() => removeFencePoint(index)}
                                canRemove={editablePoints.length > 3}
                            />
                        );
                    })}
                </View>
            )}

            {/* 5. UI Controls Layer */}
            <View
                className="flex-1"
                pointerEvents="box-none"
                style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
            >
                {/* Header */}
                <View className="flex-row justify-between items-center px-6 py-4">
                    <View>
                        <Text className="text-white font-black text-xl italic tracking-tighter">
                            CATTLE<Text className="text-blue-500">GUARD</Text>
                        </Text>
                        <View className="flex-row items-center mt-1 space-x-3">
                            <View className="flex-row items-center">
                                <View className={`w-2 h-2 rounded-full mr-1 ${pcState === 'connected' ? 'bg-green-500' : 'bg-red-500'}`} />
                                <Text className="text-gray-400 text-[10px] uppercase font-bold">
                                    {pcState === 'connected' ? 'LIVE' : pcState.toUpperCase()}
                                </Text>
                            </View>
                            {!fenceActive && (
                                <View className="flex-row items-center bg-gray-700/80 px-2 py-0.5 rounded-full">
                                    <Text className="text-gray-300 text-[10px] uppercase font-bold">FENCE OFF</Text>
                                </View>
                            )}
                        </View>
                    </View>

                    {/* Safety pill */}
                    <View className="bg-gray-800/80 px-3 py-1.5 rounded-full border border-gray-700 flex-row items-center">
                        <Text className="text-gray-400 text-xs mr-2 font-bold">SAFETY</Text>
                        <Text className={`text-xs font-black ${safetyScore === 100 ? 'text-green-400' : 'text-yellow-400'}`}>
                            {safetyScore}%
                        </Text>
                    </View>
                </View>

                {/* Alert Banners */}
                {alerts.length > 0 && (
                    <View style={{ marginHorizontal: 16, gap: 6 }}>
                        {alerts.slice(0, 3).map(alert => (
                            <AlertBanner
                                key={alert._id}
                                alert={alert}
                                onDismiss={() => dismissAlert(alert._id)}
                            />
                        ))}
                    </View>
                )}

                <View className="flex-1" />

                {/* Memory Panel (shown above bottom deck when open) */}
                {memoryOpen && (
                    <View style={{
                        marginHorizontal: 16,
                        marginBottom: 8,
                        backgroundColor: 'rgba(17,10,40,0.97)',
                        borderRadius: 20,
                        padding: 16,
                        borderWidth: 1,
                        borderColor: '#7c3aed',
                    }}>
                        <Text style={{ color: '#c4b5fd', fontWeight: 'bold', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
                            🧠 Brain Memory
                        </Text>

                        {/* Search bar */}
                        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
                            <TextInput
                                value={queryText}
                                onChangeText={setQueryText}
                                placeholder="Ask memory… e.g. vaca 3"
                                placeholderTextColor="#6b7280"
                                style={{
                                    flex: 1,
                                    backgroundColor: '#1f1035',
                                    color: 'white',
                                    borderRadius: 10,
                                    paddingHorizontal: 12,
                                    paddingVertical: 8,
                                    fontSize: 12,
                                    borderWidth: 1,
                                    borderColor: '#4c1d95',
                                }}
                            />
                            <TouchableOpacity
                                onPress={() => { if (queryText.trim()) queryMemory(queryText.trim()); }}
                                style={{ backgroundColor: '#7c3aed', borderRadius: 10, paddingHorizontal: 14, justifyContent: 'center' }}
                            >
                                <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 13 }}>→</Text>
                            </TouchableOpacity>
                        </View>

                        {/* Results or summary */}
                        <ScrollView style={{ maxHeight: 160 }}>
                            {(memoryResults !== null ? memoryResults : memorySummary).map((item, i) => {
                                const text = typeof item === 'string' ? item : (item.content || JSON.stringify(item));
                                return (
                                    <Text key={i} style={{ color: '#d1d5db', fontSize: 11, marginBottom: 4 }}>
                                        • {text}
                                    </Text>
                                );
                            })}
                            {(memoryResults !== null ? memoryResults : memorySummary).length === 0 && (
                                <Text style={{ color: '#6b7280', fontSize: 11, fontStyle: 'italic' }}>
                                    No memories yet. Events will appear here as they occur.
                                </Text>
                            )}
                        </ScrollView>
                    </View>
                )}

                {/* Bottom Deck */}
                <View className="px-6 mb-4">
                    <View className="bg-gray-900/90 rounded-3xl p-5 border border-gray-800 shadow-2xl">

                        {/* Metrics Row */}
                        <View className="flex-row justify-between mb-4">
                            <View className="items-center">
                                <Text className="text-gray-500 text-[10px] uppercase font-bold mb-1">Total</Text>
                                <Text className="text-white text-2xl font-light">{totalCows}</Text>
                            </View>
                            <View className="items-center">
                                <Text className="text-gray-500 text-[10px] uppercase font-bold mb-1">Secure</Text>
                                <Text className="text-green-400 text-2xl font-light">{totalCows - outCows - warningCows - allowedOutCows}</Text>
                            </View>
                            <View className="items-center">
                                <Text className="text-gray-500 text-[10px] uppercase font-bold mb-1">Breach</Text>
                                <Text className="text-red-500 text-2xl font-light">{outCows}</Text>
                            </View>
                            <View className="items-center">
                                <Text className="text-gray-500 text-[10px] uppercase font-bold mb-1">Allowed</Text>
                                <Text className="text-emerald-400 text-2xl font-light">{allowedOutCows}</Text>
                            </View>
                            <View className="items-center">
                                <Text className="text-gray-500 text-[10px] uppercase font-bold mb-1">Persons</Text>
                                <Text className="text-blue-400 text-2xl font-light">{persons ? persons.length : 0}</Text>
                            </View>
                        </View>

                        {/* Hint when not in edit mode */}
                        {!editMode && (
                            <Text className="text-gray-600 text-[10px] text-center mb-3">
                                Tap a cow to allow/deny fence exception
                            </Text>
                        )}

                        {/* Action Bar */}
                        <View className="flex-row space-x-3">
                            {/* Edit / Save fence */}
                            <TouchableOpacity
                                onPress={toggleEditMode}
                                className={`flex-1 py-4 rounded-2xl items-center justify-center border-b-4 active:border-b-0 active:mt-1 ${
                                    editMode ? 'bg-cyan-600 border-cyan-800' : 'bg-indigo-600 border-indigo-800'
                                }`}
                            >
                                <Text className="text-white font-bold tracking-wider text-sm">
                                    {editMode ? 'SAVE FENCE' : 'EDIT FENCE'}
                                </Text>
                            </TouchableOpacity>

                            {/* Add point (only in edit mode) */}
                            {editMode && (
                                <TouchableOpacity
                                    onPress={addFencePoint}
                                    className="px-5 py-4 rounded-2xl items-center justify-center bg-teal-700 border-b-4 border-teal-900 active:border-b-0 active:mt-1"
                                >
                                    <Text className="text-white font-bold text-lg">＋</Text>
                                </TouchableOpacity>
                            )}

                            {/* Fence toggle (hidden in edit mode) */}
                            {!editMode && (
                                <TouchableOpacity
                                    onPress={toggleFence}
                                    className={`px-4 py-4 rounded-2xl items-center justify-center border-b-4 active:border-b-0 active:mt-1 ${
                                        fenceActive
                                            ? 'bg-green-700 border-green-900'
                                            : 'bg-gray-600 border-gray-800'
                                    }`}
                                >
                                    <Text className="text-white font-bold text-xs tracking-wider">
                                        {fenceActive ? 'FENCE\nON' : 'FENCE\nOFF'}
                                    </Text>
                                </TouchableOpacity>
                            )}

                            {/* Memory toggle (hidden in edit mode) */}
                            {!editMode && (
                                <TouchableOpacity
                                    onPress={() => setMemoryOpen(v => !v)}
                                    style={{
                                        paddingHorizontal: 14,
                                        paddingVertical: 16,
                                        borderRadius: 18,
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        borderBottomWidth: 4,
                                        backgroundColor: memoryOpen ? '#6d28d9' : '#4c1d95',
                                        borderBottomColor: memoryOpen ? '#4c1d95' : '#2e1065',
                                    }}
                                >
                                    <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 16 }}>🧠</Text>
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
