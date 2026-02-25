import { NextRequest } from 'next/server';
import { verifyWalletAuth } from '../../../_lib/auth';
import { dueRequest, errorResponse } from '../../../_lib/due';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await verifyWalletAuth(request);
  if (!auth.valid) return errorResponse(auth.error!, 401);

  const { id } = await params;
  const body = await request.json() as Record<string, unknown>;
  const accountId = body.accountId as string | undefined;

  const { data, status } = await dueRequest(`/transfers/${id}/funding_address`, {
    method: 'POST',
    accountId,
  });

  return Response.json(data, { status });
}
