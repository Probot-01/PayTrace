"use client";

import type { ComponentProps } from "react";

/** A select inside a GET form that applies on change (the form still works without JavaScript). */
export function AutoSubmitSelect(props: ComponentProps<"select">) {
  return <select {...props} onChange={(e) => e.currentTarget.form?.requestSubmit()} />;
}
