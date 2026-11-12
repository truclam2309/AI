import React from 'react';

interface TextFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  suffix?: string;
}

export function TextField({ label, error, suffix, id, className = '', ...props }: TextFieldProps) {
  const inputId = id ?? props.name;
  return (
    <div className={className}>
      <label htmlFor={inputId} className="mb-1.5 block text-sm font-medium text-ink">
        {label}
      </label>
      <div className="relative">
        <input
          id={inputId}
          aria-invalid={!!error}
          aria-describedby={error ? `${inputId}-error` : undefined}
          className={`input h-11 ${suffix ? 'pr-12' : ''} ${error ? 'border-accent focus:border-accent focus:ring-accent/20' : ''}`}
          {...props} />
        
        {suffix && <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted">{suffix}</span>}
      </div>
      {error &&
      <p id={`${inputId}-error`} className="mt-1 text-xs text-accent">
          {error}
        </p>
      }
    </div>);

}