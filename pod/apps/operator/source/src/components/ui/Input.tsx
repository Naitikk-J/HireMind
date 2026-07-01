import { forwardRef, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { iconLeft, iconRight, className, ...rest },
  ref,
) {
  return (
    <div className="relative w-full">
      {iconLeft ? (
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint">{iconLeft}</span>
      ) : null}
      <input
        ref={ref}
        className={cn(
          "w-full h-8 rounded-md border border-border bg-surface2 px-3 text-sm text-fg",
          "placeholder:text-faint",
          "focus:outline-none focus:border-accent/60 focus:shadow-focus",
          "transition-colors duration-100 ease-soft",
          iconLeft ? "pl-8" : null,
          iconRight ? "pr-8" : null,
          className,
        )}
        {...rest}
      />
      {iconRight ? (
        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-faint">{iconRight}</span>
      ) : null}
    </div>
  );
});

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      className={cn(
        "w-full min-h-[120px] rounded-md border border-border bg-surface2 p-3 text-sm text-fg",
        "placeholder:text-faint",
        "focus:outline-none focus:border-accent/60 focus:shadow-focus",
        "transition-colors duration-100 ease-soft",
        "resize-y",
        className,
      )}
      {...rest}
    />
  );
});
