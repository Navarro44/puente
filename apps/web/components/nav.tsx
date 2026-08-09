'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from '../lib/actions/auth';

interface NavProps {
  userName: string;
  role: string;
  orgName: string;
}

const NAV_LINKS = [
  { href: '/dashboard', label: 'Dashboard', roles: ['cfo', 'admin'] },
  { href: '/transactions', label: 'Transactions', roles: ['cfo', 'procurement', 'admin'] },
  { href: '/suppliers', label: 'Suppliers', roles: ['cfo', 'procurement', 'admin'] },
  { href: '/settings/wallets', label: 'Wallets', roles: ['cfo', 'procurement', 'admin'] },
  { href: '/transactions', label: 'My Shipments', roles: ['supplier_contact'] },
];

export function Nav({ userName, role, orgName }: NavProps) {
  const pathname = usePathname();

  const links = NAV_LINKS.filter((l) => l.roles.includes(role));

  return (
    <nav className="flex h-full flex-col bg-gray-900 text-white w-56 flex-shrink-0">
      <div className="p-4 border-b border-gray-700">
        <p className="text-lg font-bold tracking-tight">Puente</p>
        <p className="text-xs text-gray-400 mt-0.5">Trade Finance on Base</p>
      </div>

      <div className="flex-1 p-3 space-y-1">
        {links.map((l) => (
          <Link
            key={l.href + l.label}
            href={l.href}
            className={`block px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              pathname.startsWith(l.href)
                ? 'bg-gray-700 text-white'
                : 'text-gray-300 hover:bg-gray-800 hover:text-white'
            }`}
          >
            {l.label}
          </Link>
        ))}
      </div>

      <div className="p-3 border-t border-gray-700">
        <p className="text-xs text-gray-400 truncate">{orgName}</p>
        <p className="text-sm text-gray-200 truncate">{userName}</p>
        <p className="text-xs text-gray-500 capitalize mb-2">{role.replace('_', ' ')}</p>
        <form action={signOut}>
          <button
            type="submit"
            className="w-full text-left text-xs text-gray-400 hover:text-white transition-colors"
          >
            Sign out →
          </button>
        </form>
      </div>
    </nav>
  );
}
