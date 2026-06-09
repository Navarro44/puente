import { Providers } from '../../../components/providers';

export default function WalletLayout({ children }: { children: React.ReactNode }) {
  return <Providers>{children}</Providers>;
}
