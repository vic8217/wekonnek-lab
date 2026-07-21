'use client';

import Link from 'next/link';

interface ServiceCategoryProps {
  icon: React.ReactNode;
  name: string;
  href?: string;
}

export default function ServiceCategory({ icon, name, href }: ServiceCategoryProps) {
  const content = (
    <>
      <div className="w-16 h-16 sm:w-20 sm:h-20 lg:w-24 lg:h-24 flex items-center justify-center mb-2">
        {icon}
      </div>
      <span className="text-xs sm:text-sm font-bold text-gray-700 text-center leading-tight">{name}</span>
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="flex flex-col items-center hover:scale-105 active:scale-95 transition-transform"
      >
        {content}
      </Link>
    );
  }

  return (
    <div className="flex flex-col items-center cursor-pointer hover:scale-105 active:scale-95 transition-transform">
      {content}
    </div>
  );
}
