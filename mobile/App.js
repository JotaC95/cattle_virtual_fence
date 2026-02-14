import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import MonitorScreen from './src/components/MonitorScreen';
import './global.css';

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <MonitorScreen />
    </SafeAreaProvider>
  );
}
