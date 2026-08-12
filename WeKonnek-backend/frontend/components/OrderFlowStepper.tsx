'use client';

import Link from 'next/link';

const STEPS = ['Digital menu', 'Review & place order', 'Order summary'];

export default function OrderFlowStepper({
  currentStep,
  menuHref,
}: {
  currentStep: 1 | 2 | 3;
  menuHref?: string;
}) {
  return (
    <nav aria-label="Order progress" className="rounded-2xl border border-gray-100 bg-white px-4 py-4 shadow-sm">
      <ol className="grid grid-cols-3">
        {STEPS.map((label, index) => {
          const step = index + 1;
          const complete = step < currentStep;
          const active = step === currentStep;
          const content = (
            <>
              <span
                className={`relative z-10 grid size-7 place-items-center rounded-full text-xs font-bold ${
                  complete || active ? 'bg-[#DB0002] text-white' : 'bg-gray-200 text-gray-500'
                }`}
              >
                {complete ? '✓' : step}
              </span>
              <span className={`mt-2 text-[10px] font-bold sm:text-xs ${active ? 'text-[#DB0002]' : 'text-gray-500'}`}>
                {label}
              </span>
            </>
          );

          return (
            <li key={label} className="relative flex min-w-0 flex-col items-center text-center">
              {index > 0 && (
                <span className={`absolute right-1/2 top-3.5 h-0.5 w-full ${step <= currentStep ? 'bg-[#DB0002]' : 'bg-gray-200'}`} />
              )}
              {step === 1 && menuHref ? (
                <Link href={menuHref} className="relative z-10 flex flex-col items-center" aria-label="Return to digital menu">
                  {content}
                </Link>
              ) : (
                <div className="relative z-10 flex flex-col items-center" aria-current={active ? 'step' : undefined}>
                  {content}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
