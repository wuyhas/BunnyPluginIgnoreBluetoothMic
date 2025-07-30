// Plugin: Better Bluetooth Audio
// Description: Forces iPhone mic usage while keeping Bluetooth headphones for output
// Version: 1.0.0

const { Plugin } = require('@bunny/plugin');
const { findByProps, findByName } = require('@bunny/metro');
const { before, after } = require('@bunny/patcher');

// Audio session and routing modules
let AudioManager;
let MediaEngine;
let VoiceConnection;

class BetterBluetoothAudio extends Plugin {
    onStart() {
        this.patches = [];
        this.initializeModules();
        this.patchAudioRouting();
        this.patchVoiceConnection();
    }

    initializeModules() {
        // Find Discord's audio management modules
        AudioManager = findByProps('setAudioInputDevice', 'setAudioOutputDevice');
        MediaEngine = findByProps('setAudioInputDevice', 'getAudioInputDevices');
        VoiceConnection = findByName('VoiceConnection');
    }

    patchAudioRouting() {
        if (!AudioManager) return;

        // Patch audio input device selection
        this.patches.push(
            before('setAudioInputDevice', AudioManager, (args) => {
                const [deviceId] = args;
                
                // Check if we're trying to set a Bluetooth device as input
                if (this.isBluetoothDevice(deviceId)) {
                    console.log('[BetterBluetoothAudio] Blocking Bluetooth mic, forcing iPhone mic');
                    
                    // Force iPhone built-in microphone
                    args[0] = this.getBuiltInMicrophoneId();
                    
                    // Ensure Bluetooth headphones remain as output
                    this.ensureBluetoothOutput();
                }
            })
        );

        // Patch audio session configuration
        this.patches.push(
            before('configureAudioSession', AudioManager, (args) => {
                const [config] = args;
                
                if (config && this.isInVoiceCall()) {
                    // Modify audio session to use separate input/output devices
                    config.allowBluetoothA2DP = true;
                    config.defaultToSpeaker = false;
                    config.mixWithOthers = false;
                    
                    // Force specific audio session category
                    config.category = 'AVAudioSessionCategoryPlayAndRecord';
                    config.categoryOptions = [
                        'AVAudioSessionCategoryOptionAllowBluetooth',
                        'AVAudioSessionCategoryOptionAllowBluetoothA2DP'
                    ];
                }
            })
        );
    }

    patchVoiceConnection() {
        if (!VoiceConnection) return;

        // Patch voice connection setup
        this.patches.push(
            after('connect', VoiceConnection.prototype, (args, result) => {
                setTimeout(() => {
                    this.enforceAudioRouting();
                }, 1000); // Delay to ensure connection is established
            })
        );

        // Patch audio device changes during calls
        this.patches.push(
            before('setInputDevice', VoiceConnection.prototype, (args) => {
                const [deviceId] = args;
                
                if (this.isBluetoothDevice(deviceId)) {
                    console.log('[BetterBluetoothAudio] Preventing Bluetooth mic during call');
                    args[0] = this.getBuiltInMicrophoneId();
                }
            })
        );
    }

    enforceAudioRouting() {
        try {
            // Get available audio devices
            const inputDevices = MediaEngine?.getAudioInputDevices?.() || [];
            const outputDevices = MediaEngine?.getAudioOutputDevices?.() || [];

            // Find built-in microphone
            const builtInMic = inputDevices.find(device => 
                device.name.toLowerCase().includes('iphone') || 
                device.name.toLowerCase().includes('built-in') ||
                device.id === 'default'
            );

            // Find Bluetooth headphones
            const bluetoothOutput = outputDevices.find(device => 
                this.isBluetoothDevice(device.id) && 
                !device.name.toLowerCase().includes('hands-free')
            );

            if (builtInMic) {
                console.log('[BetterBluetoothAudio] Setting input to:', builtInMic.name);
                MediaEngine?.setAudioInputDevice?.(builtInMic.id);
            }

            if (bluetoothOutput) {
                console.log('[BetterBluetoothAudio] Setting output to:', bluetoothOutput.name);
                MediaEngine?.setAudioOutputDevice?.(bluetoothOutput.id);
            }

            // Additional iOS-specific audio routing
            this.configureIOSAudioSession();

        } catch (error) {
            console.error('[BetterBluetoothAudio] Error enforcing audio routing:', error);
        }
    }

    configureIOSAudioSession() {
        // iOS-specific audio session configuration
        if (window.webkit?.messageHandlers?.audioSession) {
            const config = {
                category: 'AVAudioSessionCategoryPlayAndRecord',
                mode: 'AVAudioSessionModeVoiceChat',
                options: [
                    'AVAudioSessionCategoryOptionAllowBluetooth',
                    'AVAudioSessionCategoryOptionAllowBluetoothA2DP',
                    'AVAudioSessionCategoryOptionDefaultToSpeaker'
                ],
                preferredInput: 'Built-In Microphone',
                preferredOutput: 'Bluetooth'
            };

            window.webkit.messageHandlers.audioSession.postMessage(config);
        }
    }

    isBluetoothDevice(deviceId) {
        if (!deviceId) return false;
        
        const bluetoothIndicators = [
            'bluetooth',
            'bt-',
            'airpods',
            'beats',
            'sony',
            'bose',
            'hands-free',
            'hfp',
            'a2dp'
        ];

        return bluetoothIndicators.some(indicator => 
            deviceId.toLowerCase().includes(indicator)
        );
    }

    getBuiltInMicrophoneId() {
        try {
            const inputDevices = MediaEngine?.getAudioInputDevices?.() || [];
            
            // Look for built-in microphone
            const builtInMic = inputDevices.find(device => 
                device.name.toLowerCase().includes('iphone') || 
                device.name.toLowerCase().includes('built-in') ||
                device.id === 'default' ||
                device.id === 'built-in-mic'
            );

            return builtInMic?.id || 'default';
        } catch (error) {
            console.error('[BetterBluetoothAudio] Error getting built-in mic:', error);
            return 'default';
        }
    }

    ensureBluetoothOutput() {
        try {
            const outputDevices = MediaEngine?.getAudioOutputDevices?.() || [];
            
            const bluetoothOutput = outputDevices.find(device => 
                this.isBluetoothDevice(device.id) && 
                !device.name.toLowerCase().includes('hands-free')
            );

            if (bluetoothOutput) {
                MediaEngine?.setAudioOutputDevice?.(bluetoothOutput.id);
            }
        } catch (error) {
            console.error('[BetterBluetoothAudio] Error ensuring Bluetooth output:', error);
        }
    }

    isInVoiceCall() {
        try {
            // Check if user is currently in a voice channel
            const VoiceStateStore = findByProps('getVoiceStateForUser');
            const UserStore = findByProps('getCurrentUser');
            
            if (VoiceStateStore && UserStore) {
                const currentUser = UserStore.getCurrentUser();
                const voiceState = VoiceStateStore.getVoiceStateForUser(currentUser?.id);
                return voiceState?.channelId != null;
            }
            
            return false;
        } catch (error) {
            return false;
        }
    }

    onStop() {
        // Remove all patches
        this.patches.forEach(unpatch => unpatch());
        this.patches = [];
        
        console.log('[BetterBluetoothAudio] Plugin stopped');
    }
}

module.exports = BetterBluetoothAudio;
