type AppLogoProps = {
  className?: string;
  alt?: string;
};

export default function AppLogo({ className = 'w-6 h-6 rounded-md', alt = 'TeleRSS logo' }: AppLogoProps) {
  return (
    <img
      src="/telerss-icon.svg"
      alt={alt}
      className={className}
      loading="eager"
      decoding="async"
    />
  );
}
