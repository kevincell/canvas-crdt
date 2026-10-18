import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  extractYouTubeId,
  extractYouTubePlaylistId,
  extractYouTubePlaylistIndex,
  calculateEffectiveTime,
  type SharedMediaState,
} from '../types';

describe('Media Synchronization Substrate', () => {
  describe('YouTube URL parsing', () => {
    it('correctly extracts video IDs from standard and shortened URLs', () => {
      expect(extractYouTubeId('https://www.youtube.com/watch?v=jfKfPfyJRdk')).toBe('jfKfPfyJRdk');
      expect(extractYouTubeId('https://youtu.be/4xDzrJKXOOY')).toBe('4xDzrJKXOOY');
      expect(extractYouTubeId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
      expect(extractYouTubeId('jfKfPfyJRdk')).toBe('jfKfPfyJRdk');
      expect(extractYouTubeId('https://commondatastorage.googleapis.com/sample.mp4')).toBeNull();
    });

    it('correctly extracts playlist IDs and playlist indices from URLs', () => {
      const url1 = 'https://www.youtube.com/watch?v=abc12345678&list=PL1234567890abcdef&index=4';
      expect(extractYouTubePlaylistId(url1)).toBe('PL1234567890abcdef');
      expect(extractYouTubePlaylistIndex(url1)).toBe(3); // 0-based: 4 - 1 = 3

      const url2 = 'https://www.youtube.com/playlist?list=PL987654321';
      expect(extractYouTubePlaylistId(url2)).toBe('PL987654321');
      expect(extractYouTubePlaylistIndex(url2)).toBeNull();
    });
  });

  describe('Clock drift and effective time calculation', () => {
    it('returns exact static position when paused', () => {
      const state: SharedMediaState = {
        mediaType: 'youtube',
        url: 'https://youtube.com/watch?v=abc',
        title: 'Test',
        playing: false,
        currentTime: 42.5,
        timestamp: Date.now() - 5000, // 5 seconds ago
        updatedBy: 'Alice',
        action: 'pause',
      };
      expect(calculateEffectiveTime(state)).toBe(42.5);
    });

    it('adds elapsed duration when playing', () => {
      const now = Date.now();
      const state: SharedMediaState = {
        mediaType: 'youtube',
        url: 'https://youtube.com/watch?v=abc',
        title: 'Test',
        playing: true,
        currentTime: 10.0,
        timestamp: now - 3000, // 3 seconds ago
        updatedBy: 'Alice',
        action: 'play',
      };
      const effective = calculateEffectiveTime(state);
      expect(effective).toBeGreaterThanOrEqual(12.9);
      expect(effective).toBeLessThanOrEqual(13.2);
    });
  });

  describe('P2P Yjs CRDT Multi-Peer Sync', () => {
    it('converges play/pause and seek state between two peers', () => {
      const docA = new Y.Doc();
      const docB = new Y.Doc();

      const mediaA = docA.getMap<unknown>('media-sync');
      const mediaB = docB.getMap<unknown>('media-sync');

      // Peer A loads a track and hits play
      docA.transact(() => {
        mediaA.set('mediaType', 'youtube');
        mediaA.set('url', 'https://youtu.be/jfKfPfyJRdk');
        mediaA.set('title', 'Lofi Beats');
        mediaA.set('playing', true);
        mediaA.set('currentTime', 0);
        mediaA.set('timestamp', Date.now());
        mediaA.set('updatedBy', 'Alice');
        mediaA.set('action', 'load');
      });

      // Synchronize update from A -> B
      const update1 = Y.encodeStateAsUpdate(docA);
      Y.applyUpdate(docB, update1);

      expect(mediaB.get('title')).toBe('Lofi Beats');
      expect(mediaB.get('playing')).toBe(true);
      expect(mediaB.get('updatedBy')).toBe('Alice');

      // Peer B seeks to second 54.5 and pauses
      docB.transact(() => {
        mediaB.set('playing', false);
        mediaB.set('currentTime', 54.5);
        mediaB.set('timestamp', Date.now());
        mediaB.set('updatedBy', 'Bob');
        mediaB.set('action', 'seek');
      });

      // Synchronize update from B -> A
      const update2 = Y.encodeStateAsUpdate(docB);
      Y.applyUpdate(docA, update2);

      expect(mediaA.get('playing')).toBe(false);
      expect(mediaA.get('currentTime')).toBe(54.5);
      expect(mediaA.get('updatedBy')).toBe('Bob');
      expect(mediaA.get('action')).toBe('seek');
    });

    it('broadcasts and syncs playlist track changes (index, videoId, title)', () => {
      const docHost = new Y.Doc();
      const docPeer = new Y.Doc();

      const broadcastsHost = docHost.getMap<string>('media-broadcasts');
      const broadcastsPeer = docPeer.getMap<string>('media-broadcasts');

      // Host starts a playlist broadcast at song index 0
      const initialBroadcast = {
        id: 'bc-host-1',
        hostName: 'HostUser',
        hostActorId: '1',
        mediaType: 'youtube',
        url: 'https://www.youtube.com/playlist?list=PLabc123',
        title: 'Song 1',
        playlistId: 'PLabc123',
        playlistIndex: 0,
        videoId: 'vid1',
        playing: true,
        currentTime: 0,
        timestamp: Date.now(),
        loop: false,
        autoPlayNext: true,
        action: 'load',
        updatedAt: Date.now(),
      };

      docHost.transact(() => {
        broadcastsHost.set('HostUser', JSON.stringify(initialBroadcast));
      });

      // Sync Host -> Peer
      Y.applyUpdate(docPeer, Y.encodeStateAsUpdate(docHost));
      let peerReceived = JSON.parse(broadcastsPeer.get('HostUser')!);
      expect(peerReceived.playlistIndex).toBe(0);
      expect(peerReceived.videoId).toBe('vid1');

      // Host skips to next song in playlist (index 1)
      const updatedBroadcast = {
        ...initialBroadcast,
        playlistIndex: 1,
        videoId: 'vid2',
        title: 'Song 2',
        currentTime: 0,
        timestamp: Date.now(),
        action: 'play',
        updatedAt: Date.now(),
      };

      docHost.transact(() => {
        broadcastsHost.set('HostUser', JSON.stringify(updatedBroadcast));
      });

      // Sync Host -> Peer
      Y.applyUpdate(docPeer, Y.encodeStateAsUpdate(docHost));
      peerReceived = JSON.parse(broadcastsPeer.get('HostUser')!);
      expect(peerReceived.playlistIndex).toBe(1);
      expect(peerReceived.videoId).toBe('vid2');
      expect(peerReceived.title).toBe('Song 2');
    });

    it('does not interfere with canvas shapes array', () => {
      const doc = new Y.Doc();
      const shapes = doc.getArray('shapes');
      const media = doc.getMap('media-sync');

      shapes.push(['dummy-shape-1']);
      media.set('playing', true);

      expect(shapes.length).toBe(1);
      expect(media.get('playing')).toBe(true);
    });
  });
});

