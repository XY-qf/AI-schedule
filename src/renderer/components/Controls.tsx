import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from 'react'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: 'sm' | 'md'
  active?: boolean
  iconOnly?: boolean
}

export function Button({
  variant = 'secondary',
  size = 'md',
  active = false,
  iconOnly = false,
  className,
  type = 'button',
  children,
  ...rest
}: ButtonProps): ReactNode {
  const classes = [
    'btn',
    `btn--${variant}`,
    size === 'sm' ? 'btn--sm' : '',
    active ? 'btn--active' : '',
    iconOnly ? 'btn--icon' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <button type={type} className={classes} {...rest}>
      {children}
    </button>
  )
}

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  id: string
  label: string
  error?: string | null
  hint?: string
  required?: boolean
}

export function TextField({
  id,
  label,
  error,
  hint,
  required = false,
  className,
  ...rest
}: TextFieldProps): ReactNode {
  const labelClass = required ? 'field__label field__label-required' : 'field__label'
  return (
    <div className={`field${error ? ' field--error' : ''}${className ? ` ${className}` : ''}`}>
      <label className={labelClass} htmlFor={id}>
        {label}
      </label>
      <input id={id} className="field__input" aria-invalid={error ? true : undefined} {...rest} />
      {error ? (
        <span className="field__error" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="field__hint">{hint}</span>
      ) : null}
    </div>
  )
}

export interface CheckboxProps {
  id: string
  label: ReactNode
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}

export function Checkbox({ id, label, checked, onChange, disabled }: CheckboxProps): ReactNode {
  return (
    <label className="checkbox" htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{label}</span>
    </label>
  )
}

export interface SelectOption {
  value: string
  label: string
}

export interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> {
  id: string
  label: string
  options: SelectOption[]
  error?: string | null
}

export function SelectField({
  id,
  label,
  options,
  error,
  className,
  ...rest
}: SelectFieldProps): ReactNode {
  return (
    <div className={`field${error ? ' field--error' : ''}${className ? ` ${className}` : ''}`}>
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <select id={id} className="field__select" {...rest}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error ? (
        <span className="field__error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  )
}

export interface SegmentedOption<T extends string> {
  value: T
  label: string
}

export interface SegmentedControlProps<T extends string> {
  ariaLabel: string
  value: T
  options: SegmentedOption<T>[]
  onChange: (value: T) => void
}

export function SegmentedControl<T extends string>({
  ariaLabel,
  value,
  options,
  onChange,
}: SegmentedControlProps<T>): ReactNode {
  return (
    <div className="segmented" role="tablist" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={option.value === value}
          className={`segmented__item${option.value === value ? ' is-active' : ''}`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
