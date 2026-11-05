import React from "react";
import { Loader2 } from "lucide-react";

// ---------------------------------------------------------------------------
// UI base compartida (estilo shadcn con Tailwind). La usan GraphWorkflowEditor
// y MapaVisualizador; ambos van dentro de un contenedor .gwe (ver tailwind.css)
// para neutralizar el `button` global de index.css.
// ---------------------------------------------------------------------------

export function Btn({ icon: Icon, children, variant = "outline", size = "md", className = "", ...props }) {
  const styles = {
    primary: "border border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-700 disabled:border-slate-200 disabled:bg-slate-200 disabled:text-slate-400",
    outline: "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:text-slate-300 disabled:hover:bg-white",
    ghost: "border border-transparent bg-transparent text-slate-600 shadow-none hover:bg-slate-100 disabled:text-slate-300 disabled:hover:bg-transparent",
    danger: "border border-red-600 bg-red-600 text-white hover:bg-red-700",
  };
  const sizes = { sm: "h-8 px-2.5 text-xs", md: "h-9 px-3 text-sm", lg: "h-11 px-6 text-base" };
  return (
    <button
      type="button"
      className={`inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-lg border-solid font-medium shadow-sm transition-colors disabled:cursor-not-allowed ${sizes[size]} ${styles[variant]} ${className}`}
      {...props}
    >
      {Icon && <Icon className={`h-4 w-4 shrink-0 ${Icon === Loader2 ? "animate-spin" : ""}`} />}
      {children}
    </button>
  );
}

export function IconBtn({ icon: Icon, label, className = "", ...props }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
      {...props}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}

export function Switch({ checked, onChange, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${checked ? "bg-indigo-600 hover:bg-indigo-700" : "bg-slate-300 hover:bg-slate-400"}`}
    >
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${checked ? "left-4" : "left-0.5"}`} />
    </button>
  );
}

export function Badge({ tone = "slate", children, className = "" }) {
  const tones = {
    slate: "bg-slate-100 text-slate-600",
    indigo: "bg-indigo-50 text-indigo-700",
    amber: "bg-amber-50 text-amber-700",
    red: "bg-red-50 text-red-700",
    emerald: "bg-emerald-50 text-emerald-700",
  };
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${tones[tone]} ${className}`}>
      {children}
    </span>
  );
}

export const inputCls =
  "h-8 w-full min-w-0 rounded-md border border-solid border-slate-200 bg-white px-2 text-sm text-slate-800 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-slate-100 disabled:text-slate-400";
