import React from 'react';

type BrandLogoProps = {
  alt: string;
  className?: string;
  fallbackIcon?: string;
  fallbackIconClassName?: string;
};

const BrandLogo: React.FC<BrandLogoProps> = ({
  alt,
  className = 'h-6 w-6 object-contain',
  fallbackIcon = 'restaurant',
  fallbackIconClassName = 'material-symbols-outlined text-primary'
}) => {
  const logoUrl = import.meta.env.VITE_BRAND_LOGO_URL || 'https://res.cloudinary.com/dzayh29d7/image/upload/v1771022152/X_d2eevj.png';

  if (logoUrl) {
    return <img src={logoUrl} alt={alt} className={className} loading="eager" decoding="async" />;
  }

  return <span className={fallbackIconClassName}>{fallbackIcon}</span>;
};

export default BrandLogo;
