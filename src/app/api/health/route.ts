export const dynamic = 'force-dynamic';
export async function GET() { return Response.json({ status: 'ok', service: 'DataEngine Studio', version: '1.0.0' }, { headers: { 'Cache-Control': 'no-store' } }); }
