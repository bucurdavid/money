import { NextRequest } from 'next/server';
import { verifyWalletAuth } from '../_lib/auth';
import { dueRequest, errorResponse } from '../_lib/due';

export async function POST(request: NextRequest) {
  const auth = await verifyWalletAuth(request);
  if (!auth.valid) return errorResponse(auth.error!, 401);

  const body = await request.json() as Record<string, unknown>;
  const accountId = body.accountId as string | undefined;

  const transferBody: Record<string, unknown> = {
    quote: body.quote,
    recipient: body.recipient,
  };
  if (body.sender !== undefined) transferBody.sender = body.sender;
  if (body.memo !== undefined) transferBody.memo = body.memo;

  const { data, status } = await dueRequest('/transfers', {
    method: 'POST',
    body: transferBody,
    accountId,
  });

  return Response.json(data, { status });
}
