import { NextRequest } from 'next/server';
import { verifyWalletAuth } from '../_lib/auth';
import { dueRequest, errorResponse } from '../_lib/due';

export async function POST(request: NextRequest) {
  const auth = await verifyWalletAuth(request);
  if (!auth.valid) return errorResponse(auth.error!, 401);

  const body = await request.json() as Record<string, unknown>;
  const { data, status } = await dueRequest('/accounts', {
    method: 'POST',
    body: {
      type: body.type ?? 'individual',
      email: body.email,
      details: body.details,
    },
  });

  // After creating account, try to get KYC link
  const accountData = data as Record<string, unknown>;
  if (status >= 200 && status < 300 && accountData.id) {
    const kycRes = await dueRequest<Record<string, unknown>>(`/accounts/${accountData.id}/kyc_link`, {
      accountId: accountData.id as string,
    });
    if (kycRes.status >= 200 && kycRes.status < 300) {
      accountData.kycUrl = (kycRes.data as Record<string, unknown>).url ?? '';
    }
  }

  return Response.json(data, { status });
}
