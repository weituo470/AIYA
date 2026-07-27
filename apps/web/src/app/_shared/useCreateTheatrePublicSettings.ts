'use client';

import { useEffect, useState } from 'react';

export type CreateTheatrePublicSettings = {
  teacher: {
    name: string;
    avatar: string;
  };
  modelMode: 'default' | 'fast' | 'quality';
};

export const defaultCreateTheatrePublicSettings: CreateTheatrePublicSettings = {
  teacher: {
    name: 'AIYA老师',
    avatar: '师',
  },
  modelMode: 'default',
};

export function useCreateTheatrePublicSettings() {
  const [settings, setSettings] = useState<CreateTheatrePublicSettings>(defaultCreateTheatrePublicSettings);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/create-theatre/settings', {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.ok || !payload.settings) return;
        const teacher = payload.settings.teacher || {};
        const modelMode = payload.settings.modelMode;
        setSettings({
          teacher: {
            name: String(teacher.name || defaultCreateTheatrePublicSettings.teacher.name).trim().slice(0, 24)
              || defaultCreateTheatrePublicSettings.teacher.name,
            avatar: String(teacher.avatar || defaultCreateTheatrePublicSettings.teacher.avatar).trim().slice(0, 8)
              || defaultCreateTheatrePublicSettings.teacher.avatar,
          },
          modelMode: modelMode === 'fast' || modelMode === 'quality' ? modelMode : 'default',
        });
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  return settings;
}
