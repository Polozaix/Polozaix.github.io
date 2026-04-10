const CACHE_NAME = 'polozaix-v1';
const ASSETS = ['./', './index.html', './manifest.json'];

// ── Install ──────────────────────────────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS).catch(() => {}))
  );
  self.skipWaiting();
});

// ── Activate ─────────────────────────────────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
  // Check for any pending notifications after activation
  checkScheduledNotifications();
});

// ── Fetch (offline cache) ────────────────────────────────────────────────────
self.addEventListener('fetch', e => {
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});

// ── Message from page ────────────────────────────────────────────────────────
self.addEventListener('message', e => {
  if (e.data?.type === 'SCHEDULE_NOTIFICATIONS') {
    checkScheduledNotifications(e.data.goals);
  }
  if (e.data?.type === 'TEST_NOTIFICATION') {
    showNotification(e.data.goal, true);
  }
  if (e.data?.type === 'PING') {
    // Keep SW alive and re-check
    checkScheduledNotifications();
  }
});

// ── Periodic background sync ─────────────────────────────────────────────────
self.addEventListener('periodicsync', e => {
  if (e.tag === 'goal-check') {
    e.waitUntil(checkScheduledNotifications());
  }
});

// ── Push event (for future server-push support) ──────────────────────────────
self.addEventListener('push', e => {
  const data = e.data?.json() || { title: 'Goal Reminder', body: 'You have goals to complete!' };
  e.waitUntil(showNotification(data, false));
});

// ── Notification click ───────────────────────────────────────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const action = e.action;
  const goal = e.notification.data?.goal;

  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      // Focus existing window or open new one
      for (const client of clients) {
        if (client.url.includes(self.location.origin)) {
          client.focus();
          client.postMessage({ type: 'NOTIFICATION_ACTION', action, goal });
          return;
        }
      }
      return self.clients.openWindow('/#goals');
    })
  );
});

// ── Notification close ───────────────────────────────────────────────────────
self.addEventListener('notificationclose', e => {
  // User dismissed — could log analytics here
});

// ── Core: check and fire due notifications ────────────────────────────────────
async function checkScheduledNotifications(goalsFromMessage) {
  let goals = goalsFromMessage;

  if (!goals) {
    // Try to get goals from clients
    const clients = await self.clients.matchAll({ includeUncontrolled: true });
    if (clients.length > 0) {
      // Request goals from the page
      clients[0].postMessage({ type: 'REQUEST_GOALS' });
    }
    return;
  }

  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  for (const goal of goals) {
    if (goal.completed) continue;
    if (!goal.reminderTime) continue;

    const shouldFire = shouldFireNotification(goal, now, today);
    if (shouldFire) {
      await showNotification(goal, false);
    }
  }
}

function shouldFireNotification(goal, now, today) {
  if (!goal.reminderTime) return false;

  const [hh, mm] = goal.reminderTime.split(':').map(Number);
  const currentH = now.getHours();
  const currentM = now.getMinutes();

  // Fire if within a 2-minute window of the scheduled time
  const targetMinutes = hh * 60 + mm;
  const currentMinutes = currentH * 60 + currentM;
  const diff = Math.abs(targetMinutes - currentMinutes);

  if (diff > 2) return false;

  // Check if we haven't already notified today
  const lastFiredKey = `notified_${goal.id}_${today}`;
  // Note: SW doesn't have localStorage — use IndexedDB or just fire
  // For simplicity, we track via the notification tag (only one per tag)
  return true;
}

async function showNotification(goal, isTest) {
  const categoryEmoji = {
    daily: '📅',
    weekly: '📆',
    monthly: '🗓️',
    longterm: '🚀',
    fitness: '💪',
    study: '📚',
  };

  const priorityLabel = {
    high: '🔴 HIGH PRIORITY',
    medium: '🟡 MEDIUM',
    low: '🟢 LOW',
  };

  const emoji = categoryEmoji[goal.category] || '🎯';
  const priority = priorityLabel[goal.priority] || '';
  const title = `${emoji} ${isTest ? '[TEST] ' : ''}${goal.title}`;
  const body = [
    priority,
    goal.notes ? goal.notes : '',
    `Category: ${goal.category?.toUpperCase()}`,
  ].filter(Boolean).join('\n');

  return self.registration.showNotification(title, {
    body,
    icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 192 192'%3E%3Crect width='192' height='192' rx='32' fill='%230F172A'/%3E%3Ctext x='96' y='130' font-size='100' text-anchor='middle' fill='%2322C55E' font-family='monospace'%3EP%3C/text%3E%3C/svg%3E",
    badge: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 96 96'%3E%3Crect width='96' height='96' rx='16' fill='%230F172A'/%3E%3Ctext x='48' y='68' font-size='56' text-anchor='middle' fill='%2322C55E' font-family='monospace'%3EP%3C/text%3E%3C/svg%3E",
    tag: `goal-${goal.id}`,
    renotify: true,
    requireInteraction: true,   // 🔒 PERSISTENT — won't auto-dismiss
    vibrate: [200, 100, 200, 100, 400],
    timestamp: Date.now(),
    data: { goal },
    actions: [
      { action: 'complete', title: '✅ Mark Done' },
      { action: 'snooze',   title: '⏰ Snooze 1h' },
    ],
  });
}
