// Fake devices and rooms only; never opens a camera, microphone or connection.
export const RoomEvent = Object.fromEntries([
  'TrackSubscribed', 'TrackUnsubscribed', 'TrackUnpublished', 'LocalTrackPublished', 'LocalTrackUnpublished',
  'ParticipantConnected', 'ParticipantDisconnected', 'TrackMuted', 'TrackUnmuted',
  'ActiveSpeakersChanged', 'DataReceived', 'ConnectionQualityChanged', 'Reconnecting',
  'Reconnected', 'Disconnected', 'ParticipantPermissionsChanged',
].map(key => [key, key]));
export const VideoPresets = {h180:{}, h360:{}, h720:{}};
export const ScreenSharePresets = {h360fps15:{}, h720fps15:{}, h1080fps15:{}, h720fps30:{}, h1080fps30:{}};

class Participant {
  constructor(room, local = true) {
    this.room = room; this.isLocal = local;
    this.identity = local ? '11111111-1111-4111-8111-111111111111' : '22222222-2222-4222-8222-222222222222';
    this.name = local ? 'Pessoa de teste' : 'Outra pessoa';
    this.connectionQuality = 'good'; this.permissions = {canPublish:true};
    this.audioTrackPublications = new Map(); this.videoTrackPublications = new Map();
    this.isMicrophoneEnabled = false; this.isCameraEnabled = false; this.isScreenShareEnabled = false;
  }
  async setMicrophoneEnabled(enabled) {
    await new Promise(resolve => setTimeout(resolve, enabled ? 60 : 10));
    this.isMicrophoneEnabled = enabled;
    window.__qaMicrophoneStates.push(enabled);
    this.room.emit(enabled ? RoomEvent.TrackUnmuted : RoomEvent.TrackMuted);
  }
  async setCameraEnabled(value) { this.isCameraEnabled = value; }
  async setScreenShareEnabled(value) { this.isScreenShareEnabled = value; }
  async publishData(payload,options) {(window.__qaPublished||=[]).push({value:JSON.parse(new TextDecoder().decode(payload)),...options});}
}

export class Room {
  constructor() {
    this.handlers = new Map(); this.state = 'disconnected';
    this.localParticipant = new Participant(this);
    const remote = new Participant(this, false);
    this.remoteParticipants = new Map([[remote.identity, remote]]);
    window.__qaRoom = this; window.__qaMicrophoneStates = [];
  }
  on(event, callback) { const entries=this.handlers.get(event)||[]; entries.push(callback);this.handlers.set(event,entries);return this; }
  emit(event, ...args) { for(const callback of this.handlers.get(event)||[])callback(...args); }
  removeAllListeners() { this.handlers.clear(); }
  async connect() { this.state='connected'; }
  async disconnect() { this.state='disconnected';this.localParticipant.isMicrophoneEnabled=false; }
  async startAudio() {}
}
