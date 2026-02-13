import { ReactNode } from 'react';

interface BadgeProps {
  variant: 'success' | 'warning' | 'danger' | 'info' | 'neutral';
  children: ReactNode;
  className?: string;
}

export function Badge({ variant, children, className = '' }: BadgeProps) {
  const variantClass = {
    success: 'badge-success',
    warning: 'badge-warning',
    danger: 'badge-danger',
    info: 'badge-info',
    neutral: 'badge-neutral',
  }[variant];

  return <span className={`badge ${variantClass} ${className}`}>{children}</span>;
}
