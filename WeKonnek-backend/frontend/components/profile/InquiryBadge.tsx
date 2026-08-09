export default function InquiryBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <div className="inline-flex items-center gap-1.5 text-[11px] font-bold text-[#DB0002]" aria-label={`${count} new inquiries`}>
      <span className="h-2 w-2 rounded-full bg-[#DB0002]" />
      {count > 99 ? '99+' : count} New {count === 1 ? 'Inquiry' : 'Inquiries'}
    </div>
  );
}
