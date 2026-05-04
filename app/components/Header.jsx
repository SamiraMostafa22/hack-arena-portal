import Image from "next/image";

export default function Header() {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-[#ff4b00]/30 bg-black/90 px-4 py-2 shadow-lg shadow-orange-950/20 backdrop-blur">
      <div className="mx-auto grid max-w-[95vw] grid-cols-[auto_1fr_auto] items-center gap-4">
        <div className="flex items-center justify-start">
          <Image
            src="/university-logo.png"
            alt="University Logo"
            width={150}
            height={150}
            priority
            className="h-24 w-auto object-contain md:h-28"
          />
        </div>

        <div className="text-center">
          <p className="cyber-title text-[10px] font-black uppercase tracking-[0.32em] text-[#ff4b00] md:text-xs">
            Official CTF Competition
          </p>

          <h1 className="cyber-title mt-1 text-3xl font-black leading-none text-white md:text-5xl">
            Hack <span className="text-[#ff4b00]">Arena</span>
          </h1>

          <div className="mx-auto mt-2 h-[2px] w-32 bg-gradient-to-r from-transparent via-[#ff4b00] to-transparent md:w-44" />

          <div className="cyber-outline mt-2 inline-flex rounded-full px-4 py-1.5 text-[9px] font-black uppercase tracking-[0.22em] md:px-5 md:text-xs">
            Capture The Flag
          </div>
        </div>

        <div className="flex items-center justify-end">
          <Image
            src="/hack-arena-logo.png"
            alt="Hack Arena Logo"
            width={150}
            height={150}
            priority
            className="h-24 w-auto object-contain md:h-28"
          />
        </div>
      </div>
    </header>
  );
}