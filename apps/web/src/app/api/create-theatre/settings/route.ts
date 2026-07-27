import { NextResponse } from 'next/server';
import {
  readCreateTheatreAdminSettings,
  toPublicCreateTheatreAdminSettings,
} from '../_admin-settings';

export const runtime = 'nodejs';

export async function GET() {
  const settings = await readCreateTheatreAdminSettings();
  return NextResponse.json(
    { ok: true, settings: toPublicCreateTheatreAdminSettings(settings) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
