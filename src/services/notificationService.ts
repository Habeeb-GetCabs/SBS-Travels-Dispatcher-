// Notification Architecture for SBS Travels Driver & Dispatcher
// Integrates with Android Native Bridge, Web Notification API, and in-app sound/audio engine

import { soundEngine } from './audioService';

export type NotificationChannelId =
  | 'channel_sbs_trip_meter'
  | 'channel_sbs_trip_dispatch'
  | 'channel_sbs_dispatcher_events';

export type NotificationTarget = 'DRIVER' | 'DISPATCHER' | 'ALL';

export type NotificationType =
  | 'NEW_TRIP'
  | 'TRIP_UPDATE'
  | 'TRIP_CANCELLED'
  | 'PASSENGER_OTP_REQUIRED'
  | 'DISPATCHER_EVENT'
  | 'TRIP_CLAIMED'
  | 'DRIVER_ARRIVED'
  | 'TRIP_STARTED'
  | 'TRIP_COMPLETED'
  | 'DRIVER_STATUS_CHANGE';

export interface AppNotification {
  id: string;
  type: NotificationType;
  target: NotificationTarget;
  title: string;
  message: string;
  timestamp: number;
  channelId: NotificationChannelId;
  tripId?: string;
  tripNumber?: string;
  read?: boolean;
}

class NotificationService {
  private recentNotificationHashes = new Map<string, number>();
  private listeners = new Set<(notification: AppNotification) => void>();
  private notificationHistory: AppNotification[] = [];

  constructor() {
    this.requestWebNotificationPermission();
  }

  public async requestWebNotificationPermission(): Promise<boolean> {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'default') {
        try {
          const res = await Notification.requestPermission();
          return res === 'granted';
        } catch {
          return false;
        }
      }
      return Notification.permission === 'granted';
    }
    return false;
  }

  public subscribe(callback: (notification: AppNotification) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  public notify(options: {
    type: NotificationType;
    target: NotificationTarget;
    title: string;
    message: string;
    channelId?: NotificationChannelId;
    tripId?: string;
    tripNumber?: string;
    sound?: boolean;
  }) {
    const channelId = options.channelId || 'channel_sbs_trip_dispatch';
    const now = Date.now();

    // Anti-spam deduplication: suppress identical alerts within 4 seconds
    const hash = `${options.type}_${options.tripId || ''}_${options.title}`;
    const lastSent = this.recentNotificationHashes.get(hash);
    if (lastSent && now - lastSent < 4000) {
      return;
    }
    this.recentNotificationHashes.set(hash, now);

    const notification: AppNotification = {
      id: `notif_${now}_${Math.random().toString(36).substr(2, 6)}`,
      type: options.type,
      target: options.target,
      title: options.title,
      message: options.message,
      timestamp: now,
      channelId,
      tripId: options.tripId,
      tripNumber: options.tripNumber,
      read: false,
    };

    this.notificationHistory = [notification, ...this.notificationHistory.slice(0, 49)];

    // Play appropriate sound cue
    if (options.sound !== false) {
      if (options.type === 'NEW_TRIP') {
        soundEngine.playNewTripAlert();
      } else if (options.type === 'TRIP_CANCELLED') {
        soundEngine.speak('Trip has been cancelled by dispatch.');
      } else if (options.type === 'PASSENGER_OTP_REQUIRED') {
        soundEngine.speak('Passenger verification required upon arrival.');
      } else if (options.type === 'DRIVER_ARRIVED') {
        soundEngine.playArrivedAlert();
      } else if (options.type === 'TRIP_COMPLETED') {
        soundEngine.playTripCompleted();
      }
    }

    // 1. Android Native Notification Bridge
    if (typeof window !== 'undefined' && (window as any).AndroidMeterBridge?.sendNotification) {
      try {
        (window as any).AndroidMeterBridge.sendNotification(options.title, options.message, channelId);
      } catch (err) {
        console.warn('Native notification bridge error:', err);
      }
    }

    // 2. Web Notification API (when page in background)
    if (
      typeof window !== 'undefined' &&
      'Notification' in window &&
      Notification.permission === 'granted' &&
      document.visibilityState === 'hidden'
    ) {
      try {
        new Notification(options.title, {
          body: options.message,
          icon: '/favicon.ico',
          badge: '/favicon.ico',
          tag: hash,
        });
      } catch {
        // Fallback
      }
    }

    // 3. Notify in-app UI subscribers
    this.listeners.forEach((listener) => {
      try {
        listener(notification);
      } catch (err) {
        console.warn('Notification listener error:', err);
      }
    });
  }

  public getHistory(): AppNotification[] {
    return [...this.notificationHistory];
  }

  public clearHistory() {
    this.notificationHistory = [];
  }
}

export const notificationService = new NotificationService();
