import { useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';

function urlBase64ToUint8Array(base64String: string) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
        .replace(/\-/g, '+')
        .replace(/_/g, '/');

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

export function PushNotificationManager() {
    const { user, token } = useAuth();

    useEffect(() => {
        if (!user || !token) return;

        const subscribeToPush = async () => {
            if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

            try {
                const registration = await navigator.serviceWorker.ready;
                
                // Get existing subscription
                let subscription = await registration.pushManager.getSubscription();
                
                // Get current VAPID key from server
                const response = await fetch('/api/notifications/vapid-public-key');
                const vapidPublicKey = await response.text();
                
                if (!vapidPublicKey) return;

                // Key Rotation Check: If subscription exists, verify the VAPID key matches
                if (subscription && subscription.options.applicationServerKey) {
                    const currentKey = urlBase64ToUint8Array(vapidPublicKey);
                    const subscriptionKey = new Uint8Array(subscription.options.applicationServerKey);
                    
                    let keysMatch = currentKey.length === subscriptionKey.length;
                    if (keysMatch) {
                        for (let i = 0; i < currentKey.length; i++) {
                            if (currentKey[i] !== subscriptionKey[i]) {
                                keysMatch = false;
                                break;
                            }
                        }
                    }

                    if (!keysMatch) {
                        console.log('🔄 VAPID key change detected. Re-subscribing client...');
                        await subscription.unsubscribe();
                        subscription = null; // Forces re-subscription below
                    }
                }

                if (!subscription) {
                    // Request permission and subscribe
                    const permission = await Notification.requestPermission();
                    if (permission !== 'granted') return;

                    subscription = await registration.pushManager.subscribe({
                        userVisibleOnly: true,
                        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
                    });
                }

                // Send subscription to server
                await fetch('/api/notifications/subscribe', {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({ subscription })
                });

            } catch (err) {
                console.error('Failed to subscribe to push notifications:', err);
            }
        };

        subscribeToPush();
    }, [user, token]);

    return null;
}
