import { NextRequest } from 'next/server';
import { verifyWalletAuth } from '../../../_lib/auth';
import { dueRequest, errorResponse } from '../../../_lib/due';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await verifyWalletAuth(request);
  if (!auth.valid) return errorResponse(auth.error!, 401);

  const { id } = await params;
  const { data, status } = await dueRequest(`/accounts/${id}/kyc_link`, {
    accountId: id,
  });

  return Response.json(data, { status });
}
