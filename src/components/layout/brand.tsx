import Image from "next/image";
import Link from "next/link";

export function Brand({ size = 56 }: { size?: number }) {
  return (
    <Link
      href="/dashboard"
      className="inline-flex items-center rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      aria-label="López + Saúde — ir para o dashboard"
    >
      <Image
        src="/brand/logo.png"
        alt="López + Saúde"
        width={size}
        height={size}
        priority
        className="rounded-lg"
      />
    </Link>
  );
}
