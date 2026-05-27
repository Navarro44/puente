'use server';

import { redirect } from 'next/navigation';
import { getServiceClient } from '../../../lib/supabase/service';

export async function addSupplier(formData: FormData) {
  const db = getServiceClient();

  const legalName = formData.get('legal_name') as string;
  const registrationNumber = formData.get('registration_number') as string;
  const registrationCountry = (formData.get('registration_country') as string).toUpperCase();
  const walletAddress = formData.get('wallet_address') as string;
  const organizationId = formData.get('organization_id') as string;

  if (!walletAddress.startsWith('0x') || walletAddress.length !== 42) {
    redirect(`/suppliers?error=${encodeURIComponent('Invalid wallet address — must be 0x-prefixed 20-byte hex')}`);
  }

  const { error } = await db.from('suppliers').insert({
    buyer_organization_id: organizationId,
    legal_name: legalName,
    registration_number: registrationNumber,
    registration_country: registrationCountry,
    wallet_address: walletAddress,
    kyb_status: 'pending',
  });

  if (error) {
    redirect(`/suppliers?error=${encodeURIComponent(error.message)}`);
  }

  redirect(`/suppliers?success=${encodeURIComponent(`Supplier "${legalName}" added. KYB pending.`)}`);
}
