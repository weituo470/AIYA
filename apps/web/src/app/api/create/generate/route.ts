export const runtime = 'nodejs';

type DisabledResponse = {
  error: string;
  replacement: string;
  fallbackEnabled: false;
};

export async function POST() {
  const body: DisabledResponse = {
    error: 'Direct model generation is disabled. AIYA Create only accepts server Codex Runner jobs, and mock/fallback generation is disabled.',
    replacement: '/api/create/jobs',
    fallbackEnabled: false,
  };
  return Response.json(body, { status: 410 });
}
