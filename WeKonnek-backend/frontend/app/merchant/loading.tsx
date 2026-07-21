export default function MerchantLoading() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="text-center">
        <img
          src="/logo/weKonnekLogov1.png"
          alt="WeKonnek"
          className="w-24 h-16 mx-auto mb-4 animate-pulse object-contain"
        />
        <div className="w-8 h-8 border-3 border-[#DB0002] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-gray-500 text-sm">Loading…</p>
      </div>
    </div>
  );
}
