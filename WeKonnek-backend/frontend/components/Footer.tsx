import Link from 'next/link';
import Image from 'next/image';

export default function Footer() {
  return (
    <footer className="hidden bg-gradient-to-r from-[#DB0002] to-[#165BB8] text-white lg:block">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 lg:py-16">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-12">
          {/* Left: Branding and Social Media */}
          <div className="lg:col-span-1 order-1">
            <div className="flex items-center mb-4">
              <Image
                  src="/logo/weKonnekLogov1.png"
                  alt="WeKonnek Logo"
                  width={48}
                  height={32}
                  className="w-12 h-8 object-contain mr-2"
                />
              <h3 className="text-xl lg:text-2xl font-bold">WeKonnek</h3>
            </div>
            <p className="text-white/90 mb-6 text-sm leading-relaxed">
              Your trusted community trading system connecting local services and products.
            </p>
            <div className="flex gap-4">
              <a href="https://facebook.com/wekonnek" target="_blank" rel="noopener noreferrer" aria-label="Facebook" className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-blue-600/50 active:scale-90 transition-all">
                <Image
                  src="/assets/footer/facebook.png"
                  alt="Facebook"
                  width={20}
                  height={20}
                  className="w-10 h-10"
                />
              </a>
              <a href="https://twitter.com/wekonnek" target="_blank" rel="noopener noreferrer" aria-label="Twitter" className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-blue-600/50 active:scale-90 transition-all">
                <Image
                  src="/assets/footer/twitter.png"
                  alt="Twitter"
                  width={20}
                  height={20}
                  className="w-10 h-10"
                />
              </a>
              <a href="https://instagram.com/wekonnek" target="_blank" rel="noopener noreferrer" aria-label="Instagram" className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-blue-600/50 active:scale-90 transition-all">
                <Image
                  src="/assets/footer/instagram.png"
                  alt="Instagram"
                  width={20}
                  height={20}
                  className="w-10 h-10"
                />
              </a>
              <a href="mailto:support@wekonnek.com" aria-label="Email" className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-blue-600/50 active:scale-90 transition-all">
                <Image
                  src="/assets/footer/email.png"
                  alt="Email"
                  width={20}
                  height={20}
                  className="w-10 h-10"
                />
              </a>
            </div>
          </div>

          {/* Middle-Left: Services */}
          <div className="order-2 lg:order-2">
            <h4 className="text-base lg:text-lg font-bold mb-4">Services</h4>
            <ul className="space-y-2">
              <li>
                <Link href="/categories/food-beverage" className="text-white/90 hover:text-white transition-colors text-sm">
                  Food & Delivery
                </Link>
              </li>
              <li>
                <Link href="/categories" className="text-white/90 hover:text-white transition-colors text-sm">
                  Market Products
                </Link>
              </li>
              <li>
                <Link href="/categories/restaurants" className="text-white/90 hover:text-white transition-colors text-sm">
                  Restaurants
                </Link>
              </li>
              <li>
                <Link href="/categories/home-services" className="text-white/90 hover:text-white transition-colors text-sm">
                  Home Services
                </Link>
              </li>
              <li>
                <Link href="/categories/logistics" className="text-white/90 hover:text-white transition-colors text-sm">
                  Logistics
                </Link>
              </li>
            </ul>
          </div>

          {/* Middle-Right: Company */}
          <div className="order-3 lg:order-3">
            <h4 className="text-base lg:text-lg font-bold mb-4">Company</h4>
            <ul className="space-y-2">
              <li>
                <Link href="/about" className="text-white/90 hover:text-white transition-colors text-sm">
                  About Us
                </Link>
              </li>
              <li>
                <Link href="/merchants/register" className="text-white/90 hover:text-white transition-colors text-sm">
                  Become a Merchant
                </Link>
              </li>
              <li>
                <Link href="/careers" className="text-white/90 hover:text-white transition-colors text-sm">
                  Careers
                </Link>
              </li>
              <li>
                <Link href="/contact" className="text-white/90 hover:text-white transition-colors text-sm">
                  Contact Us
                </Link>
              </li>
            </ul>
          </div>

          {/* Right: Legal */}
          <div className="order-4 lg:order-4">
            <h4 className="text-base lg:text-lg font-bold mb-4">Legal</h4>
            <ul className="space-y-2">
              <li>
                <Link href="/privacy" className="text-white/90 hover:text-white transition-colors text-sm">
                  Privacy Policy
                </Link>
              </li>
              <li>
                <Link href="/terms" className="text-white/90 hover:text-white transition-colors text-sm">
                  Terms of Service
                </Link>
              </li>
              <li>
                <Link href="/cookies" className="text-white/90 hover:text-white transition-colors text-sm">
                  Cookie Policy
                </Link>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </footer>
  );
}
