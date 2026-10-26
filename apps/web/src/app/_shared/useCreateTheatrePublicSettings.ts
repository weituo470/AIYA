'use client';

import { useEffect, useState } from 'react';

export type CreateTheatrePublicSettings = {
  teacher: {
    name: string;
    avatar: string;
  };
  modelMode: 'default' | 'fast' | 'quality' | 'fusion';
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
    const refresh = () => {
    fetch('/api/create-theatre/settings', {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.ok || !payload.settings) return;
        const teacher = payload.settings.teacher || {};
        const selection = await fetch('/api/create-theatre/model-selection', { cache: 'no-store', signal: controller.signal }).then((r) => r.ok ? r.json() : null).catch(() => null);
        if (controller.signal.aborted) return;
        const modelMode = selection?.ok ? selection.mode : payload.settings.modelMode;
        setSettings({
          teacher: {
            name: String(teacher.name || defaultCreateTheatrePublicSettings.teacher.name).trim().slice(0, 24)
              || defaultCreateTheatrePublicSettings.teacher.name,
            avatar: String(teacher.avatar || defaultCreateTheatrePublicSettings.teacher.avatar).trim().slice(0, 8)
              || defaultCreateTheatrePublicSettings.teacher.avatar,
          },
          modelMode: modelMode === 'fast' || modelMode === 'quality' || modelMode === 'fusion' ? modelMode : 'default',
        });
      })
      .catch(() => undefined);
    };
    refresh();
    window.addEventListener('aiya-model-selection-changed', refresh);
    return () => { controller.abort(); window.removeEventListener('aiya-model-selection-changed', refresh); };
  }, []);

  return settings;
}
